from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query

from lib.auth import current_user
from lib.db import db
from lib.util import now, start_of_today
from models.schemas import ActivityItem, ActivityOut, InboxSchedule, UpcomingSend

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("", response_model=ActivityOut)
async def activity(campaign_id: Optional[str] = None, limit: int = Query(50, ge=1, le=200),
                   user: dict = Depends(current_user)):
    flt: dict = {"user_id": user["id"]}
    if campaign_id:
        flt["campaign_id"] = campaign_id
    msgs = await db.messages.find(flt, {"_id": 0, "body": 0}).sort("sent_at", -1).to_list(limit)
    camps = {c["id"]: c for c in await db.campaigns.find({"user_id": user["id"]}, {"_id": 0, "id": 1, "name": 1, "steps": 1}).to_list(1000)}
    senders = await db.senders.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    semail = {s["id"]: s["email"] for s in senders}
    lead_ids = list({m["lead_id"] for m in msgs})
    leads = {l["id"]: l for l in await db.leads.find({"id": {"$in": lead_ids}}, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1}).to_list(len(lead_ids) or 1)}
    items = []
    for m in msgs:
        l = leads.get(m["lead_id"], {})
        items.append(ActivityItem(
            id=m["id"], sent_at=m["sent_at"], campaign_id=m["campaign_id"],
            campaign_name=camps.get(m["campaign_id"], {}).get("name", "—"), sender_email=semail.get(m["sender_id"], "removed inbox"),
            to_email=m["to_email"], lead_name=f"{l.get('first_name', '')} {l.get('last_name', '')}".strip(),
            subject=m["subject"], step=m.get("step_index", 0) + 1, variant=m.get("variant") or "a",
            opened=bool(m.get("opened_at") or (m.get("open_count") or 0) > 0),
            open_count=int(m.get("open_count") or 0),
            clicked=bool(m.get("clicked_at") or (m.get("click_count") or 0) > 0),
            replied=bool(m.get("replied_at")), bounced=bool(m.get("bounced"))))
    inboxes = []
    for s in senders:
        last = await db.messages.find_one({"sender_id": s["id"]}, {"_id": 0, "sent_at": 1}, sort=[("sent_at", -1)])
        nxt = s.get("next_available_at")
        inboxes.append(InboxSchedule(
            id=s["id"], email=s["email"], status=s["status"],
            sent_today=await db.messages.count_documents({"sender_id": s["id"], "sent_at": {"$gte": start_of_today()}}),
            effective_limit=int(s.get("daily_limit") or 0), last_sent_at=(last or {}).get("sent_at"),
            next_available_at=nxt if nxt and nxt > now() else None))
    active = [c["id"] for c in await db.campaigns.find({"user_id": user["id"], "status": "active", **({"id": campaign_id} if campaign_id else {})}, {"_id": 0, "id": 1}).to_list(1000)]
    upcoming = []
    async for l in db.leads.find({"campaign_id": {"$in": active}, "status": {"$in": ["pending", "in_progress"]}}, {"_id": 0}).sort("next_send_at", 1).limit(10):
        upcoming.append(UpcomingSend(
            lead_email=l["email"], lead_name=f"{l.get('first_name', '')} {l.get('last_name', '')}".strip(),
            campaign_id=l["campaign_id"], campaign_name=camps.get(l["campaign_id"], {}).get("name", "—"),
            step=l.get("current_step", 0) + 1, due_at=l.get("next_send_at")))
    hour = await db.messages.count_documents({**flt, "sent_at": {"$gte": now() - timedelta(hours=1)}})
    return ActivityOut(items=items, inboxes=inboxes, upcoming=upcoming, sent_last_hour=hour)
