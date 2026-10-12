import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.auth import current_user
from lib.db import db
from lib.engine import decide_winner, in_send_window, zone
from lib.util import start_of_today, warmup_info
from datetime import timedelta
from lib.stats import PROJ, build_series, build_steps, campaign_totals, totals_from
from lib.util import new_id, now
from models.schemas import (
    AnalyticsOut, CampaignCreate, CampaignLive, CampaignOut, CampaignUpdate, LeadImport, LeadImportResult,
    LeadOut, StatTotals,
)

router = APIRouter(prefix="/campaigns", tags=["campaigns"])
RESERVED = {"email", "first_name", "last_name", "company", "title", "timezone", "unsubscribe_link"}

DEFAULT_STEPS = [
    {"id": "", "subject": "Quick question, {{first_name}}", "delay_days": 0,
     "body": "Hi {{first_name}},\n\nI noticed {{company}} is growing fast and wanted to reach out.\n\nWould you be open to a quick 15-minute chat next week?\n\nBest,\n"},
    {"id": "", "subject": "", "delay_days": 3,
     "body": "Hi {{first_name}}, just bumping this to the top of your inbox. Worth a quick chat?\n"},
]


def _out(c: dict, t: dict) -> CampaignOut:
    t = dict(t)
    progress = t.pop("_progress", 0)
    return CampaignOut(**{k: v for k, v in c.items() if k in CampaignOut.model_fields and k != "stats"},
                       stats=StatTotals(**t), progress=progress)


