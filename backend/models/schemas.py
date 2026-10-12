"""Pydantic v2 models — every one has a hand-written TS twin in frontend/src/lib/types.ts."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

# ---------- auth ----------
class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    created_at: datetime


# ---------- senders ----------
SenderStatus = Literal["active", "error", "paused", "demo"]


class SenderIn(BaseModel):
    email: EmailStr
    from_name: str = ""
    smtp_host: str
    smtp_port: int = 587
    smtp_security: Literal["ssl", "starttls", "none"] = "starttls"
    smtp_user: str
    smtp_pass: str
    imap_host: str = ""
    imap_port: int = 993
    imap_user: str = ""
    imap_pass: str = ""
    daily_limit: int = Field(default=40, ge=1, le=2000)
    warmup_enabled: bool = False
    warmup_start: int = Field(default=5, ge=1, le=500)
    warmup_increment: int = Field(default=3, ge=1, le=200)
    signatures: list[str] = Field(default_factory=list, max_length=5)


class SenderUpdate(BaseModel):
    from_name: Optional[str] = None
    daily_limit: Optional[int] = Field(default=None, ge=1, le=2000)
    status: Optional[Literal["active", "paused"]] = None
    smtp_pass: Optional[str] = None
    imap_pass: Optional[str] = None
    warmup_enabled: Optional[bool] = None
    warmup_start: Optional[int] = Field(default=None, ge=1, le=500)
    warmup_increment: Optional[int] = Field(default=None, ge=1, le=200)
    signatures: Optional[list[str]] = Field(default=None, max_length=5)


class SenderOut(BaseModel):
    id: str
    auth_type: str = "smtp"
    email: str
    from_name: str
    smtp_host: str
    smtp_port: int
    smtp_security: str
    imap_host: str
    imap_port: int
    daily_limit: int
    effective_limit: int = 0
    warmup_enabled: bool = False
    warmup_start: int = 5
    warmup_increment: int = 3
    warmup_day: int = 0
    signatures: list[str] = []
    status: SenderStatus
    last_error: str = ""
    sent_today: int = 0
    sent_total: int = 0
    reply_count: int = 0
    last_synced_at: Optional[datetime] = None
    created_at: datetime


class ConnectionTestOut(BaseModel):
    smtp_ok: bool
    smtp_error: str = ""
    imap_ok: bool
    imap_error: str = ""


# ---------- campaigns ----------
CampaignStatus = Literal["draft", "active", "paused", "completed"]


class Step(BaseModel):
    id: str
    subject: str = ""
    subject_b: str = ""
    ab_winner: Optional[Literal["a", "b"]] = None
    body: str = ""
    delay_days: int = Field(default=0, ge=0, le=60)
    preheader: str = ""
    track_opens: Optional[bool] = None
    track_clicks: Optional[bool] = None


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CampaignUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    steps: Optional[list[Step]] = None
    sender_ids: Optional[list[str]] = None
    daily_limit: Optional[int] = Field(default=None, ge=1, le=5000)
    track_opens: Optional[bool] = None
    track_clicks: Optional[bool] = None
    stop_on_reply: Optional[bool] = None
    include_unsubscribe: Optional[bool] = None
    send_days: Optional[list[int]] = Field(default=None, max_length=7)
    timezone: Optional[str] = None
    use_lead_timezone: Optional[bool] = None
    random_start_minutes: Optional[int] = Field(default=None, ge=0, le=180)
    gap_min_minutes: Optional[int] = Field(default=None, ge=0, le=240)
    gap_max_minutes: Optional[int] = Field(default=None, ge=0, le=240)
    send_start_hour: Optional[int] = Field(default=None, ge=0, le=23)
    send_end_hour: Optional[int] = Field(default=None, ge=1, le=24)
    plain_text_only: Optional[bool] = None
    smart_subject: Optional[bool] = None
    extra_jitter_minutes: Optional[int] = Field(default=None, ge=0, le=30)


class StatTotals(BaseModel):
    leads: int = 0
    contacted: int = 0
    sent: int = 0
    opened: int = 0
    clicked: int = 0
    replied: int = 0
    bounced: int = 0
    unsubscribed: int = 0
    open_rate: float = 0
    click_rate: float = 0
    reply_rate: float = 0
    bounce_rate: float = 0


class CampaignOut(BaseModel):
    id: str
    name: str
    status: CampaignStatus
    steps: list[Step]
    sender_ids: list[str]
    daily_limit: int
    track_opens: bool
    track_clicks: bool
    stop_on_reply: bool
    include_unsubscribe: bool = True
    custom_fields: list[str] = []
    send_days: list[int] = [0, 1, 2, 3, 4, 5, 6]
    timezone: str = "UTC"
    use_lead_timezone: bool = False
    random_start_minutes: int = 0
    gap_min_minutes: int = 10
    gap_max_minutes: int = 15
    send_start_hour: int
    send_end_hour: int
    plain_text_only: bool = False
    smart_subject: bool = False
    extra_jitter_minutes: int = 0
    created_at: datetime
    launched_at: Optional[datetime] = None
    stats: StatTotals
    progress: float = 0


# ---------- leads ----------
LeadStatus = Literal["pending", "in_progress", "completed", "replied", "bounced", "unsubscribed"]


class LeadIn(BaseModel):
    email: EmailStr
    first_name: str = ""
    last_name: str = ""
    company: str = ""
    title: str = ""
    timezone: str = ""
    custom: dict[str, str] = {}


class LeadImport(BaseModel):
    leads: list[LeadIn] = Field(max_length=10000)


class LeadImportResult(BaseModel):
    added: int
    skipped: int


class LeadOut(BaseModel):
    id: str
    campaign_id: str
    email: str
    first_name: str
    last_name: str
    company: str
    title: str
    timezone: str = ""
    custom: dict[str, str] = {}
    status: LeadStatus
    current_step: int
    next_send_at: Optional[datetime] = None
    last_sent_at: Optional[datetime] = None
    opened: bool = False
    clicked: bool = False
    created_at: datetime


# ---------- analytics ----------
class SeriesPoint(BaseModel):
    date: str
    sent: int = 0
    opened: int = 0
    clicked: int = 0
    replied: int = 0


class VariantStat(BaseModel):
    variant: Literal["a", "b"]
    subject: str
    sent: int = 0
    opened: int = 0
    open_rate: float = 0


class StepStat(BaseModel):
    step: int
    subject: str
    sent: int = 0
    opened: int = 0
    clicked: int = 0
    replied: int = 0
    ab_winner: Optional[Literal["a", "b"]] = None
    variants: list[VariantStat] = []


class CampaignRow(BaseModel):
    id: str
    name: str
    status: CampaignStatus
    stats: StatTotals


class AnalyticsOut(BaseModel):
    totals: StatTotals
    series: list[SeriesPoint]
    campaigns: list[CampaignRow]
    steps: list[StepStat]


# ---------- inbox ----------
ThreadLabel = Literal["none", "interested", "meeting_booked", "not_interested", "out_of_office", "wrong_person"]


class ThreadOut(BaseModel):
    id: str
    lead_id: str
    campaign_id: str
    campaign_name: str = ""
    sender_id: str
    sender_email: str = ""
    contact_email: str
    contact_name: str
    company: str = ""
    subject: str
    snippet: str
    last_at: datetime
    unread: bool
    label: ThreadLabel


class ThreadMessage(BaseModel):
    id: str
    direction: Literal["in", "out"]
    from_email: str
    to_email: str
    subject: str
    body: str
    at: datetime
    kind: Literal["campaign", "reply", "manual"] = "reply"


class ThreadDetail(BaseModel):
    thread: ThreadOut
    messages: list[ThreadMessage]


class ThreadUpdate(BaseModel):
    label: Optional[ThreadLabel] = None
    unread: Optional[bool] = None


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=20000)


class InboxCounts(BaseModel):
    all: int = 0
    unread: int = 0
    interested: int = 0
    meeting_booked: int = 0
    not_interested: int = 0
    out_of_office: int = 0
    wrong_person: int = 0


class SyncResult(BaseModel):
    new_replies: int
    errors: list[str]


# ---------- notifications ----------
class Notification(BaseModel):
    id: str
    thread_id: str
    label: ThreadLabel
    contact_name: str
    company: str = ""
    snippet: str
    campaign_name: str = ""
    created_at: datetime
    read: bool


class NotificationList(BaseModel):
    items: list[Notification]
    unread: int


class CampaignLive(BaseModel):
    capacity_used_pct: float
    sent_today: int
    daily_capacity: int
    active_sequences: int
    sent_last_30m: int
    next_email_at: Optional[datetime] = None
    next_note: str = ""


class ActivityItem(BaseModel):
    id: str
    sent_at: datetime
    campaign_id: str
    campaign_name: str
    sender_email: str
    to_email: str
    lead_name: str
    subject: str
    step: int
    variant: str = "a"
    opened: bool
    open_count: int = 0
    clicked: bool
    replied: bool
    bounced: bool


class InboxSchedule(BaseModel):
    id: str
    email: str
    status: SenderStatus
    sent_today: int
    effective_limit: int
    last_sent_at: Optional[datetime] = None
    next_available_at: Optional[datetime] = None


class UpcomingSend(BaseModel):
    lead_email: str
    lead_name: str
    campaign_id: str
    campaign_name: str
    step: int
    due_at: Optional[datetime] = None


class ActivityOut(BaseModel):
    items: list[ActivityItem]
    inboxes: list[InboxSchedule]
    upcoming: list[UpcomingSend]
    sent_last_hour: int
