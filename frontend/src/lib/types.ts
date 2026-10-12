// Hand-written mirrors of backend/models/schemas.py — keep in sync.
export interface User {
  id: string;
  name: string;
  email: string;
  default_signature: string;
  created_at: string;
}

export interface WorkspaceUpdate {
  default_signature?: string;
  apply_signature_to_all_inboxes?: boolean;
}

export interface LeadHistoryMessage {
  id: string;
  step_index: number;
  variant: "a" | "b";
  subject: string;
  body: string;
  sender_email: string;
  sender_from_name: string;
  sent_at: string;
  opened_at: string | null;
  open_count: number;
  clicked_at: string | null;
  click_count: number;
  replied_at: string | null;
  bounced: boolean;
  unsubscribed: boolean;
}

export interface LeadHistory {
  lead: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    company: string;
    title: string;
    status: string;
    current_step: number;
    next_send_at: string | null;
  };
  messages: LeadHistoryMessage[];
}

export type SenderStatus = "active" | "error" | "paused" | "demo";

export interface SenderIn {
  email: string;
  from_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "ssl" | "starttls" | "none";
  smtp_user: string;
  smtp_pass: string;
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_pass: string;
  daily_limit: number;
  signatures: string[];
}

export interface SenderUpdate {
  from_name?: string;
  daily_limit?: number;
  status?: "active" | "paused";
  signatures?: string[];
}

export interface Sender {
  id: string;
  auth_type?: "smtp" | "google_oauth" | string;
  email: string;
  from_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_security: string;
  imap_host: string;
  imap_port: number;
  daily_limit: number;
  effective_limit: number;
  signatures: string[];
  sending_health: number;
  bounce_rate_14d: number;
  reply_rate_14d: number;
  sent_14d: number;
  status: SenderStatus;
  last_error: string;
  sent_today: number;
  sent_total: number;
  reply_count: number;
  last_synced_at: string | null;
  created_at: string;
}

export interface ConnectionTest {
  smtp_ok: boolean;
  smtp_error: string;
  imap_ok: boolean;
  imap_error: string;
}

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export interface Step {
  id: string;
  subject: string;
  subject_b: string;
  ab_winner: "a" | "b" | null;
  body: string;
  delay_days: number;
  preheader: string;
  track_opens: boolean | null;
  track_clicks: boolean | null;
}

export interface StatTotals {
  leads: number;
  contacted: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  steps: Step[];
  sender_ids: string[];
  daily_limit: number;
  track_opens: boolean;
  track_clicks: boolean;
  stop_on_reply: boolean;
  include_unsubscribe: boolean;
  custom_fields: string[];
  send_days: number[];
  timezone: string;
  use_lead_timezone: boolean;
  random_start_minutes: number;
  gap_min_minutes: number;
  gap_max_minutes: number;
  send_start_hour: number;
  send_end_hour: number;
  plain_text_only: boolean;
  smart_subject: boolean;
  extra_jitter_minutes: number;
  followup_priority: number;
  created_at: string;
  launched_at: string | null;
  stats: StatTotals;
  progress: number;
}

export type CampaignUpdate = Partial<
  Pick<Campaign, "name" | "steps" | "sender_ids" | "daily_limit" | "track_opens" | "track_clicks" | "stop_on_reply" | "include_unsubscribe" | "send_days" | "timezone" | "use_lead_timezone" | "gap_min_minutes" | "gap_max_minutes" | "random_start_minutes" | "send_start_hour" | "send_end_hour" | "plain_text_only" | "smart_subject" | "extra_jitter_minutes" | "followup_priority">
>;

// --- AI Rewrite --------------------------------------------------------
export type RewriteTone = "professional" | "casual" | "friendly" | "direct";
export type RewriteGoal = "cold_intro" | "followup" | "breakup";
export type RewriteLength = "short" | "medium";

export interface RewriteRequest {
  step: { subject: string; subject_b: string; body: string; preheader: string };
  tone: RewriteTone;
  goal: RewriteGoal;
  length: RewriteLength;
  product?: string;
  audience?: string;
}

export interface RewriteResponse {
  subject: string;
  body: string;
  preheader: string;
}

export type LeadStatus = "pending" | "in_progress" | "completed" | "replied" | "bounced" | "unsubscribed";

export interface LeadIn {
  email: string;
  first_name: string;
  last_name: string;
  company: string;
  title: string;
  timezone: string;
  custom: Record<string, string>;
}

export interface Lead extends LeadIn {
  id: string;
  campaign_id: string;
  status: LeadStatus;
  current_step: number;
  next_send_at: string | null;
  last_sent_at: string | null;
  opened: boolean;
  clicked: boolean;
  created_at: string;
}

export interface LeadImportResult {
  added: number;
  skipped: number;
}

export interface SeriesPoint {
  date: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

export interface VariantStat {
  variant: "a" | "b";
  subject: string;
  sent: number;
  opened: number;
  open_rate: number;
}

export interface StepStat {
  step: number;
  subject: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  ab_winner: "a" | "b" | null;
  variants: VariantStat[];
}

export interface CampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  stats: StatTotals;
}

export interface Analytics {
  totals: StatTotals;
  series: SeriesPoint[];
  campaigns: CampaignRow[];
  steps: StepStat[];
}

export type ThreadLabel = "none" | "interested" | "meeting_booked" | "not_interested" | "out_of_office" | "wrong_person";

export interface Thread {
  id: string;
  lead_id: string;
  campaign_id: string;
  campaign_name: string;
  sender_id: string;
  sender_email: string;
  contact_email: string;
  contact_name: string;
  company: string;
  subject: string;
  snippet: string;
  last_at: string;
  unread: boolean;
  label: ThreadLabel;
}

export interface ThreadMessage {
  id: string;
  direction: "in" | "out";
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
  at: string;
  kind: "campaign" | "reply" | "manual";
}

export interface ThreadDetail {
  thread: Thread;
  messages: ThreadMessage[];
}

export interface InboxCounts {
  all: number;
  unread: number;
  interested: number;
  meeting_booked: number;
  not_interested: number;
  out_of_office: number;
  wrong_person: number;
}

export interface SyncResult {
  new_replies: number;
  errors: string[];
}

export interface Notification {
  id: string;
  thread_id: string;
  label: ThreadLabel;
  contact_name: string;
  company: string;
  snippet: string;
  campaign_name: string;
  created_at: string;
  read: boolean;
}

export interface NotificationList {
  items: Notification[];
  unread: number;
}

export interface CampaignLive {
  capacity_used_pct: number;
  sent_today: number;
  daily_capacity: number;
  active_sequences: number;
  sent_last_30m: number;
  next_email_at: string | null;
  next_note: string;
}

export interface ActivityItem {
  id: string;
  sent_at: string;
  campaign_id: string;
  campaign_name: string;
  sender_email: string;
  to_email: string;
  lead_name: string;
  subject: string;
  step: number;
  variant: string;
  opened: boolean;
  open_count: number;
  clicked: boolean;
  replied: boolean;
  bounced: boolean;
}

export interface InboxSchedule {
  id: string;
  email: string;
  status: SenderStatus;
  sent_today: number;
  effective_limit: number;
  last_sent_at: string | null;
  next_available_at: string | null;
}

export interface UpcomingSend {
  lead_email: string;
  lead_name: string;
  campaign_id: string;
  campaign_name: string;
  step: number;
  due_at: string | null;
}

export interface ActivityData {
  items: ActivityItem[];
  inboxes: InboxSchedule[];
  upcoming: UpcomingSend[];
  sent_last_hour: number;
}
