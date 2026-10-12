"""Background workers: campaign sender + IMAP reply sync."""
import asyncio
import hashlib
import logging
import random
import os
import re
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from lib import mailer
from lib.db import db
from lib.util import new_id, now, start_of_today, warmup_info

log = logging.getLogger("engine")
OOO_RE = re.compile(r"out of (the )?office|automatic reply|auto(-| )?reply|on vacation|on leave", re.I)
NOT_RE = re.compile(r"not interested|no thanks|no, thanks|remove me|unsubscribe|stop emailing|take me off|don'?t contact|not a fit|not looking", re.I)
WRONG_RE = re.compile(r"not the right person|wrong person|no longer (work|with)|reach out to (our|my)", re.I)
MEETING_RE = re.compile(r"\b(booked|scheduled|calendar invite|send (me |over )?an? invite|see you (on|then)|(monday|tuesday|wednesday|thursday|friday) at \d|works for me|let'?s (meet|talk|chat|connect|do it)|happy to (chat|talk|meet|jump)|book(ed)? a (slot|time|call|meeting))", re.I)
INTEREST_RE = re.compile(r"\b(interested|sounds (good|great|interesting)|tell me more|send (over )?(more )?(info|details|pricing|case stud)|pricing|how much|curious|open to|keen|let me know more|what does .* look like|demo)\b", re.I)
HOT_LABELS = {"interested", "meeting_booked"}


def classify_reply(subject: str, body: str) -> str | None:
    """Keyword triage of an inbound reply → thread label (None = leave unlabeled)."""
    text = f"{subject}\n{body[:1500]}"
    if OOO_RE.search(text):
        return "out_of_office"
    if NOT_RE.search(text):
        return "not_interested"
    if WRONG_RE.search(text):
        return "wrong_person"
    if MEETING_RE.search(text):
        return "meeting_booked"
    if INTEREST_RE.search(text):
        return "interested"
    return None


async def notify_hot_reply(user_id: str, thread_id: str, label: str, contact_name: str, company: str,
                           snippet: str, campaign_id: str) -> None:
    camp = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "name": 1}) or {}
    await db.notifications.insert_one({
        "id": new_id(), "user_id": user_id, "thread_id": thread_id, "label": label,
        "contact_name": contact_name, "company": company, "snippet": snippet,
        "campaign_name": camp.get("name", ""), "created_at": now(), "read": False,
    })
BOUNCE_FROM = ("mailer-daemon", "postmaster")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
AB_MIN_SENDS = int(os.environ.get("AB_MIN_SENDS", "20"))  # per variant before a winner is picked
UNSUB_FOOTER = "\n\n--\nNot interested? Unsubscribe here: {url}"


def base_url() -> str:
    """Absolute public origin used in email tracking links and pixels.

    Email clients cannot reliably load relative image URLs. Use the backend public
    URL as a production fallback so the tracking pixel is reachable even when
    PUBLIC_BASE_URL / APP_URL have not been configured in Render.
    """
    configured = os.environ.get("PUBLIC_BASE_URL") or os.environ.get("APP_URL")
    return (configured or "https://outreachforge.onrender.com").rstrip("/")


async def sent_today(sender_id: str) -> int:
    return await db.messages.count_documents({"sender_id": sender_id, "sent_at": {"$gte": start_of_today()}})


async def deliver(sender: dict, to: str, subject: str, html: str, text: str, in_reply_to: str | None,
                  unsubscribe_url: str | None = None, plain_only: bool = False) -> str:
    """Real SMTP for real senders; demo senders simulate delivery."""
    if sender.get("status") == "demo":
        return f"<{new_id()}@{sender['email'].split('@')[-1]}>"
    return await asyncio.to_thread(mailer.send_email, sender, to, subject, html, text, in_reply_to, unsubscribe_url, plain_only)


async def pick_variant(c: dict, idx: int, step: dict) -> str:
    """A/B subject: split evenly until both variants reach AB_MIN_SENDS, then lock in the higher open rate."""
    if not (step.get("subject_b") or "").strip():
        return "a"
    winner, sent = await decide_winner(c, idx, step)
    if winner:
        return winner
    return "a" if sent["a"] <= sent["b"] else "b"


