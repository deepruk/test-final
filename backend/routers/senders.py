import asyncio
import logging
import os
import secrets
from datetime import timedelta
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from lib import mailer
from lib.google_gmail import encrypt_refresh_token
from lib.auth import current_user
from lib.db import db
from lib.sender_health import compute_health
from lib.util import new_id, now, start_of_today
from models.schemas import ConnectionTestOut, SenderIn, SenderOut, SenderUpdate

router = APIRouter(prefix="/senders", tags=["senders"])
log = logging.getLogger(__name__)

GOOGLE_SCOPES = (
    "openid email https://www.googleapis.com/auth/gmail.send "
    "https://www.googleapis.com/auth/gmail.readonly"
)


def _google_config() -> tuple[str, str, str]:
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI", "")
    if not client_id or not client_secret or not redirect_uri:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured on the server")
    return client_id, client_secret, redirect_uri


def _google_frontend_url() -> str:
    value = os.environ.get("GOOGLE_OAUTH_FRONTEND_URL", "").strip().rstrip("/")
    if not value:
        raise HTTPException(status_code=503, detail="GOOGLE_OAUTH_FRONTEND_URL is not configured")
    return value


@router.get("/google/oauth/start")
async def google_oauth_start(user: dict = Depends(current_user)):
    """Start Gmail sender authorization for the currently signed-in OutreachForge user."""
    client_id, _, redirect_uri = _google_config()
    try:
        # Remove stale one-time states as part of normal traffic; state is consumed at callback.
        await db.google_oauth_states.delete_many({"expires_at": {"$lte": now()}})
    except Exception:
        pass
    state = secrets.token_urlsafe(32)
    await db.google_oauth_states.insert_one({
        "state": state,
        "user_id": user["id"],
        "created_at": now(),
        "expires_at": now() + timedelta(minutes=10),
    })
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": GOOGLE_SCOPES,
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    return RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params), status_code=302)


@router.get("/google/oauth/callback")
async def google_oauth_callback(request: Request):
    """Exchange Google's one-time code and attach the Gmail sender to the user saved in OAuth state."""
    frontend = _google_frontend_url()
    state = request.query_params.get("state", "")
    code = request.query_params.get("code", "")
    if request.query_params.get("error"):
        return RedirectResponse(frontend + "/senders?google_oauth=error&reason=consent_denied", status_code=303)
    if not state or not code:
        return RedirectResponse(frontend + "/senders?google_oauth=error&reason=invalid_callback", status_code=303)

    state_doc = await db.google_oauth_states.find_one_and_delete({"state": state, "expires_at": {"$gt": now()}})
    if not state_doc:
        return RedirectResponse(frontend + "/senders?google_oauth=error&reason=state_expired", status_code=303)

    try:
        client_id, client_secret, redirect_uri = _google_config()
        token_response = await asyncio.to_thread(
            requests.post,
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=20,
        )
        token_data = token_response.json()
        if token_response.status_code != 200 or not token_data.get("access_token"):
            raise RuntimeError("Google token exchange failed")
        refresh_token = token_data.get("refresh_token")
        profile_response = await asyncio.to_thread(
            requests.get,
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
            timeout=20,
        )
        profile = profile_response.json()
        email = str(profile.get("email", "")).strip().lower()
        if profile_response.status_code != 200 or not email or not profile.get("email_verified", False):
            raise RuntimeError("Google did not return a verified email address")
        user_id = state_doc["user_id"]
        existing = await db.senders.find_one({"user_id": user_id, "email": email}, {"_id": 0})
        encrypted_refresh = (
            encrypt_refresh_token(refresh_token) if refresh_token else
            (existing.get("google_refresh_token_enc") if existing and existing.get("auth_type") == "google_oauth" else None)
        )
        if not encrypted_refresh:
            raise RuntimeError("Google did not return a refresh token; reconnect and grant consent")
        fields = {
            "auth_type": "google_oauth",
            "google_refresh_token_enc": encrypted_refresh,
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "smtp_security": "starttls",
            "smtp_user": email,
            "smtp_pass": "",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "imap_user": email,
            "imap_pass": "",
            "status": "active",
            "last_error": "",
            "last_uid": existing.get("last_uid", 0) if existing and existing.get("auth_type") == "google_oauth" else 0,
            "last_synced_at": existing.get("last_synced_at") if existing and existing.get("auth_type") == "google_oauth" else None,
        }
        if existing:
            await db.senders.update_one({"id": existing["id"], "user_id": user_id}, {"$set": fields})
        else:
            doc = {
                **fields,
                "id": new_id(),
                "user_id": user_id,
                "email": email,
                "from_name": profile.get("name") or email.split("@")[0],
                "daily_limit": 10,
                "signatures": [],
                "last_uid": 0,
                "last_synced_at": None,
                "created_at": now(),
                "next_available_at": None,
            }
            await db.senders.insert_one(doc)
        return RedirectResponse(frontend + "/senders?google_oauth=connected", status_code=303)
    except Exception as exc:
        # Log only the exception class; provider bodies and credentials can contain sensitive data.
        log.warning("Google OAuth callback failed (%s)", type(exc).__name__)
        return RedirectResponse(frontend + "/senders?google_oauth=error&reason=authorization_failed", status_code=303)



