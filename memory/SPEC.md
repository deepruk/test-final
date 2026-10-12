# OutreachForge — App Spec

Cold email outreach platform (Instantly/Smartlead-style) on FastAPI + Mongo + React.

## Pages
- `/` landing, `/login`, `/signup` (email+password, httpOnly JWT cookie `of_session`)
- `/dashboard` KPIs (14d), performance chart, latest replies, campaigns, sender health
- `/campaigns` list + New campaign dialog (`?new=1`); `/campaigns/:id` tabs: overview | leads | sequence | settings (`?tab=`)
- `/inbox` Master Inbox — folders (labels), thread list, thread view, label select, reply composer, Sync inboxes
- `/senders` sender accounts (SMTP/IMAP), presets, test connection, pause/remove
- `/analytics` range 7/14/30/90d, chart, funnel, campaign comparison

## Data model (Mongo, string uuid `id`)
users, senders (smtp/imap creds, daily_limit, status active|error|paused|demo), campaigns (steps[{id,subject,body,delay_days}], sender_ids, daily_limit, track_opens, track_clicks, stop_on_reply, send_start_hour/end_hour UTC, status draft|active|paused|completed), leads (campaign_id, status pending|in_progress|completed|replied|bounced, current_step, next_send_at, sender_id), messages (outbound: step_index, sent_at, opened_at, clicked_at, replied_at, bounced, message_id_header), threads (per lead reply conversation, label, unread), thread_messages (in/out).

## Engine (backend/lib/engine.py)
Background loop every 30s: for active campaigns sends due leads via SMTP (rotating senders, per-sender + per-campaign daily caps, send window). Follow-ups thread via In-Reply-To. Every ~2 min IMAP sync of active senders → replies matched by In-Reply-To/References or from-address → thread created, lead marked replied (stop on reply), OOO auto-labeled, mailer-daemon bounces mark lead bounced.
Senders with status `demo` SIMULATE delivery (no SMTP) — used by seeded demo data only.
Tracking: `/api/t/o/{message_id}.gif` (open pixel), `/api/t/c/{message_id}?u=<url>` (click redirect). Base URL = env PUBLIC_BASE_URL.

## Seed (`cd /app/backend && python seed.py`, idempotent — resets demo workspace)
Demo user demo@outreachforge.io / Demo@1234; 3 demo senders; 4 campaigns: "Q3 SaaS Founders Outreach" (active, 70 leads), "Agency Partnerships" (paused, 45), "Series A CTOs — Infra" (completed, 55), "E-commerce Brands Holiday" (draft, 25 leads, no sends); ~30+ reply threads with labels.

## Iteration 2 features
- **Unsubscribe**: campaign `include_unsubscribe` (default on) appends footer "Not interested? Unsubscribe here: <PUBLIC_BASE_URL>/api/u/{message_id}" unless body uses `{{unsubscribe_link}}`; also sets List-Unsubscribe + List-Unsubscribe-Post headers. GET/POST `/api/u/{mid}` (public) → message.unsubscribed=true, adds `unsubscribes` (user_id,email) blocklist, marks all that user's leads with the email `unsubscribed`. Engine skips blocklisted; imports of blocklisted emails get status unsubscribed. Unsubscribe URLs are never click-tracked. StatTotals.unsubscribed.
- **Warm-up ramp**: sender `warmup_enabled/warmup_start/warmup_increment/warmup_started_at`; effective_limit = min(daily_limit, start + increment*days_since_start) (lib/util.warmup_info). Engine uses effective_limit. Edit via Senders card menu "Limits & warm-up". Seed: sam@outreachforgehq.com has warm-up on (day 7). NOTE: this is a sending ramp, not a peer warm-up email network.
- **A/B subjects**: Step `subject_b`, `ab_winner`. 50/50 split until both variants have AB_MIN_SENDS (env, default 20) sends, then higher open rate wins and is sent to all (decided in engine and on GET /campaigns/{id}/analytics). Editing either subject resets the winner. messages.variant. StepStat.variants.
- **Custom fields**: LeadIn.custom dict; any extra CSV column → normalized key (lowercase, non-alnum→_) → `{{key}}`; campaign.custom_fields list. `{{key|fallback}}` syntax supported. Seed leads have custom `city`.

## Iteration 3 features
- **Hot reply alerts**: inbound replies are keyword-classified (engine.classify_reply: out_of_office > not_interested > wrong_person > meeting_booked > interested). interested/meeting_booked create a `notifications` doc. API: GET /api/notifications {items, unread}, POST /notifications/read-all, POST /notifications/{id}/read, POST /notifications/test (sample alert from latest hot thread). Frontend NotificationBell (top bar) polls every 15s, toasts new alerts with "Reply now" → /inbox?t=, optional browser desktop notifications. IMAP sync now every ~60s. Seed: 3 hot notifications per campaign with replies (unread).
- **Spintax**: `{a|b|c}` (nestable) resolved per send AFTER variable rendering (mailer.spin) in subject + body. Sequence editor: spintax insert button, combination count, Shuffle preview.
- **Sending calendar**: campaign `send_days` (0=Mon..6=Sun; new campaigns Mon–Fri; missing = every day), `timezone` (IANA, validated → 422), `use_lead_timezone`. Lead `timezone` from CSV column timezone/time zone/tz (invalid → ""). Engine checks weekday + send_start/end_hour in lead tz (if enabled & valid) else campaign tz, per lead. Seed campaigns: Mon–Fri, America/New_York; active campaign uses lead timezones (seed leads have tz from city).