async def decide_winner(c: dict, idx: int, step: dict) -> tuple[str | None, dict]:
    """Lock in the higher-open-rate subject once both variants have AB_MIN_SENDS sends."""
    if step.get("ab_winner") in ("a", "b"):
        return step["ab_winner"], {"a": 0, "b": 0}
    base = {"campaign_id": c["id"], "step_index": idx}
    sent = {v: await db.messages.count_documents({**base, "variant": v}) for v in ("a", "b")}
    if min(sent.values()) < AB_MIN_SENDS:
        return None, sent
    opened = {v: await db.messages.count_documents({**base, "variant": v, "opened_at": {"$ne": None}}) for v in ("a", "b")}
    winner = "b" if opened["b"] / sent["b"] > opened["a"] / sent["a"] else "a"
    await db.campaigns.update_one({"id": c["id"]}, {"$set": {f"steps.{idx}.ab_winner": winner}})
    step["ab_winner"] = winner
    log.info("A/B winner for campaign %s step %s: %s", c["id"], idx + 1, winner)
    return winner, sent


async def unsubscribe_message(mid: str) -> bool:
    m = await db.messages.find_one({"id": mid}, {"_id": 0})
    if not m:
        return False
    await db.messages.update_one({"id": mid}, {"$set": {"unsubscribed": True}})
    await db.unsubscribes.update_one(
        {"user_id": m["user_id"], "email": m["to_email"].lower()},
        {"$setOnInsert": {"id": new_id(), "at": now(), "campaign_id": m["campaign_id"]}}, upsert=True)
    await db.leads.update_many(
        {"user_id": m["user_id"], "email": m["to_email"].lower(), "status": {"$in": ["pending", "in_progress", "completed"]}},
        {"$set": {"status": "unsubscribed", "next_send_at": None}})
    return True


def zone(name: str | None) -> ZoneInfo | None:
    try:
        return ZoneInfo(name) if name else None
    except (ZoneInfoNotFoundError, ValueError):
        return None


def lead_tz(c: dict, lead: dict) -> ZoneInfo:
    return (zone(lead.get("timezone")) if c.get("use_lead_timezone") else None) or zone(c.get("timezone")) or ZoneInfo("UTC")


def start_offset(sender_id: str, day: str, max_minutes: int) -> int:
    """Stable per-inbox, per-day random delay (minutes) added to the window start."""
    if max_minutes <= 0:
        return 0
    return int(hashlib.sha256(f"{sender_id}:{day}".encode()).hexdigest(), 16) % (max_minutes + 1)


def sender_started(c: dict, sender: dict, lead: dict) -> bool:
    local = now().astimezone(lead_tz(c, lead))
    off = start_offset(sender["id"], local.date().isoformat(), int(c.get("random_start_minutes", 0)))
    return local.hour * 60 + local.minute >= c.get("send_start_hour", 0) * 60 + off


def in_send_window(c: dict, lead: dict) -> bool:
    """Sending calendar: allowed weekday + hour range, in the lead's timezone (if enabled) else the campaign's."""
    local = now().astimezone(lead_tz(c, lead))
    days = c.get("send_days")
    if days is not None and local.weekday() not in days:
        return False
    return c.get("send_start_hour", 0) <= local.hour < c.get("send_end_hour", 24)


def gap_range(c: dict) -> tuple[int, int]:
    lo, hi = int(c.get("gap_min_minutes", 10)), int(c.get("gap_max_minutes", 15))
    return min(lo, hi), max(lo, hi)


def sender_ready(s: dict) -> bool:
    t = s.get("next_available_at")
    return t is None or t <= now()