async def _out(s: dict) -> SenderOut:
    sent_today = await db.messages.count_documents({"sender_id": s["id"], "sent_at": {"$gte": start_of_today()}})
    sent_total = await db.messages.count_documents({"sender_id": s["id"]})
    replies = await db.threads.count_documents({"sender_id": s["id"]})
    limit = int(s.get("daily_limit") or 0)
    health = await compute_health(db, s)
    payload = {k: v for k, v in s.items() if k in SenderOut.model_fields and k != "effective_limit"}
    return SenderOut(**payload, sent_today=sent_today, sent_total=sent_total, reply_count=replies,
                     effective_limit=limit, **health)


async def _get(user: dict, sid: str) -> dict:
    s = await db.senders.find_one({"id": sid, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Sender not found")
    return s


@router.get("", response_model=list[SenderOut])
async def list_senders(user: dict = Depends(current_user)):
    docs = await db.senders.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [await _out(s) for s in docs]


@router.post("/test", response_model=ConnectionTestOut)
async def test_new(body: SenderIn, user: dict = Depends(current_user)):
    return ConnectionTestOut(**await asyncio.to_thread(mailer.test_connection, body.model_dump()))


@router.post("", response_model=SenderOut)
async def create_sender(body: SenderIn, user: dict = Depends(current_user)):
    email = body.email.lower()
    if await db.senders.find_one({"user_id": user["id"], "email": email}):
        raise HTTPException(status_code=409, detail="This sender is already connected")
    doc = body.model_dump()
    doc.update(id=new_id(), user_id=user["id"], email=email, status="active", last_error="",
               last_uid=0, last_synced_at=None, created_at=now())
    if not doc["imap_user"]:
        doc["imap_user"] = doc["smtp_user"]
    if not doc["imap_pass"]:
        doc["imap_pass"] = doc["smtp_pass"]
    await db.senders.insert_one(doc)
    return await _out(doc)


@router.patch("/{sid}", response_model=SenderOut)
async def update_sender(sid: str, body: SenderUpdate, user: dict = Depends(current_user)):
    s = await _get(user, sid)
    upd = body.model_dump(exclude_none=True)
    if s["status"] == "demo":
        upd.pop("status", None)
    if upd.get("status") == "active":
        upd["last_error"] = ""
    if upd:
        await db.senders.update_one({"id": sid}, {"$set": upd})
    return await _out(await _get(user, sid))


@router.post("/{sid}/test", response_model=ConnectionTestOut)
async def test_existing(sid: str, user: dict = Depends(current_user)):
    s = await _get(user, sid)
    if s["status"] == "demo":
        return ConnectionTestOut(smtp_ok=True, imap_ok=True, smtp_error="Demo account (simulated)")
    res = await asyncio.to_thread(mailer.test_connection, s)
    if res["smtp_ok"] and s["status"] == "error":
        await db.senders.update_one({"id": sid}, {"$set": {"status": "active", "last_error": ""}})
    return ConnectionTestOut(**res)


@router.delete("/{sid}")
async def delete_sender(sid: str, user: dict = Depends(current_user)):
    await _get(user, sid)
    await db.senders.delete_one({"id": sid})
    await db.campaigns.update_many({"user_id": user["id"]}, {"$pull": {"sender_ids": sid}})
    return {"ok": True}