async def _get(user: dict, cid: str) -> dict:
    c = await db.campaigns.find_one({"id": cid, "user_id": user["id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return c


@router.get("", response_model=list[CampaignOut])
async def list_campaigns(user: dict = Depends(current_user)):
    docs = await db.campaigns.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    totals = await campaign_totals(user["id"], [c["id"] for c in docs])
    return [_out(c, totals[c["id"]]) for c in docs]


@router.post("", response_model=CampaignOut)
async def create_campaign(body: CampaignCreate, user: dict = Depends(current_user)):
    senders = await db.senders.find({"user_id": user["id"], "status": {"$in": ["active", "demo"]}}, {"_id": 0, "id": 1}).to_list(100)
    c = {
        "id": new_id(), "user_id": user["id"], "name": body.name.strip(), "status": "draft",
        "steps": [{**s, "id": new_id()} for s in DEFAULT_STEPS],
        "sender_ids": [s["id"] for s in senders], "daily_limit": 100, "track_opens": True,
        "track_clicks": True, "stop_on_reply": True, "include_unsubscribe": True, "custom_fields": [],
        "send_days": [0, 1, 2, 3, 4], "timezone": "UTC", "use_lead_timezone": False,
        "gap_min_minutes": 10, "gap_max_minutes": 15, "random_start_minutes": 30, "send_start_hour": 0, "send_end_hour": 24,
        "plain_text_only": False, "smart_subject": False, "extra_jitter_minutes": 0,
        "created_at": now(), "launched_at": None,
    }
    await db.campaigns.insert_one(c)
    return _out(c, totals_from([], 0))


@router.get("/{cid}", response_model=CampaignOut)
async def get_campaign(cid: str, user: dict = Depends(current_user)):
    c = await _get(user, cid)
    return _out(c, (await campaign_totals(user["id"], [cid]))[cid])


@router.put("/{cid}", response_model=CampaignOut)
async def update_campaign(cid: str, body: CampaignUpdate, user: dict = Depends(current_user)):
    cur = await _get(user, cid)
    upd = body.model_dump(exclude_none=True)
    if "steps" in upd:
        old = {s["id"]: s for s in cur.get("steps") or []}
        steps = []
        for s in upd["steps"]:
            prev = old.get(s["id"])
            # any subject edit restarts that step's A/B test
            if not prev or prev.get("subject") != s["subject"] or prev.get("subject_b", "") != s["subject_b"] or not s["subject_b"].strip():
                s["ab_winner"] = None
            steps.append({**s, "id": s["id"] if prev else new_id()})
        upd["steps"] = steps
    lo = upd.get("gap_min_minutes", cur.get("gap_min_minutes", 10))
    hi = upd.get("gap_max_minutes", cur.get("gap_max_minutes", 15))
    if "gap_min_minutes" in upd or "gap_max_minutes" in upd:
        upd["gap_min_minutes"], upd["gap_max_minutes"] = min(lo, hi), max(lo, hi)
    if "send_days" in upd:
        upd["send_days"] = sorted({d for d in upd["send_days"] if 0 <= d <= 6})
    if "timezone" in upd and not zone(upd["timezone"]):
        raise HTTPException(status_code=422, detail=f"Unknown timezone: {upd['timezone']}")
    if "sender_ids" in upd:
        owned = await db.senders.find({"user_id": user["id"], "id": {"$in": upd["sender_ids"]}}, {"_id": 0, "id": 1}).to_list(500)
        upd["sender_ids"] = [s["id"] for s in owned]
    if upd:
        await db.campaigns.update_one({"id": cid}, {"$set": upd})
    return await get_campaign(cid, user)


@router.post("/{cid}/launch", response_model=CampaignOut)
async def launch(cid: str, user: dict = Depends(current_user)):
    c = await _get(user, cid)
    steps = c.get("steps") or []
    if not steps or not (steps[0].get("subject") or "").strip() or not any((s.get("body") or "").strip() for s in steps):
        raise HTTPException(status_code=400, detail="Add at least one email step with a subject and body")
    if not c.get("sender_ids"):
        raise HTTPException(status_code=400, detail="Select at least one sender account")
    if not await db.leads.count_documents({"campaign_id": cid, "status": {"$in": ["pending", "in_progress"]}}):
        raise HTTPException(status_code=400, detail="Add leads before launching")
    await db.leads.update_many({"campaign_id": cid, "status": "pending", "next_send_at": None}, {"$set": {"next_send_at": now()}})
    await db.campaigns.update_one({"id": cid}, {"$set": {"status": "active", "launched_at": c.get("launched_at") or now()}})
    return await get_campaign(cid, user)


@router.post("/{cid}/pause", response_model=CampaignOut)
async def pause(cid: str, user: dict = Depends(current_user)):
    await _get(user, cid)
    await db.campaigns.update_one({"id": cid}, {"$set": {"status": "paused"}})
    return await get_campaign(cid, user)


@router.delete("/{cid}")
async def delete_campaign(cid: str, user: dict = Depends(current_user)):
    await _get(user, cid)
    for coll in ("leads", "messages", "threads"):
        await db[coll].delete_many({"campaign_id": cid})
    await db.campaigns.delete_one({"id": cid})
    return {"ok": True}


@router.get("/{cid}/analytics", response_model=AnalyticsOut)
async def campaign_analytics(cid: str, days: int = Query(14, ge=1, le=365), user: dict = Depends(current_user)):
    c = await _get(user, cid)
    for i, st in enumerate(c.get("steps") or []):
        if (st.get("subject_b") or "").strip():
            await decide_winner(c, i, st)
    msgs = await db.messages.find({"campaign_id": cid}, PROJ).to_list(200000)
    leads = await db.leads.count_documents({"campaign_id": cid})
    return AnalyticsOut(totals=StatTotals(**totals_from(msgs, leads)), series=build_series(msgs, days),
                        campaigns=[], steps=build_steps(msgs, c.get("steps") or []))


@router.get("/{cid}/live", response_model=CampaignLive)
async def campaign_live(cid: str, user: dict = Depends(current_user)):
    """Live sending status: capacity, active sequences, last-30m volume and when the next email goes out."""
    c = await _get(user, cid)
    n = now()
    senders = await db.senders.find({"id": {"$in": c.get("sender_ids", [])}}, {"_id": 0}).to_list(100)
    usable = [s for s in senders if s["status"] in ("active", "demo")]
    sent_today = await db.messages.count_documents({"campaign_id": cid, "sent_at": {"$gte": start_of_today()}})
    inbox_cap = sum(warmup_info(s)[0] for s in usable)
    cap = min(c.get("daily_limit", 100), inbox_cap) if usable else 0
    active = await db.leads.count_documents({"campaign_id": cid, "status": {"$in": ["pending", "in_progress"]}})
    last30 = await db.messages.count_documents({"campaign_id": cid, "sent_at": {"$gte": n - timedelta(minutes=30)}})
    out = CampaignLive(capacity_used_pct=round(sent_today * 100 / cap, 1) if cap else 0, sent_today=sent_today,
                       daily_capacity=cap, active_sequences=active, sent_last_30m=last30)
    if c["status"] != "active":
        out.next_note = "Campaign is not active"
    elif not usable:
        out.next_note = "No usable sender accounts"
    elif not active:
        out.next_note = "No leads left to email"
    elif sent_today >= c.get("daily_limit", 100):
        out.next_note = "Daily campaign limit reached"
    else:
        due = await db.leads.find_one({"campaign_id": cid, "status": {"$in": ["pending", "in_progress"]}},
                                      {"_id": 0}, sort=[("next_send_at", 1)])
        lead_at = (due or {}).get("next_send_at") or n
        free = []
        for s in usable:
            if await db.messages.count_documents({"sender_id": s["id"], "sent_at": {"$gte": start_of_today()}}) < warmup_info(s)[0]:
                free.append(s.get("next_available_at") or n)
        if not free:
            out.next_note = "All inboxes hit today's limit"
        else:
            out.next_email_at = max(lead_at, min(free), n)
            if due and not in_send_window(c, due) and out.next_email_at <= n + timedelta(minutes=1):
                out.next_note = "Waiting for the sending window"
    return out


# ---------- leads ----------
@router.get("/{cid}/leads", response_model=list[LeadOut])
async def list_leads(cid: str, q: str = "", status: Optional[str] = None, user: dict = Depends(current_user)):
    await _get(user, cid)
    flt: dict = {"campaign_id": cid}
    if status and status != "all":
        flt["status"] = status
    if q:
        flt["$or"] = [{f: {"$regex": q, "$options": "i"}} for f in ("email", "first_name", "last_name", "company")]
    docs = await db.leads.find(flt, {"_id": 0}).sort("created_at", -1).to_list(5000)
    ids = [d["id"] for d in docs]
    opened = set(await db.messages.distinct("lead_id", {"lead_id": {"$in": ids}, "$or": [{"opened_at": {"$ne": None}}, {"open_count": {"$gt": 0}}]}))
    clicked = set(await db.messages.distinct("lead_id", {"lead_id": {"$in": ids}, "$or": [{"clicked_at": {"$ne": None}}, {"click_count": {"$gt": 0}}]}))
    return [LeadOut(**{k: v for k, v in d.items() if k in LeadOut.model_fields},
                    opened=d["id"] in opened, clicked=d["id"] in clicked) for d in docs]


@router.post("/{cid}/leads", response_model=LeadImportResult)
async def import_leads(cid: str, body: LeadImport, user: dict = Depends(current_user)):
    c = await _get(user, cid)
    existing = set(await db.leads.distinct("email", {"campaign_id": cid}))
    blocked = set(await db.unsubscribes.distinct("email", {"user_id": user["id"], "email": {"$in": [l.email.lower() for l in body.leads]}}))
    fields: set[str] = set()
    docs, skipped = [], 0
    for l in body.leads:
        email = l.email.lower()
        if email in existing:
            skipped += 1
            continue
        existing.add(email)
        custom = {re.sub(r"[^a-z0-9_]+", "_", k.strip().lower()).strip("_"): str(v).strip() for k, v in l.custom.items()}
        custom = {k: v for k, v in custom.items() if k and k not in RESERVED}
        fields.update(custom)
        docs.append({
            "id": new_id(), "user_id": user["id"], "campaign_id": cid, "email": email,
            "first_name": l.first_name.strip(), "last_name": l.last_name.strip(),
            "company": l.company.strip(), "title": l.title.strip(), "custom": custom,
            "timezone": l.timezone.strip() if zone(l.timezone.strip()) else "",
            "status": "unsubscribed" if email in blocked else "pending",
            "current_step": 0, "sender_id": None,
            "next_send_at": now() if c["status"] == "active" else None,
            "last_sent_at": None, "created_at": now(),
        })
    if fields:
        await db.campaigns.update_one({"id": cid}, {"$addToSet": {"custom_fields": {"$each": sorted(fields)}}})
    if docs:
        await db.leads.insert_many(docs)
        if c["status"] == "completed":
            await db.campaigns.update_one({"id": cid}, {"$set": {"status": "paused"}})
    return LeadImportResult(added=len(docs), skipped=skipped)


@router.delete("/{cid}/leads/{lid}")
async def delete_lead(cid: str, lid: str, user: dict = Depends(current_user)):
    await _get(user, cid)
    res = await db.leads.delete_one({"id": lid, "campaign_id": cid})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"ok": True}