async def process_campaign(c: dict) -> None:
    n = now()
    if c.get("send_days") == []:
        return
    steps = c.get("steps") or []
    if not steps:
        return
    camp_today = await db.messages.count_documents({"campaign_id": c["id"], "sent_at": {"$gte": start_of_today()}})
    budget = c.get("daily_limit", 50) - camp_today
    if budget <= 0:
        return
    senders = await db.senders.find({"id": {"$in": c.get("sender_ids", [])}, "status": {"$in": ["active", "demo"]}}, {"_id": 0}).to_list(100)
    if not senders:
        return
    capacity = {s["id"]: warmup_info(s)[0] - await sent_today(s["id"]) for s in senders}
    leads = await db.leads.find(
        {"campaign_id": c["id"], "status": {"$in": ["pending", "in_progress"]}, "next_send_at": {"$lte": n}},
        {"_id": 0},
    ).sort("next_send_at", 1).to_list(200)
    sent_now = 0
    for lead in leads:
        if sent_now >= min(budget, 25):
            break
        if not in_send_window(c, lead):
            continue
        avail = [s for s in senders if capacity.get(s["id"], 0) > 0 and sender_ready(s) and sender_started(c, s, lead)]
        if not avail:
            break
        idx = lead.get("current_step", 0)
        if idx >= len(steps):
            await db.leads.update_one({"id": lead["id"]}, {"$set": {"status": "completed"}})
            continue
        # keep one sender per lead so follow-ups thread correctly
        sender = next((s for s in avail if s["id"] == lead.get("sender_id")), None) if lead.get("sender_id") else None
        if lead.get("sender_id") and sender is None:
            if any(s["id"] == lead["sender_id"] for s in senders):
                continue  # assigned sender is out of quota today
            sender = max(avail, key=lambda s: capacity[s["id"]])
        sender = sender or max(avail, key=lambda s: capacity[s["id"]])
        if await db.unsubscribes.find_one({"user_id": c["user_id"], "email": lead["email"]}):
            await db.leads.update_one({"id": lead["id"]}, {"$set": {"status": "unsubscribed", "next_send_at": None}})
            continue
        step = steps[idx]
        # known CSV columns render empty (or their |fallback) for leads that lack a value
        lead = {**lead, "custom": {**{f: "" for f in c.get("custom_fields") or []}, **(lead.get("custom") or {})}}
        first = await db.messages.find_one({"lead_id": lead["id"], "step_index": 0}, {"_id": 0})
        variant = await pick_variant(c, idx, step)
        mid = new_id()
        unsub_url = f"{base_url()}/api/u/{mid}"
        raw_subject = step.get("subject_b") if variant == "b" else step.get("subject")
        subject = mailer.spin(mailer.render_vars(raw_subject or "", lead))
        if not subject.strip():
            subject = "Re: " + (first["subject"] if first else "Quick question")
        raw_body = step.get("body") or ""
        body = mailer.spin(mailer.render_vars(raw_body, lead, {"unsubscribe_link": unsub_url}))
        # Per-inbox signature rotation — stable per lead so follow-ups keep the same sign-off.
        sigs = [s for s in (sender.get("signatures") or []) if (s or "").strip()]
        if sigs:
            seed = int(hashlib.sha256(f"{sender['id']}:{lead['id']}".encode()).hexdigest(), 16)
            sig = sigs[seed % len(sigs)]
            if sig.strip() and sig.strip() not in body:
                body = body.rstrip() + "\n\n" + sig.strip() + "\n"
        if c.get("include_unsubscribe", True) and "unsubscribe_link" not in raw_body:
            body += UNSUB_FOOTER.format(url=unsub_url)
        # Smart subject: don't accumulate "Re: Re:" prefixes on follow-ups.
        if c.get("smart_subject") and subject:
            subject = re.sub(r"^(?:\s*re\s*:\s*)+", "Re: ", subject, flags=re.I).strip() or subject
        # Per-step tracking overrides (None = inherit campaign default).
        s_opens = step.get("track_opens")
        s_clicks = step.get("track_clicks")
        track_opens = c.get("track_opens", True) if s_opens is None else bool(s_opens)
        track_clicks = c.get("track_clicks", True) if s_clicks is None else bool(s_clicks)
        plain_only = bool(c.get("plain_text_only"))
        if plain_only:
            # Plain-text-only mode disables all tracking — no pixel, raw URLs.
            track_opens = False
            track_clicks = False
        html = mailer.build_html(body, mid, base_url(), track_opens, track_clicks, preheader=step.get("preheader", ""))
        try:
            header_id = await deliver(sender, lead["email"], subject, html, body,
                                      first["message_id_header"] if first else None,
                                      unsub_url if c.get("include_unsubscribe", True) else None,
                                      plain_only=plain_only)
        except Exception as e:  # noqa: BLE001
            err = str(e)[:300]
            log.warning("send failed %s -> %s: %s", sender["email"], lead["email"], err)
            if "recipient" in err.lower() or "550" in err or "553" in err:
                await db.leads.update_one({"id": lead["id"]}, {"$set": {"status": "bounced"}})
            else:
                await db.senders.update_one({"id": sender["id"]}, {"$set": {"status": "error", "last_error": err}})
                senders = [s for s in senders if s["id"] != sender["id"]]
            continue
        await db.messages.insert_one({
            "id": mid, "user_id": c["user_id"], "campaign_id": c["id"], "lead_id": lead["id"],
            "sender_id": sender["id"], "step_index": idx, "variant": variant, "to_email": lead["email"], "subject": subject,
            "body": body, "message_id_header": header_id, "sent_at": now(), "opened_at": None,
            "open_count": 0, "last_opened_at": None, "clicked_at": None, "click_count": 0,
            "last_clicked_at": None, "replied_at": None, "bounced": False,
        })
        capacity[sender["id"]] -= 1
        sent_now += 1
        # gap: this inbox rests a random min–max minutes before its next email (any campaign)
        lo, hi = gap_range(c)
        sender["next_available_at"] = now() + timedelta(seconds=random.uniform(lo * 60, hi * 60))
        await db.senders.update_one({"id": sender["id"]}, {"$set": {"next_available_at": sender["next_available_at"]}})
        nxt = idx + 1
        upd: dict = {"current_step": nxt, "last_sent_at": now(), "last_subject": subject, "sender_id": sender["id"]}
        if nxt >= len(steps):
            upd.update(status="completed", next_send_at=None)
        else:
            # Extra jitter (opt-in) shifts the next send by up to ±N minutes so follow-ups
            # don't line up on a predictable "exactly N days later" slot.
            jitter_m = int(c.get("extra_jitter_minutes", 0) or 0)
            jitter = timedelta(seconds=random.uniform(-jitter_m * 60, jitter_m * 60)) if jitter_m else timedelta(0)
            upd.update(status="in_progress", next_send_at=now() + timedelta(days=steps[nxt].get("delay_days", 1)) + jitter)
        await db.leads.update_one({"id": lead["id"]}, {"$set": upd})
    remaining = await db.leads.count_documents({"campaign_id": c["id"], "status": {"$in": ["pending", "in_progress"]}})
    if remaining == 0:
        await db.campaigns.update_one({"id": c["id"]}, {"$set": {"status": "completed"}})


