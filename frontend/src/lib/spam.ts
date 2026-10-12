// Lightweight deliverability scorer. Pure functions, no API — recomputes live as you type.
// Score starts at 100 and each rule hit subtracts weight. Fixes are applied in-place where safe.

import type { Step, Campaign } from "./types";

export type Severity = "info" | "warning" | "critical";

export interface SpamItem {
  id: string;
  level: Severity;
  title: string;
  hint: string;
  fix?: {
    kind: "subject" | "body" | "preheader";
    newValue: string; // transformed value when the fix is applied
    label: string;
  };
}

export interface StepScore {
  stepId: string;
  stepIndex: number;
  score: number; // 0-100
  items: SpamItem[];
}

export interface CampaignScore {
  score: number; // worst step score (so one bad step gates the whole campaign)
  critical: number;
  warnings: number;
  perStep: StepScore[];
  campaignItems: SpamItem[]; // whole-campaign issues (e.g. unsubscribe disabled)
}

// --- rule knobs ---------------------------------------------------------
const SPAM_WORDS: string[] = [
  "free",
  "100% free",
  "act now",
  "buy now",
  "click here",
  "guaranteed",
  "cash",
  "winner",
  "congratulations",
  "limited time",
  "risk-free",
  "no obligation",
  "earn money",
  "double your income",
  "lowest price",
  "best price",
  "cheap",
  "urgent",
  "important information",
  "dear friend",
  "this isn't spam",
  "not spam",
  "opt in",
  "singles",
  "weight loss",
  "miracle",
  "crypto",
  "investment opportunity",
];
const SHORT_LINKS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "buff.ly", "cutt.ly", "is.gd", "shorte.st"];
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const VAR_RE = /\{\{[a-z_][a-z0-9_]*\}\}/i;

function stripOne(level: Severity): number {
  return level === "critical" ? 25 : level === "warning" ? 10 : 3;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

// ------- subject rules --------------------------------------------------
function subjectItems(subject: string, labelSuffix = ""): SpamItem[] {
  const items: SpamItem[] = [];
  const s = (subject ?? "").trim();
  const idSfx = labelSuffix ? `-${labelSuffix}` : "";
  if (!s) {
    items.push({ id: `subj-missing${idSfx}`, level: "critical", title: `Subject${labelSuffix ? ` ${labelSuffix}` : ""} is empty`, hint: "Follow-ups can inherit, but step 1 needs a subject." });
    return items;
  }
  if (s.length > 70) items.push({ id: `subj-long${idSfx}`, level: "warning", title: `Subject${labelSuffix ? ` ${labelSuffix}` : ""} is ${s.length} chars`, hint: "Keep subjects under 55 chars so they don't truncate on mobile." });
  else if (s.length < 10) items.push({ id: `subj-short${idSfx}`, level: "info", title: `Subject${labelSuffix ? ` ${labelSuffix}` : ""} is very short`, hint: "A 20–50 char subject reads most human." });
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 6 && letters === letters.toUpperCase()) {
    items.push({
      id: `subj-caps${idSfx}`,
      level: "critical",
      title: `Subject${labelSuffix ? ` ${labelSuffix}` : ""} is ALL CAPS`,
      hint: "ALL-CAPS subjects are a top spam signal.",
      fix: { kind: "subject", newValue: s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(), label: "Switch to sentence case" },
    });
  }
  if (/[!?]{2,}/.test(s)) {
    items.push({
      id: `subj-punct${idSfx}`,
      level: "warning",
      title: `Stacked punctuation in subject${labelSuffix ? ` ${labelSuffix}` : ""}`,
      hint: 'Multiple "!" or "?" trigger spam filters.',
      fix: { kind: "subject", newValue: s.replace(/([!?])\1+/g, "$1"), label: "Collapse to one !/?" },
    });
  }
  const emojis = s.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
  if (emojis && emojis.length > 1) items.push({ id: `subj-emoji${idSfx}`, level: "info", title: `${emojis.length} emojis in subject${labelSuffix ? ` ${labelSuffix}` : ""}`, hint: "One emoji is fine; more than one looks promotional." });
  const lower = s.toLowerCase();
  const hit = SPAM_WORDS.find((w) => lower.includes(w));
  if (hit) items.push({ id: `subj-spam-${hit}${idSfx}`, level: "warning", title: `Spam-trigger word in subject: "${hit}"`, hint: "Rewrite with a specific hook instead of a generic promise." });
  // Re: Re: Re: chain — only flag if 2+ "Re:"
  if (/^\s*(re\s*:\s*){2,}/i.test(s)) {
    items.push({
      id: `subj-re${idSfx}`,
      level: "warning",
      title: `Stacked "Re:" prefixes in subject${labelSuffix ? ` ${labelSuffix}` : ""}`,
      hint: 'Email clients collapse stacked "Re:" — real humans never type them.',
      fix: { kind: "subject", newValue: s.replace(/^\s*(re\s*:\s*)+/i, "Re: ").trim(), label: "Collapse to one Re:" },
    });
  }
  return items;
}

