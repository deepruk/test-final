from fastapi import APIRouter, Depends, HTTPException, Request, Response

from lib.auth import clear_session, current_user, hash_password, set_session, verify_password
from lib.db import db
from lib.util import new_id, now
from models.schemas import LoginIn, SignupIn, UserOut, WorkspaceUpdate

router = APIRouter(prefix="/auth", tags=["auth"])


def _out(u: dict) -> UserOut:
    return UserOut(id=u["id"], name=u["name"], email=u["email"],
                   default_signature=u.get("default_signature", ""), created_at=u["created_at"])


@router.post("/signup", response_model=UserOut)
async def signup(body: SignupIn, request: Request, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = {"id": new_id(), "name": body.name.strip(), "email": email,
            "password_hash": hash_password(body.password), "created_at": now()}
    await db.users.insert_one(user)
    set_session(response, request, user["id"])
    return _out(user)


@router.post("/login", response_model=UserOut)
async def login(body: LoginIn, request: Request, response: Response):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    set_session(response, request, user["id"])
    return _out(user)


@router.post("/logout")
async def logout(response: Response):
    clear_session(response)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    return _out(user)


@router.patch("/workspace", response_model=UserOut)
async def update_workspace(body: WorkspaceUpdate, user: dict = Depends(current_user)):
    """Update workspace-level settings. Optionally mirror the new signature to every inbox."""
    upd: dict = {}
    if body.default_signature is not None:
        upd["default_signature"] = body.default_signature
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
    if body.apply_signature_to_all_inboxes and body.default_signature is not None:
        sig = body.default_signature.strip()
        sigs = [sig] if sig else []
        await db.senders.update_many({"user_id": user["id"]}, {"$set": {"signatures": sigs}})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or user
    return _out(fresh)