async def send_tick() -> None:
    async for c in db.campaigns.find({"status": "active"}, {"_id": 0}):
        try:
            await process_campaign(c)
        except Exception:  # noqa: BLE001
            log.exception("campaign %s failed", c.get("id"))


async def record_reply(user_id: str, lead: dict, sender_id: str, subject: str, body: str,
                       message_id: str, from_email: str, to_email: str) -> bool:
    if message_id and await db.thread_messages.find_one({"message_id": message_id, "user_id": user_id}):
        return False
    at = now()
    snippet = " ".join(body.split())[:160]
    label = classify_reply(subject, body)
    thread = await db.threads.find_one({"user_id": user_id, "lead_id": lead["id"]}, {"_id": 0})
    if thread:
        upd = {"snippet": snippet, "last_at": at, "unread": True}
        if label and (thread.get("label") in ("none", "out_of_office") or label in HOT_LABELS):
            upd["label"] = label
        contact_name = thread["contact_name"]
        await db.threads.update_one({"id": thread["id"]}, {"$set": upd})
        tid = thread["id"]
    else:
        tid = new_id()
        await db.threads.insert_one({
            "id": tid, "user_id": user_id, "lead_id": lead["id"], "campaign_id": lead["campaign_id"],
            "sender_id": sender_id, "contact_email": lead["email"],
            "contact_name": f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip() or lead["email"],
            "company": lead.get("company", ""), "subject": subject, "snippet": snippet, "last_at": at,
            "unread": True, "label": label or "none",
        })
        contact_name = f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip() or lead["email"]
    await db.thread_messages.insert_one({
        "id": new_id(), "user_id": user_id, "thread_id": tid, "direction": "in", "from_email": from_email,
        "to_email": to_email, "subject": subject, "body": body, "at": at, "message_id": message_id, "kind": "reply",
    })
    if label in HOT_LABELS:
        await notify_hot_reply(user_id, tid, label, contact_name, lead.get("company", ""), snippet, lead["campaign_id"])
    camp = await db.campaigns.find_one({"id": lead["campaign_id"]}, {"_id": 0, "stop_on_reply": 1})
    if label != "out_of_office" and (camp or {}).get("stop_on_reply", True):
        await db.leads.update_one({"id": lead["id"]}, {"$set": {"status": "replied", "next_send_at": None}})
    last = await db.messages.find({"lead_id": lead["id"]}, {"_id": 0, "id": 1, "replied_at": 1}).sort("sent_at", -1).to_list(1)
    if last and not last[0].get("replied_at") and label != "out_of_office":
        await db.messages.update_one({"id": last[0]["id"]}, {"$set": {"replied_at": at}})
        await db.campaigns.update_one({"id": lead["campaign_id"]}, {"$inc": {"replies": 1}})
    return True


