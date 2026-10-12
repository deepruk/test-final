"""Sending health score — a 0–100 reputation measure for each inbox.

Score formula (last 14 days of real sends):
    base = 100
    - bounce_rate * 400     # a 1% bounce rate costs 4 pts, 5% costs 20
    + reply_rate  * 30      # a 5% reply rate adds 1.5 pts, 20% adds 6
    - 10 if the inbox is in "error" status (SMTP/IMAP broken)

Returns the raw metrics so the UI can show "bounced 2.1% · replied 12% of 143 sent".
Idle inboxes (no sends in 14 days) return a neutral 100 so a brand-new inbox doesn't
look broken.
"""
from __future__ import annotations

from datetime import timedelta
from typing import TypedDict

from lib.util import now


class HealthInfo(TypedDict):
    sending_health: int
    bounce_rate_14d: float
    reply_rate_14d: float
    sent_14d: int


async def compute_health(db, sender: dict) -> HealthInfo:
    since = now() - timedelta(days=14)
    base_q = {"sender_id": sender["id"], "sent_at": {"$gte": since}}
    sent = await db.messages.count_documents(base_q)
    if not sent:
        return {"sending_health": 100, "bounce_rate_14d": 0.0, "reply_rate_14d": 0.0, "sent_14d": 0}
    bounced = await db.messages.count_documents({**base_q, "bounced": True})
    replied = await db.messages.count_documents({**base_q, "replied_at": {"$ne": None}})
    br = bounced / sent
    rr = replied / sent
    score = round(100 - br * 400 + rr * 30)
    if sender.get("status") == "error":
        score -= 10
    score = max(0, min(100, score))
    return {
        "sending_health": score,
        "bounce_rate_14d": round(br * 100, 1),
        "reply_rate_14d": round(rr * 100, 1),
        "sent_14d": sent,
    }