// ------- body rules -----------------------------------------------------
function bodyItems(body: string): SpamItem[] {
  const items: SpamItem[] = [];
  const b = body ?? "";
  const trimmed = b.trim();
  if (!trimmed) {
    items.push({ id: "body-missing", level: "critical", title: "Body is empty", hint: "Write at least a 2-paragraph message." });
    return items;
  }
  if (trimmed.length < 60) items.push({ id: "body-short", level: "warning", title: "Body is very short", hint: "Cold emails under 60 chars look like a one-liner blast. Aim for 60–180 words." });
  else if (trimmed.length > 2200) items.push({ id: "body-long", level: "info", title: "Body is long", hint: "Over ~2200 chars gets clipped by Gmail; shorter is often better." });

  // Links
  const urls = trimmed.match(URL_RE) || [];
  if (urls.length > 3) items.push({ id: "body-links", level: "warning", title: `${urls.length} links in body`, hint: "Three or more links materially raise spam scores. Keep it to one or two." });
  const shorteners = urls.filter((u) => SHORT_LINKS.some((d) => u.includes(d)));
  if (shorteners.length) items.push({ id: "body-shorteners", level: "critical", title: `URL shortener detected (${shorteners[0]})`, hint: "Shorteners like bit.ly/tinyurl are a top spam signal in cold outreach." });

  // CAPS ratio across letters
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 40) {
    const caps = letters.replace(/[^A-Z]/g, "").length;
    const ratio = caps / letters.length;
    if (ratio > 0.3) items.push({ id: "body-caps", level: "warning", title: "Too much CAPS in body", hint: "Lower-case the shouting — keeps you out of promotions." });
  }

  // Personalization: looks for {{ var }}
  if (!VAR_RE.test(b)) items.push({ id: "body-no-vars", level: "info", title: "No {{variable}} in body", hint: "Add {{first_name}} or {{company}} so each email reads bespoke." });

  // Spam words
  const lower = trimmed.toLowerCase();
  const hit = SPAM_WORDS.find((w) => lower.includes(w));
  if (hit) items.push({ id: `body-spam-${hit}`, level: "warning", title: `Spam-trigger phrase in body: "${hit}"`, hint: "Phrase it as a question or a concrete value prop instead." });

  // Stacked punctuation inside body
  if (/[!]{3,}/.test(b)) {
    items.push({
      id: "body-punct",
      level: "warning",
      title: "Exclamation flood in body",
      hint: "Multiple exclamation marks in a row = promotional feel.",
      fix: { kind: "body", newValue: b.replace(/!{2,}/g, "!"), label: "Collapse to one !" },
    });
  }

  // "Click here"
  if (/\bclick here\b/i.test(b)) {
    items.push({
      id: "body-click-here",
      level: "warning",
      title: '"Click here" link text',
      hint: 'Spam filters flag "click here"; use the real anchor text instead.',
    });
  }
  return items;
}

export function scoreStep(step: Step, index: number): StepScore {
  const items: SpamItem[] = [];
  items.push(...subjectItems(step.subject));
  if (step.subject_b) items.push(...subjectItems(step.subject_b, "B"));
  items.push(...bodyItems(step.body));
  if ((step.preheader ?? "").length > 110) {
    items.push({ id: "pre-long", level: "info", title: "Preheader is long", hint: "Gmail cuts preheader around 90 chars on mobile." });
  }
  const penalty = items.reduce((acc, i) => acc + stripOne(i.level), 0);
  return { stepId: step.id, stepIndex: index, score: clamp(100 - penalty), items };
}

export function scoreCampaign(c: Pick<Campaign, "steps" | "include_unsubscribe">): CampaignScore {
  const perStep = (c.steps ?? []).map((s, i) => scoreStep(s, i));
  const campaignItems: SpamItem[] = [];
  if (!c.include_unsubscribe) {
    campaignItems.push({ id: "no-unsub", level: "critical", title: "Unsubscribe link disabled", hint: "A one-click opt-out + List-Unsubscribe header is required by Gmail/Yahoo for bulk cold outreach." });
  }
  const critical = perStep.flatMap((s) => s.items).filter((i) => i.level === "critical").length + campaignItems.filter((i) => i.level === "critical").length;
  const warnings = perStep.flatMap((s) => s.items).filter((i) => i.level === "warning").length + campaignItems.filter((i) => i.level === "warning").length;
  const campaignPenalty = campaignItems.reduce((acc, i) => acc + stripOne(i.level), 0);
  // Overall score is the worst step minus any campaign-level penalty — one weak step gates the campaign.
  const worstStep = perStep.length ? Math.min(...perStep.map((s) => s.score)) : 100;
  return { score: clamp(worstStep - campaignPenalty), critical, warnings, perStep, campaignItems };
}

export function scoreBand(score: number): { label: string; tone: "good" | "ok" | "bad" } {
  if (score >= 80) return { label: "Great", tone: "good" };
  if (score >= 60) return { label: "OK", tone: "ok" };
  return { label: "Risky", tone: "bad" };
}