async def sync_sender(sender: dict) -> int:
    msgs, max_uid = await asyncio.to_thread(mailer.fetch_new, sender, int(sender.get("last_uid") or 0))
    uid = sender["user_id"]
    count = 0
    for m in msgs:
        if m["from_email"] == sender["email"].lower():
            continue
        if any(b in m["from_email"] for b in BOUNCE_FROM) or any(
            marker in (m.get("subject") or "").lower()
            for marker in ("undeliverable", "delivery status notification", "delivery failure")
        ):
            for addr in set(EMAIL_RE.findall(m.get("body", ""))):
                lead = await db.leads.find_one(
                    {"user_id": uid, "email": addr.lower(), "status": {"$in": ["in_progress", "completed"]}},
                    {"_id": 0},
                )
                if lead:
                    await db.leads.update_one(
                        {"id": lead["id"]}, {"$set": {"status": "bounced", "next_send_at": None}}
                    )
                    await db.messages.update_many({"lead_id": lead["id"]}, {"$set": {"bounced": True}})
                    await db.campaigns.update_one({"id": lead["campaign_id"]}, {"$inc": {"bounces": 1}})
            continue
        lead = None
        refs = [r for r in (m["in_reply_to"] + " " + m["references"]).split() if r]
        if refs:
            orig = await db.messages.find_one({"user_id": uid, "message_id_header": {"$in": refs}}, {"_id": 0, "lead_id": 1})
            if orig:
                lead = await db.leads.find_one({"id": orig["lead_id"]}, {"_id": 0})
        if not lead:
            # Match the exact sender address, then use recent send history as a fallback.
            recent = await db.leads.find(
                {"user_id": uid, "email": m["from_email"], "current_step": {"$gt": 0}},
                {"_id": 0},
            ).sort("last_sent_at", -1).to_list(50)
            if len(recent) == 1:
                lead = recent[0]
            elif recent:
                incoming_subject = " ".join((m.get("subject") or "").strip().split()).lower()
                def normalise_subject(value: str) -> str:
                    value = " ".join((value or "").strip().split()).lower()
                    while True:
                        updated = value
                        for prefix in ("re:", "fw:", "fwd:"):
                            if value.startswith(prefix):
                                value = value[len(prefix):].strip()
                        if value == updated:
                            return value
                matching = [
                    candidate for candidate in recent
                    if normalise_subject(candidate.get("last_subject", "")) == normalise_subject(incoming_subject)
                    and candidate.get("last_subject")
                ]
                lead = matching[0] if matching else recent[0]
        if not lead:
            continue
        body = mailer.strip_quoted(m["body"])
        normalized_subject = " ".join((m.get("subject") or "").strip().split())
        reply_subject = normalized_subject if normalized_subject.lower().startswith("re:") else f"Re: {normalized_subject or lead.get('last_subject') or 'your message'}"
        if await record_reply(uid, lead, sender["id"], reply_subject, body, m["message_id"], m["from_email"], sender["email"]):
            count += 1
    await db.senders.update_one({"id": sender["id"]}, {"$set": {"last_uid": max_uid, "last_synced_at": now()}})
    return count


async def sync_user(user_id: str) -> tuple[int, list[str]]:
    total, errors = 0, []
    async for s in db.senders.find({"user_id": user_id, "$or": [{"imap_host": {"$ne": ""}}, {"auth_type": "google_oauth"}], "status": {"$in": ["active", "error"]}}, {"_id": 0}):
        try:
            total += await sync_sender(s)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{s['email']}: {str(e)[:200]}")
    return total, errors


async def sync_tick() -> None:
    async for s in db.senders.find({"$or": [{"imap_host": {"$ne": ""}}, {"auth_type": "google_oauth"}], "status": "active"}, {"_id": 0}):
        try:
            await sync_sender(s)
        except Exception as e:  # noqa: BLE001
            log.warning("imap sync %s: %s", s.get("email"), e)


async def run_forever() -> None:
    i = 0
    while True:
        try:
            await send_tick()
            if i % 2 == 0:  # IMAP reply sync every ~60s
                await sync_tick()
        except Exception:  # noqa: BLE001
            log.exception("engine tick failed")
        i += 1
        await asyncio.sleep(30)