## Iteration 4
- **Gap between emails**: campaign `gap_min_minutes`/`gap_max_minutes` (0–240, default 10–15; swapped if min>max). After each send the inbox gets `senders.next_available_at = now + random(min,max)`; engine only uses inboxes past that time (gap is per inbox, across campaigns). Settings → Sending calendar → "Gap between emails" with presets.
- **Live bar** (campaign detail, above tabs): GET /api/campaigns/{id}/live → capacity_used_pct, sent_today, daily_capacity (min(campaign limit, sum of inbox warm-up limits)), active_sequences, sent_last_30m, next_email_at, next_note. Refetch 10s; countdown ticks every second.

## Iteration 5
- **Random daily start**: campaign `random_start_minutes` (0–180; new campaigns 30, seed 30). Per inbox per local day a stable offset = sha256(sender_id:date) % (N+1) minutes is added to send_start_hour; engine.sender_started() gates inbox use per lead (in lead/campaign tz).
- **Activity Log** page `/activity` (nav "Activity Log"): GET /api/activity?campaign_id=&limit= → items (latest sent emails: time, sender inbox → lead, subject, step/variant, opened/clicked/replied/bounced), inboxes (sent_today/effective_limit, last_sent_at, next_available_at from gap), upcoming (next 10 due leads in active campaigns), sent_last_hour. Auto-refresh 10s, live countdowns.

## Iteration 7 — Deliverability+ Pack (opt-in per campaign)
- **Plain-text only** (campaign `plain_text_only`): sends `text/plain` single-part (no HTML, no pixel, raw URLs). Forces track_opens/track_clicks off at send time; looks hand-typed.
- **Smart "Re:" subject** (campaign `smart_subject`): collapses stacked `Re: Re: Re:` prefixes to a single `Re:` on send (case-insensitive).
- **Extra jitter** (campaign `extra_jitter_minutes` 0–30): adds ±N minutes random offset to `next_send_at` when scheduling the next step, so follow-ups don't line up on the same clock minute.
- **Step preheader** (step `preheader`): injected as a hidden `<span>` block (plus zero-width padding) at the top of HTML — shows as the inbox preview on Gmail/Apple Mail. Never rendered when plain_text_only is on.
- **Per-step tracking overrides** (step `track_opens`/`track_clicks`, nullable): null = inherit campaign setting; true/false = force on/off for that step. Resolved in engine.process_campaign.
- **Per-inbox signatures** (sender `signatures: list[str]` up to 5): each lead keeps the same signature across follow-ups (sha256(sender_id:lead_id) % N). Appended to body if not already present. Edited in Senders → Limits & warm-up dialog, separated by lines of three dashes.

## Iteration 8 — Spam Score Preview + AI Copywriter
- **Spam score** (frontend-only, `src/lib/spam.ts`): rule-based score 0–100 recomputed live from `steps + include_unsubscribe`. Rules: empty / long / short / ALL-CAPS / "Re: Re:" stacked subject, excessive punctuation + spam-trigger words in subject or body, >3 links, URL shorteners (bit.ly, tinyurl, …), high CAPS ratio in body, "click here", missing `{{variable}}`, long preheader (>110), missing campaign unsubscribe.
  - **Severity weights**: critical −25, warning −10, info −3. Overall score = worst step score minus campaign penalties.
  - **Inline panel**: top of Sequence tab (`spam-score-panel`) with per-step chips (`S1·100`), item list for the active step, and 1-click **auto-fixes** (strip "Re:" chain, collapse !!! → !, sentence-case ALL-CAPS). Updates instantly as you type.
  - **Launch hard gate**: when score < 60 the `Launch` button opens `launch-gate-dialog` showing score + critical/warning counts. User can "Open Sequence tab" or "Launch anyway" (destructive).
- **AI Copywriter** (BYOK): `POST /api/ai/rewrite-step` → `openai/gpt-5.2` via `emergentintegrations.LlmChat`. Reads `OPENAI_API_KEY` from backend/.env; returns a friendly 400 when missing. Request = `{step: {subject, subject_b, body, preheader}, tone: professional|casual|friendly|direct, goal: cold_intro|followup|breakup, length: short|medium, product?, audience?}`. Response = strict JSON `{subject, body, preheader}` parsed from the model, with ```json``` fences stripped. Variables and spintax braces are preserved verbatim.
  - **UI**: `Rewrite with AI` button in Sequence editor header → `rewrite-dialog` (Tone/Goal/Length selects + optional pitch/audience inputs). Generate → preview card (subject/preheader/body) → "Replace step" patches the current step.
  - Error mapping: invalid key / 401 → 400 "key rejected", 429 → "rate-limited", other → 502.

## Iteration 6 — UI/UX overhaul
- Light + dark themes via next-themes (ThemeProvider in main.tsx, default dark, stored in localStorage "theme"); tokens in index.css (:root light, .dark dark); Geist + Geist Mono fonts. Theme toggle in app top bar, user menu and landing header.
- AppShell: grouped sidebar (Overview/Outreach/Insights), workspace card, today's sending usage card, breadcrumb, ⌘K command palette (pages, actions, campaigns), "Create" slide-down menu, user avatar menu (theme, logout).
- Landing: Product/Resources slide-down mega menus, product mock, logo marquee, stats, tabbed product tour, deliverability bento, how-it-works, comparison table, pricing (monthly/annual), testimonials, FAQ accordion, CTA, footer.
- Dashboard: greeting + onboarding checklist (hidden when complete). Senders: deliverability checklist + recommended limits. `/senders?connect=1` opens the connect dialog.
