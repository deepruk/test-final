"""AI Copywriter — rewrites a sequence step using the user's own OpenAI key.

Keeps the user's template variables intact and returns a strict JSON payload
the frontend swaps straight into the editor.
"""
from __future__ import annotations

import json
import os
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import current_user

router = APIRouter(prefix="/ai", tags=["ai"])


Tone = Literal["professional", "casual", "friendly", "direct"]
Goal = Literal["cold_intro", "followup", "breakup"]
Length = Literal["short", "medium"]


class RewriteStep(BaseModel):
    subject: str = ""
    subject_b: str = ""
    body: str = ""
    preheader: str = ""


class RewriteRequest(BaseModel):
    step: RewriteStep
    tone: Tone = "professional"
    goal: Goal = "cold_intro"
    length: Length = "short"
    product: str = Field(default="", max_length=400)  # one-liner about what you're pitching
    audience: str = Field(default="", max_length=200)  # who you're writing to (e.g. "e‑commerce founders")


class RewriteResponse(BaseModel):
    subject: str
    body: str
    preheader: str


_SYSTEM = """You are a world-class cold-email copywriter.
Rules you MUST follow:
- Return ONLY compact JSON with keys: subject, body, preheader. No markdown, no commentary.
- Preserve every template variable the author uses EXACTLY — tokens like {{first_name}}, {{company}}, {{title}}, {{sender_first_name}} and any {{...}} must appear verbatim.
- Preserve {unsubscribe_link} if present.
- Spintax like {Hi|Hey|Hello} is allowed — keep or write as plain text, never invent new spintax braces.
- No emojis, no exclamation floods, no all-caps lines, no "click here".
- Short subject lines (under 55 chars), lowercase feel.
- Body = plain text, 2–5 short paragraphs separated by blank lines.
- Preheader = ≤90 chars, a specific concrete hook — not a repeat of the subject.
- Do NOT invent facts about the recipient's company; stay generic unless the author provided specifics."""


_LENGTH_HINT = {
    "short": "Body is 60–110 words. Three short paragraphs max.",
    "medium": "Body is 110–180 words. Up to five short paragraphs.",
}
_GOAL_HINT = {
    "cold_intro": "This is a first-touch cold email. Open with a specific hook, land one clear value promise, close with a single soft question.",
    "followup": "This is a follow-up to a previous email that got no reply. Keep it short, reference the prior note briefly, add one new angle, re-ask the same question.",
    "breakup": "This is a break-up / permission-to-close-the-loop email. Acknowledge no reply, offer one final value nudge, make it easy to say 'not now' or 'send later'.",
}


def _build_prompt(req: RewriteRequest) -> str:
    parts = [
        f"Tone: {req.tone}.",
        f"Goal: {req.goal.replace('_', ' ')}.",
        _GOAL_HINT[req.goal],
        _LENGTH_HINT[req.length],
    ]
    if req.product.strip():
        parts.append(f"What we're pitching: {req.product.strip()}")
    if req.audience.strip():
        parts.append(f"Target reader: {req.audience.strip()}")
    original = req.step.body.strip() or "(no draft yet — write from scratch)"
    original_subject = req.step.subject.strip() or "(no draft)"
    parts.append(f"\nOriginal subject:\n{original_subject}")
    parts.append(f"\nOriginal body:\n{original}")
    parts.append("\nReturn ONLY the JSON object now.")
    return "\n".join(parts)


_JSON_BLOCK = re.compile(r"\{[\s\S]*\}")


def _parse_llm_json(text: str) -> dict:
    text = text.strip()
    # Some models wrap JSON in ```json fences.
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = text.rstrip("`").rstrip()
    m = _JSON_BLOCK.search(text)
    if not m:
        raise ValueError("no JSON object in model output")
    return json.loads(m.group(0))


@router.post("/rewrite-step", response_model=RewriteResponse)
async def rewrite_step(req: RewriteRequest, _user=Depends(current_user)) -> RewriteResponse:
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Add OPENAI_API_KEY to backend/.env to use AI rewrite. Grab a key at platform.openai.com → API keys.",
        )
    # Import here so the module loads even when emergentintegrations is temporarily unavailable.
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = (
        LlmChat(api_key=api_key, session_id="rewrite-step", system_message=_SYSTEM)
        .with_model("openai", "gpt-5.2")
    )
    try:
        reply = await chat.send_message(UserMessage(text=_build_prompt(req)))
    except Exception as exc:  # the SDK raises provider-specific errors; map to 502
        msg = str(exc)
        if "invalid_api_key" in msg or "Incorrect API key" in msg or "401" in msg:
            raise HTTPException(status_code=400, detail="That OpenAI key was rejected. Double-check the value in backend/.env.")
        if "rate_limit" in msg or "429" in msg:
            raise HTTPException(status_code=429, detail="OpenAI is rate-limiting your key. Try again in a minute.")
        raise HTTPException(status_code=502, detail=f"OpenAI call failed: {msg[:200]}")

    try:
        data = _parse_llm_json(reply if isinstance(reply, str) else str(reply))
    except Exception:
        raise HTTPException(status_code=502, detail="AI returned a response we couldn't parse. Try again.")

    return RewriteResponse(
        subject=str(data.get("subject", "")).strip()[:200],
        body=str(data.get("body", "")).strip(),
        preheader=str(data.get("preheader", "")).strip()[:140],
    )
