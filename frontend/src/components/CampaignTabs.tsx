import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock, Download, Eye, FileUp, Globe, History, Loader2, MessageSquareReply, MousePointerClick, Plus, Save, Search, ShieldCheck, Shuffle, Sparkles, Timer, Trash2, Upload, UserPlus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Campaign, Lead, LeadHistory, LeadImportResult, LeadIn, RewriteGoal, RewriteLength, RewriteRequest, RewriteResponse, RewriteTone, Sender, Step } from "@/lib/types";
import { LEAD_STATUS, errMsg, timeAgo } from "@/lib/format";
import { Panel, Pill } from "@/components/ui-kit";
import { scoreCampaign, scoreBand, type SpamItem, type StepScore } from "@/lib/spam";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ---------------- CSV ----------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

type StdKey = Exclude<keyof LeadIn, "custom">;
const ALIASES: Record<StdKey, string[]> = {
  email: ["email", "email address", "e-mail", "work email", "mail"],
  first_name: ["first_name", "first name", "firstname", "first", "name"],
  last_name: ["last_name", "last name", "lastname", "last", "surname"],
  company: ["company", "company name", "company_name", "organization", "organisation", "account"],
  title: ["title", "job title", "job_title", "position", "role"],
  timezone: ["timezone", "time zone", "time_zone", "tz"],
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toLeads(text: string): { leads: LeadIn[]; invalid: number; customCols: string[] } {
  const rows = parseCsv(text);
  if (!rows.length) return { leads: [], invalid: 0, customCols: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(
    (Object.keys(ALIASES) as StdKey[]).map((k) => [k, header.findIndex((h) => ALIASES[k].includes(h))]),
  ) as Record<StdKey, number>;
  let body = rows.slice(1);
  if (idx.email < 0) {
    // no header row — find the column that looks like an email
    const col = rows[0].findIndex((c) => EMAIL_RE.test(c.trim()));
    if (col < 0) return { leads: [], invalid: rows.length, customCols: [] };
    idx.email = col;
    body = rows;
  }
  const known = new Set(Object.values(idx).filter((i) => i >= 0));
  const customCols = idx.email >= 0 && body !== rows
    ? header.map((h, i) => ({ h: h.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""), i })).filter((c) => c.h && !known.has(c.i))
    : [];
  const leads: LeadIn[] = [];
  let invalid = 0;
  for (const r of body) {
    const g = (k: StdKey) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
    const email = g("email");
    if (!EMAIL_RE.test(email)) { invalid++; continue; }
    let first = g("first_name");
    let last = g("last_name");
    if (header[idx.first_name] === "name" && first.includes(" ") && !last) [first, last] = [first.split(" ")[0], first.split(" ").slice(1).join(" ")];
    const custom: Record<string, string> = {};
    for (const c of customCols) if ((r[c.i] ?? "").trim()) custom[c.h] = r[c.i].trim();
    leads.push({ email, first_name: first, last_name: last, company: g("company"), title: g("title"), timezone: g("timezone"), custom });
  }
  return { leads, invalid, customCols: customCols.map((c) => c.h) };
}

// ---------------- Leads tab ----------------
export function LeadsTab({ campaign }: { campaign: Campaign }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [preview, setPreview] = useState<{ leads: LeadIn[]; invalid: number; customCols: string[]; file: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [manual, setManual] = useState(false);
  const [one, setOne] = useState<LeadIn>({ email: "", first_name: "", last_name: "", company: "", title: "", timezone: "", custom: {} });
  const [historyLead, setHistoryLead] = useState<Lead | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const leads = useQuery({
    queryKey: ["leads", campaign.id, q, status],
    queryFn: () => apiGet<Lead[]>(`/campaigns/${campaign.id}/leads?q=${encodeURIComponent(q)}&status=${status}`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["leads", campaign.id] });
    qc.invalidateQueries({ queryKey: ["campaign", campaign.id] });
    qc.invalidateQueries({ queryKey: ["campaigns"] });
  };
  const imp = useMutation({
    mutationFn: (list: LeadIn[]) => apiPost<LeadImportResult>(`/campaigns/${campaign.id}/leads`, { leads: list }),
    onSuccess: (r) => {
      toast.success(`${r.added} leads added${r.skipped ? `, ${r.skipped} duplicates skipped` : ""}`);
      setPreview(null);
      setManual(false);
      setOne({ email: "", first_name: "", last_name: "", company: "", title: "", timezone: "", custom: {} });
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/campaigns/${campaign.id}/leads/${id}`),
    onSuccess: () => { toast.success("Lead removed"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const readFile = async (f: File) => {
    const text = await f.text();
    const parsed = toLeads(text);
    if (!parsed.leads.length) toast.error("No valid emails found — make sure the CSV has an 'email' column");
    else setPreview({ ...parsed, file: f.name });
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void readFile(f);
    e.target.value = "";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void readFile(f);
  };
  const rows = leads.isError ? [] : leads.data ?? [];

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-4 rounded-xl border border-dashed p-6 text-center transition-colors duration-150 sm:flex-row sm:text-left",
          drag ? "border-cyan-400 bg-cyan-500/5" : "border-input bg-panel",
        )}
        data-testid="csv-dropzone"
      >
        <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-secondary"><FileUp className="size-5 text-cyan" /></div>
        <div className="flex-1">
          <p className="font-medium text-foreground">Import leads from CSV</p>
          <p className="text-sm text-muted-foreground">Drag a file here. Columns: <span className="font-mono text-xs text-foreground/75">email, first_name, last_name, company, title</span> — any extra column becomes a <span className="font-mono text-xs text-cyan">{"{{variable}}"}</span></p>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={onFile} data-testid="csv-file-input" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setManual(true)} data-testid="add-lead-manual-button"><UserPlus className="size-4" />Add one</Button>
          <Button onClick={() => fileRef.current?.click()} data-testid="csv-upload-button"><Upload className="size-4" />Upload CSV</Button>
        </div>
      </div>

      <Panel
        title={<span>Leads <span className="ml-1 font-mono text-xs text-muted-foreground">{rows.length}</span></span>}
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-8 w-40 pl-8 text-xs sm:w-56" data-testid="lead-search-input" />
            </div>
            <Select value={status} onValueChange={(v: string) => setStatus(v)}>
              <SelectTrigger size="sm" className="w-36" data-testid="lead-status-filter">
                <SelectValue>{(v) => {
                  if (v === "all") return "All statuses";
                  if (v === "opened") return "Opened";
                  if (v === "clicked") return "Clicked";
                  return LEAD_STATUS[v as keyof typeof LEAD_STATUS]?.label;
                }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(LEAD_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                <SelectItem value="opened" data-testid="lead-status-opened">Opened</SelectItem>
                <SelectItem value="clicked" data-testid="lead-status-clicked">Clicked</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => { window.location.assign(`/api/campaigns/${campaign.id}/leads/export`); }} data-testid="leads-export-button">
              <Download className="size-4" /> Export CSV
            </Button>
          </div>
        }
        testId="leads-panel"
      >
        <div className="max-h-[560px] overflow-auto scroll-thin">
          <table className="w-full text-sm" data-testid="leads-table">
            <thead className="sticky top-0 bg-panel text-left text-[11px] uppercase tracking-[0.07em] text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 font-semibold">Contact</th>
                <th className="px-3 py-2.5 font-semibold">Company</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Step</th>
                <th className="px-3 py-2.5 font-semibold">Engagement</th>
                <th className="px-3 py-2.5 font-semibold">Last sent</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} onClick={() => setHistoryLead(l)} className="cursor-pointer border-b border-border/70 transition-colors hover:bg-foreground/[0.03]" data-testid={`lead-row-${l.id}`}>
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-foreground">{`${l.first_name} ${l.last_name}`.trim() || "—"}</p>
                    <p className="font-mono text-xs text-muted-foreground">{l.email}</p>
                    {l.timezone && <p className="font-mono text-[10px] text-muted-foreground/70" data-testid={`lead-timezone-${l.id}`}>{l.timezone}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-foreground/75">
                    {l.company || "—"}<p className="text-xs text-muted-foreground">{l.title}</p>
                    {Object.keys(l.custom ?? {}).length > 0 && (
                      <p className="mt-0.5 max-w-[220px] truncate font-mono text-[10px] text-muted-foreground" data-testid={`lead-custom-${l.id}`}>
                        {Object.entries(l.custom).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><Pill cls={LEAD_STATUS[l.status].cls}>{LEAD_STATUS[l.status].label}</Pill></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{Math.min(l.current_step, campaign.steps.length)}/{campaign.steps.length}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      {l.opened && <Pill cls="border-sky-500/30 bg-sky-500/10 text-sky-300">Opened</Pill>}
                      {l.clicked && <Pill cls="border-amber-500/30 bg-amber-500/10 text-amber-300">Clicked</Pill>}
                      {!l.opened && !l.clicked && <span className="text-xs text-muted-foreground/70">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{timeAgo(l.last_sent_at)}</td>
                  <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon-xs" onClick={() => setHistoryLead(l)} data-testid={`lead-history-${l.id}`} aria-label="View lead history">
                      <History className="size-3.5 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => del.mutate(l.id)} data-testid={`lead-delete-${l.id}`} aria-label="Remove lead">
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              ))}
              {leads.data && rows.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground" data-testid="leads-empty">No leads yet — upload a CSV to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-2xl" data-testid="csv-preview-dialog">
          <DialogHeader>
            <DialogTitle>Import {preview?.leads.length} leads</DialogTitle>
            <DialogDescription>
              From <span className="font-mono">{preview?.file}</span>{preview?.invalid ? ` · ${preview.invalid} rows skipped (invalid email)` : ""}. Duplicates and unsubscribed contacts are handled automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-auto rounded-lg border border-border scroll-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr>{["Email", "First", "Last", "Company", "Title", "Timezone", ...(preview?.customCols ?? [])].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview?.leads.slice(0, 50).map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono">{l.email}</td><td className="px-3 py-1.5">{l.first_name}</td>
                    <td className="px-3 py-1.5">{l.last_name}</td><td className="px-3 py-1.5">{l.company}</td><td className="px-3 py-1.5">{l.title}</td><td className="px-3 py-1.5 font-mono">{l.timezone}</td>
                    {preview.customCols.map((c) => <td key={c} className="px-3 py-1.5">{l.custom[c] ?? ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!preview?.customCols.length && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="csv-custom-columns">
              Custom variables detected:
              {preview.customCols.map((c) => <span key={c} className="rounded-md border border-input bg-muted px-1.5 py-0.5 font-mono text-cyan">{`{{${c}}}`}</span>)}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} data-testid="csv-preview-cancel">Cancel</Button>
            <Button onClick={() => preview && imp.mutate(preview.leads)} disabled={imp.isPending} data-testid="csv-import-confirm">
              {imp.isPending && <Loader2 className="size-4 animate-spin" />} Import leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manual} onOpenChange={setManual}>
        <DialogContent className="sm:max-w-md" data-testid="add-lead-dialog">
          <form onSubmit={(e) => { e.preventDefault(); imp.mutate([one]); }}>
            <DialogHeader><DialogTitle>Add a lead</DialogTitle></DialogHeader>
            <div className="my-5 grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5"><Label>Email</Label><Input type="email" required value={one.email} onChange={(e) => setOne({ ...one, email: e.target.value })} data-testid="lead-email-input" /></div>
              <div className="space-y-1.5"><Label>First name</Label><Input value={one.first_name} onChange={(e) => setOne({ ...one, first_name: e.target.value })} data-testid="lead-first-name-input" /></div>
              <div className="space-y-1.5"><Label>Last name</Label><Input value={one.last_name} onChange={(e) => setOne({ ...one, last_name: e.target.value })} data-testid="lead-last-name-input" /></div>
              <div className="space-y-1.5"><Label>Company</Label><Input value={one.company} onChange={(e) => setOne({ ...one, company: e.target.value })} data-testid="lead-company-input" /></div>
              <div className="space-y-1.5"><Label>Title</Label><Input value={one.title} onChange={(e) => setOne({ ...one, title: e.target.value })} data-testid="lead-title-input" /></div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={imp.isPending} data-testid="add-lead-submit">{imp.isPending && <Loader2 className="size-4 animate-spin" />}Add lead</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LeadHistoryDialog campaign={campaign} lead={historyLead} onClose={() => setHistoryLead(null)} />
    </div>
  );
}

// -------- Lead history dialog -------------------------------------------
function LeadHistoryDialog({ campaign, lead, onClose }: { campaign: Campaign; lead: Lead | null; onClose: () => void }) {
  const h = useQuery({
    queryKey: ["lead-history", campaign.id, lead?.id],
    queryFn: () => apiGet<LeadHistory>(`/campaigns/${campaign.id}/leads/${lead!.id}/history`),
    enabled: !!lead,
  });
  const data = h.isError ? undefined : h.data;
  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl scroll-thin" data-testid="lead-history-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-cyan" /> {`${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim() || lead?.email || "Lead history"}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {lead?.email}{lead?.company ? ` · ${lead.company}` : ""}
          </DialogDescription>
        </DialogHeader>
        {h.isPending && <div className="flex items-center justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
        {data && data.messages.length === 0 && (
          <p className="rounded-lg border border-dashed border-border bg-background px-5 py-10 text-center text-sm text-muted-foreground" data-testid="lead-history-empty">
            No emails sent to this lead yet. Launch the campaign and the first step will land in their inbox.
          </p>
        )}
        {data && data.messages.length > 0 && (
          <ol className="relative my-3 space-y-4 pl-6" data-testid="lead-history-timeline">
            <span className="absolute inset-y-2 left-[11px] w-px bg-border" aria-hidden />
            {data.messages.map((m) => {
              const sent = new Date(m.sent_at);
              return (
                <li key={m.id} className="relative" data-testid={`lead-history-msg-${m.id}`}>
                  <span className="absolute -left-6 top-1 grid size-6 place-items-center rounded-full border border-border bg-panel text-[10px] font-mono text-cyan">
                    {m.step_index + 1}
                  </span>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{m.subject || <span className="italic text-muted-foreground">Same-thread follow-up</span>}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {m.sender_from_name ? `${m.sender_from_name} <${m.sender_email}>` : m.sender_email} → {lead?.email}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{sent.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`lead-history-badges-${m.id}`}>
                      <Pill cls="border-blue-500/30 bg-blue-500/10 text-blue-300">Step {m.step_index + 1}{m.variant === "b" ? " · B" : ""}</Pill>
                      {m.opened_at && <Pill cls="border-sky-500/30 bg-sky-500/10 text-sky-300"><Eye className="size-3" /> Opened{m.open_count > 1 ? ` · ${m.open_count}×` : ""}</Pill>}
                      {m.clicked_at && <Pill cls="border-amber-500/30 bg-amber-500/10 text-amber-300"><MousePointerClick className="size-3" /> Clicked{m.click_count > 1 ? ` · ${m.click_count}×` : ""}</Pill>}
                      {m.replied_at && <Pill cls="border-emerald-500/30 bg-emerald-500/10 text-emerald-300"><MessageSquareReply className="size-3" /> Replied</Pill>}
                      {m.bounced && <Pill cls="border-red-500/30 bg-red-500/10 text-red-300">Bounced</Pill>}
                      {m.unsubscribed && <Pill cls="border-orange-500/30 bg-orange-500/10 text-orange-300">Unsubscribed</Pill>}
                    </div>
                    {m.body && (
                      <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground/85" data-testid={`lead-history-body-${m.id}`}>
                        {m.body.length > 1200 ? m.body.slice(0, 1200) + "…" : m.body}
                      </pre>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="lead-history-close">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Sequence tab ----------------
const BASE_VARS = ["first_name", "last_name", "company", "title"];
const SAMPLE: Record<string, string> = { first_name: "Olivia", last_name: "Carter", company: "Northwind", title: "VP Sales", email: "olivia@northwind.com", unsubscribe_link: "https://…/unsubscribe" };
const makeRender = (custom: string[]) => (t: string) =>
  t.replace(/\{\{\s*([a-z0-9_]+)\s*(?:\|([^}]*))?\}\}/gi, (m, k: string, fb?: string) => {
    const key = k.toLowerCase();
    if (SAMPLE[key]) return SAMPLE[key];
    if (custom.includes(key)) return `[${key}]`;
    return fb !== undefined ? fb.trim() : m;
  });
const SPIN_RE = /\{([^{}]*\|[^{}]*)\}/g;
function spinText(t: string): string {
  for (let i = 0; i < 20; i++) {
    const next = t.replace(SPIN_RE, (_m, g: string) => { const o = g.split("|"); return o[Math.floor(Math.random() * o.length)]; });
    if (next === t) break;
    t = next;
  }
  return t;
}
const countVariants = (t: string) => {
  let n = 1;
  for (const m of t.replace(/\{\{[^}]*\}\}/g, "").matchAll(SPIN_RE)) n *= m[1].split("|").length;
  return n;
};
const uid = () => Math.random().toString(36).slice(2, 10);

// -------- Spam / Deliverability score panel --------
function SpamItemRow({ item, onApply }: { item: SpamItem; onApply: (i: SpamItem) => void }) {
  const dot = item.level === "critical" ? "bg-red-400" : item.level === "warning" ? "bg-amber-400" : "bg-cyan-400";
  return (
    <li className="flex items-start gap-2 py-1.5" data-testid={`spam-item-${item.id}`}>
      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", dot)} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{item.title}</p>
        <p className="text-[11px] text-muted-foreground">{item.hint}</p>
      </div>
      {item.fix && (
        <button
          type="button"
          onClick={() => onApply(item)}
          className="shrink-0 rounded-md border border-input bg-background px-2 py-0.5 text-[10px] font-medium text-foreground/80 hover:border-cyan-500/50 hover:text-foreground"
          data-testid={`spam-fix-${item.id}`}
        >
          {item.fix.label}
        </button>
      )}
    </li>
  );
}

function SpamScorePanel({
  score, perStep, campaignItems, activeIndex, onJumpStep, onApplyFix,
}: {
  score: number;
  perStep: StepScore[];
  campaignItems: SpamItem[];
  activeIndex: number;
  onJumpStep: (i: number) => void;
  onApplyFix: (stepIndex: number, item: SpamItem) => void;
}) {
  const band = scoreBand(score);
  const barColor = band.tone === "good" ? "bg-emerald-400" : band.tone === "ok" ? "bg-amber-400" : "bg-red-400";
  const borderColor = band.tone === "good" ? "border-emerald-500/30" : band.tone === "ok" ? "border-amber-500/30" : "border-red-500/40";
  const stepCur = perStep[activeIndex];
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className={cn("size-4", band.tone === "good" ? "text-emerald-300" : band.tone === "ok" ? "text-amber-300" : "text-red-300")} />
          Spam score
          <span className="rounded bg-secondary px-1.5 py-px font-mono text-[11px] text-muted-foreground">{band.label}</span>
        </span>
      }
      testId="spam-score-panel"
    >
      <div className={cn("space-y-3 border-l-2 p-5", borderColor)}>
        <div className="flex items-center gap-4">
          <div className="font-mono text-3xl font-bold text-foreground" data-testid="spam-score-value">{score}</div>
          <div className="flex-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full transition-all", barColor)} style={{ width: `${score}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Live score — recomputes as you edit. Lower = more likely to land in Spam. Fix the red items first.
            </p>
          </div>
          <div className="flex gap-1.5">
            {perStep.map((s) => {
              const b = scoreBand(s.score);
              const tone = b.tone === "good" ? "text-emerald-300 border-emerald-500/40" : b.tone === "ok" ? "text-amber-300 border-amber-500/40" : "text-red-300 border-red-500/50";
              return (
                <button
                  key={s.stepId}
                  type="button"
                  onClick={() => onJumpStep(s.stepIndex)}
                  className={cn("rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors", tone, s.stepIndex === activeIndex && "bg-foreground/5")}
                  data-testid={`spam-step-chip-${s.stepIndex}`}
                  aria-label={`Jump to step ${s.stepIndex + 1}, score ${s.score}`}
                >
                  S{s.stepIndex + 1} · {s.score}
                </button>
              );
            })}
          </div>
        </div>
        {(stepCur?.items.length || 0) + campaignItems.length > 0 && (
          <ul className="space-y-0.5 border-t border-border pt-2" data-testid="spam-item-list">
            {campaignItems.map((it) => <SpamItemRow key={it.id} item={it} onApply={() => { /* campaign-level has no auto-fix for now */ }} />)}
            {(stepCur?.items ?? []).map((it) => (
              <SpamItemRow key={it.id} item={it} onApply={(i) => onApplyFix(stepCur!.stepIndex, i)} />
            ))}
          </ul>
        )}
        {(stepCur?.items.length || 0) + campaignItems.length === 0 && (
          <p className="text-xs text-emerald-300" data-testid="spam-no-issues">No issues on this step — looking good.</p>
        )}
      </div>
    </Panel>
  );
}

// -------- AI "Rewrite with AI" dialog --------
function RewriteDialog({
  open, onClose, step, onApply,
}: {
  open: boolean;
  onClose: () => void;
  step: Step | undefined;
  onApply: (r: RewriteResponse) => void;
}) {
  const [tone, setTone] = useState<RewriteTone>("professional");
  const [goal, setGoal] = useState<RewriteGoal>("cold_intro");
  const [length, setLength] = useState<RewriteLength>("short");
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [preview, setPreview] = useState<RewriteResponse | null>(null);
  const rewrite = useMutation({
    mutationFn: () => {
      if (!step) throw new Error("No step");
      const payload: RewriteRequest = {
        step: { subject: step.subject, subject_b: step.subject_b, body: step.body, preheader: step.preheader },
        tone, goal, length,
        product: product.trim() || undefined,
        audience: audience.trim() || undefined,
      };
      return apiPost<RewriteResponse>("/ai/rewrite-step", payload);
    },
    onSuccess: (r) => setPreview(r),
    onError: (e) => toast.error(errMsg(e)),
  });
  const reset = () => { setPreview(null); setProduct(""); setAudience(""); };
  const close = () => { reset(); onClose(); };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl scroll-thin" data-testid="rewrite-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="size-4 text-cyan" /> Rewrite with AI</DialogTitle>
          <DialogDescription>Keeps every <span className="font-mono text-foreground/80">{"{{variable}}"}</span> intact. Needs <span className="font-mono text-foreground/80">OPENAI_API_KEY</span> in backend/.env.</DialogDescription>
        </DialogHeader>
        {!preview && (
          <div className="my-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Tone</Label>
                <Select value={tone} onValueChange={(v) => setTone(v as RewriteTone)}>
                  <SelectTrigger data-testid="rewrite-tone-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["professional", "casual", "friendly", "direct"] as const).map((t) => (
                      <SelectItem key={t} value={t} data-testid={`rewrite-tone-${t}`}>{t[0].toUpperCase() + t.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Goal</Label>
                <Select value={goal} onValueChange={(v) => setGoal(v as RewriteGoal)}>
                  <SelectTrigger data-testid="rewrite-goal-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cold_intro" data-testid="rewrite-goal-cold_intro">Cold intro</SelectItem>
                    <SelectItem value="followup" data-testid="rewrite-goal-followup">Follow-up</SelectItem>
                    <SelectItem value="breakup" data-testid="rewrite-goal-breakup">Break-up</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Length</Label>
                <Select value={length} onValueChange={(v) => setLength(v as RewriteLength)}>
                  <SelectTrigger data-testid="rewrite-length-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short" data-testid="rewrite-length-short">Short</SelectItem>
                    <SelectItem value="medium" data-testid="rewrite-length-medium">Medium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>What you're pitching <span className="text-muted-foreground">· optional</span></Label>
              <Input value={product} onChange={(e) => setProduct(e.target.value)} maxLength={400} placeholder="e.g. a shipping-cost analytics tool for DTC Shopify brands" data-testid="rewrite-product-input" />
            </div>
            <div className="space-y-1.5">
              <Label>Target reader <span className="text-muted-foreground">· optional</span></Label>
              <Input value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={200} placeholder="e.g. founders doing $5M+ ARR" data-testid="rewrite-audience-input" />
            </div>
          </div>
        )}
        {preview && (
          <div className="my-4 space-y-3" data-testid="rewrite-preview">
            <div className="rounded-lg border border-border bg-background p-3">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Subject</Label>
              <p className="mt-1 text-sm font-medium text-foreground" data-testid="rewrite-preview-subject">{preview.subject}</p>
            </div>
            {preview.preheader && (
              <div className="rounded-lg border border-border bg-background p-3">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Preheader</Label>
                <p className="mt-1 text-xs text-foreground/90" data-testid="rewrite-preview-preheader">{preview.preheader}</p>
              </div>
            )}
            <div className="rounded-lg border border-border bg-background p-3">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Body</Label>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-foreground/90" data-testid="rewrite-preview-body">{preview.body}</pre>
            </div>
          </div>
        )}
        <DialogFooter>
          {!preview ? (
            <>
              <Button variant="outline" onClick={close} data-testid="rewrite-cancel">Cancel</Button>
              <Button onClick={() => rewrite.mutate()} disabled={rewrite.isPending} data-testid="rewrite-generate">
                {rewrite.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setPreview(null)} data-testid="rewrite-tweak">Tweak settings</Button>
              <Button onClick={() => { onApply(preview); close(); toast.success("Step updated with AI draft"); }} data-testid="rewrite-apply">Replace step</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SequenceTab({ campaign }: { campaign: Campaign }) {
  const qc = useQueryClient();
  const [steps, setSteps] = useState<Step[]>(campaign.steps);
  const [active, setActive] = useState(0);
  const [abOpen, setAbOpen] = useState<Record<string, boolean>>({});
  const [previewB, setPreviewB] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastSel = useRef<number | null>(null);
  const vars = [...BASE_VARS, ...campaign.custom_fields, "unsubscribe_link"];
  const renderVars = makeRender(campaign.custom_fields);
  const [shuffle, setShuffle] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const render = useMemo(() => { const cache = new Map<string, string>(); return (t: string) => { if (!cache.has(t)) cache.set(t, spinText(renderVars(t))); return cache.get(t)!; }; }, [shuffle, campaign.custom_fields]);
  const dirty = JSON.stringify(steps) !== JSON.stringify(campaign.steps);
  const save = useMutation({
    mutationFn: () => apiPut<Campaign>(`/campaigns/${campaign.id}`, { steps }),
    onSuccess: (c) => {
      qc.setQueryData(["campaign", campaign.id], c);
      setSteps(c.steps);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Sequence saved");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const cur = steps[active];
  const patch = (p: Partial<Step>) => setSteps(steps.map((s, i) => (i === active ? { ...s, ...p } : s)));
  const insertVar = (token: string) => {
    const el = bodyRef.current;
    if (!el || !cur) return;
    const focused = document.activeElement === el || lastSel.current !== null;
    const a = focused ? (lastSel.current ?? el.selectionStart) : cur.body.length;
    const b = focused && lastSel.current === null ? el.selectionEnd : a;
    patch({ body: cur.body.slice(0, a) + token + cur.body.slice(b) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  };
  const add = () => {
    setSteps([...steps, { id: `new-${uid()}`, subject: "", subject_b: "", ab_winner: null, body: "Hi {{first_name}},\n\n", delay_days: 3, preheader: "", track_opens: null, track_clicks: null }]);
    setActive(steps.length);
  };
  const remove = (i: number) => {
    const next = steps.filter((_, j) => j !== i);
    setSteps(next);
    setActive(Math.max(0, Math.min(active, next.length - 1)));
  };
  const firstSubject = steps[0]?.subject ?? "";
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const campaignScore = useMemo(
    () => scoreCampaign({ steps, include_unsubscribe: campaign.include_unsubscribe }),
    [steps, campaign.include_unsubscribe],
  );
  const applyFix = (stepIndex: number, item: SpamItem) => {
    if (!item.fix) return;
    setSteps((prev) => prev.map((s, i) => i === stepIndex ? { ...s, [item.fix!.kind]: item.fix!.newValue } : s));
    setActive(stepIndex);
    toast.success(`Applied: ${item.fix.label}`);
  };
  const applyRewrite = (r: RewriteResponse) => {
    if (!cur) return;
    patch({ subject: r.subject || cur.subject, body: r.body || cur.body, preheader: r.preheader || cur.preheader });
  };

  return (
    <div className="space-y-5">
      <SpamScorePanel
        score={campaignScore.score}
        perStep={campaignScore.perStep}
        campaignItems={campaignScore.campaignItems}
        activeIndex={active}
        onJumpStep={setActive}
        onApplyFix={applyFix}
      />
      <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-2 lg:col-span-4" data-testid="sequence-steps-list">
        {steps.map((s, i) => (
          <div key={s.id}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1.5 pl-5 text-xs text-muted-foreground">
                <Clock className="size-3.5" /> Wait <span className="font-mono text-foreground/75">{s.delay_days}</span> day{s.delay_days === 1 ? "" : "s"}
              </div>
            )}
            <button
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "w-full rounded-xl border p-4 text-left transition-[border-color,background-color] duration-150",
                i === active ? "border-blue-500/60 bg-blue-600/10" : "border-border bg-panel hover:border-foreground/20",
              )}
              data-testid={`sequence-step-${i}`}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-cyan">
                  Step {i + 1}
                  {s.subject_b.trim() && <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] text-amber-300" data-testid={`sequence-step-ab-badge-${i}`}>A/B{s.ab_winner ? ` · ${s.ab_winner.toUpperCase()} won` : ""}</span>}
                </span>
                {steps.length > 1 && (
                  <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); remove(i); }} className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-red-300" data-testid={`sequence-step-delete-${i}`}>
                    <Trash2 className="size-3.5" />
                  </span>
                )}
              </div>
              <p className="mt-1.5 truncate text-sm font-medium text-foreground">{s.subject || (i > 0 ? `Re: ${firstSubject}` : "No subject")}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.body.replace(/\n/g, " ") || "Empty"}</p>
            </button>
          </div>
        ))}
        <Button variant="outline" className="w-full border-dashed" onClick={add} data-testid="sequence-add-step-button"><Plus className="size-4" />Add follow-up step</Button>
      </div>

      <div className="space-y-5 lg:col-span-8">
        {cur && (
          <Panel
            title={`Step ${active + 1}`}
            action={
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRewriteOpen(true)}
                  className="border-cyan-500/40 text-cyan hover:border-cyan-500/70 hover:text-cyan"
                  data-testid="sequence-rewrite-button"
                >
                  <Wand2 className="size-4" /> Rewrite with AI
                </Button>
                <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="sequence-save-button">
                  {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {dirty ? "Save sequence" : "Saved"}
                </Button>
              </div>
            }
            testId="sequence-editor"
          >
            <div className="space-y-4 p-5">
              {active > 0 && (
                <div className="flex items-center gap-3">
                  <Label className="shrink-0">Send after</Label>
                  <Input type="number" min={0} max={60} value={cur.delay_days} onChange={(e) => patch({ delay_days: Math.max(0, Number(e.target.value) || 0) })} className="w-20" data-testid="step-delay-input" />
                  <span className="text-sm text-muted-foreground">days if no reply</span>
                </div>
              )}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>{cur.subject_b || abOpen[cur.id] ? "Subject A" : "Subject"}</Label>
                  {!cur.subject_b && !abOpen[cur.id] && (
                    <button type="button" onClick={() => setAbOpen({ ...abOpen, [cur.id]: true })} className="text-xs font-medium text-amber-300 hover:underline" data-testid="step-add-ab-button">
                      + A/B test subject
                    </button>
                  )}
                </div>
                <Input value={cur.subject} onChange={(e) => patch({ subject: e.target.value })} placeholder={active > 0 ? "Leave empty to reply in the same thread" : "Subject line"} data-testid="step-subject-input" />
              </div>
              {(cur.subject_b || abOpen[cur.id]) && (
                <div className="space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3" data-testid="step-ab-panel">
                  <div className="flex items-center justify-between">
                    <Label>Subject B</Label>
                    <button type="button" onClick={() => { patch({ subject_b: "", ab_winner: null }); setAbOpen({ ...abOpen, [cur.id]: false }); }} className="text-xs text-muted-foreground hover:text-red-300" data-testid="step-remove-ab-button">Remove test</button>
                  </div>
                  <Input value={cur.subject_b} onChange={(e) => patch({ subject_b: e.target.value })} placeholder="Alternative subject line" data-testid="step-subject-b-input" />
                  <p className="text-xs text-muted-foreground">
                    {cur.ab_winner
                      ? <span className="text-emerald-300" data-testid="step-ab-winner">Subject {cur.ab_winner.toUpperCase()} won on open rate — now sent to everyone. Edit a subject to restart the test.</span>
                      : "Leads are split 50/50. After each version reaches 20 sends, the one with the higher open rate is sent to everyone else."}
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Preheader <span className="font-normal text-muted-foreground">· preview text in the inbox</span></Label>
                <Input
                  value={cur.preheader}
                  onChange={(e) => patch({ preheader: e.target.value })}
                  placeholder="Short teaser Gmail shows beside the subject (optional)"
                  maxLength={140}
                  data-testid="step-preheader-input"
                />
                <p className="text-xs text-muted-foreground">Hidden on open. Keep it under ~90 characters so it fits the inbox preview on mobile.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-background p-3" data-testid="step-tracking-overrides">
                {([
                  ["track_opens", "Open tracking", "Pixel on this step"],
                  ["track_clicks", "Click tracking", "Rewrite links on this step"],
                ] as const).map(([k, l, d]) => {
                  const val = cur[k]; // null = inherit, true/false = override
                  const choice: "inherit" | "on" | "off" = val === null ? "inherit" : val ? "on" : "off";
                  return (
                    <div key={k} className="space-y-1.5">
                      <Label className="text-xs">{l}</Label>
                      <div className="flex gap-1 rounded-md border border-border p-0.5">
                        {([["inherit", "Inherit"], ["on", "On"], ["off", "Off"]] as const).map(([v, lbl]) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => patch({ [k]: v === "inherit" ? null : v === "on" } as Partial<Step>)}
                            data-testid={`step-${k}-${v}`}
                            className={cn(
                              "flex-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                              choice === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground/90",
                            )}
                            aria-pressed={choice === v}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{d}</p>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Body</Label>
                  <div className="flex flex-wrap gap-1">
                    {vars.map((v) => (
                      <button key={v} type="button" onClick={() => insertVar(`{{${v}}}`)} className="rounded-md border border-input bg-muted px-2 py-0.5 font-mono text-[11px] text-cyan transition-colors hover:border-cyan-500/50" data-testid={`insert-var-${v}`}>
                        {`{{${v}}}`}
                      </button>
                    ))}
                    <button type="button" onClick={() => insertVar("{Hi|Hey|Hello}")} className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-[11px] text-violet-200 transition-colors hover:border-violet-400/60" data-testid="insert-spintax">
                      {"{Hi|Hey|Hello}"}
                    </button>
                  </div>
                </div>
                <Textarea ref={bodyRef} value={cur.body} onChange={(e) => patch({ body: e.target.value })} onBlur={(e) => { lastSel.current = e.currentTarget.selectionStart; }} rows={11} className="font-mono text-[13px] leading-relaxed" data-testid="step-body-input" />
                <p className="text-xs text-muted-foreground">Plain text. Use <span className="font-mono">{"{{field|fallback}}"}</span> for a default when a value is empty, and <span className="font-mono text-violet-200">{"{a|b|c}"}</span> spintax so each send picks a random option{countVariants(cur.subject + cur.body) > 1 && <span className="text-violet-200" data-testid="spintax-variant-count"> ({countVariants(cur.subject + cur.subject_b + cur.body).toLocaleString()} combinations)</span>}. Links are tracked when click tracking is on.</p>
              </div>
            </div>
          </Panel>
        )}
        {cur && (
          <Panel
            title="Preview"
            action={
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="xs" onClick={() => setShuffle((x) => x + 1)} data-testid="preview-shuffle-button"><Shuffle className="size-3.5" />Shuffle</Button>
                {cur.subject_b.trim() && (
              <div className="flex gap-1 rounded-md border border-border p-0.5">
                {[false, true].map((b) => (
                  <button key={String(b)} type="button" onClick={() => setPreviewB(b)} data-testid={`preview-variant-${b ? "b" : "a"}`}
                    className={cn("rounded px-2 py-0.5 text-xs", previewB === b ? "bg-secondary text-foreground" : "text-muted-foreground")}>{b ? "B" : "A"}</button>
                ))}
              </div>
                )}
              </div>
            }
            testId="sequence-preview"
          >
            <div className="p-5 text-sm">
              <p className="text-xs text-muted-foreground">To: <span className="font-mono text-foreground/75">{SAMPLE.email}</span></p>
              <p className="mt-1 font-medium text-foreground" data-testid="preview-subject">{render(previewB && cur.subject_b.trim() ? cur.subject_b : cur.subject) || `Re: ${render(firstSubject)}`}</p>
              <div className="mt-4 whitespace-pre-wrap rounded-lg border border-border bg-background p-4 leading-relaxed text-foreground/75" data-testid="preview-body">
                {render(cur.body)}
                {campaign.include_unsubscribe && !cur.body.includes("unsubscribe_link") && <span className="text-muted-foreground">{"\n\n--\nNot interested? Unsubscribe here: https://…/unsubscribe"}</span>}
              </div>
            </div>
          </Panel>
        )}
      </div>
      </div>
      <RewriteDialog open={rewriteOpen} onClose={() => setRewriteOpen(false)} step={cur} onApply={applyRewrite} />
    </div>
  );
}

// ---------------- Settings tab ----------------
const HOURS = Array.from({ length: 25 }, (_, i) => i);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMEZONES = [
  "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Toronto", "America/Sao_Paulo",
  "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Amsterdam", "Europe/Stockholm",
  "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
];
const tzLabel = (z: string) => (z === "UTC" ? "UTC" : z.split("/").pop()!.replace(/_/g, " ") + ` (${z})`);

export function SettingsTab({ campaign }: { campaign: Campaign }) {
  const qc = useQueryClient();
  const senders = useQuery({ queryKey: ["senders"], queryFn: () => apiGet<Sender[]>("/senders") });
  const [s, setS] = useState({
    name: campaign.name, sender_ids: campaign.sender_ids, daily_limit: campaign.daily_limit,
    track_opens: campaign.track_opens, track_clicks: campaign.track_clicks, stop_on_reply: campaign.stop_on_reply,
    include_unsubscribe: campaign.include_unsubscribe,
    send_days: campaign.send_days, timezone: campaign.timezone, use_lead_timezone: campaign.use_lead_timezone,
    gap_min_minutes: campaign.gap_min_minutes, gap_max_minutes: campaign.gap_max_minutes,
    random_start_minutes: campaign.random_start_minutes,
    send_start_hour: campaign.send_start_hour, send_end_hour: campaign.send_end_hour,
    plain_text_only: campaign.plain_text_only, smart_subject: campaign.smart_subject,
    extra_jitter_minutes: campaign.extra_jitter_minutes,
    followup_priority: campaign.followup_priority,
  });
  const save = useMutation({
    mutationFn: () => apiPut<Campaign>(`/campaigns/${campaign.id}`, s),
    onSuccess: (c) => {
      qc.setQueryData(["campaign", campaign.id], c);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const toggleSender = (id: string, on: boolean) => setS({ ...s, sender_ids: on ? [...s.sender_ids, id] : s.sender_ids.filter((x) => x !== id) });
  const hourLabel = (h: number) => (h === 24 ? "24:00" : `${String(h).padStart(2, "0")}:00`);

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
      <Panel title="Sender rotation" testId="settings-senders-panel">
        <div className="p-5">
          <p className="mb-4 text-sm text-muted-foreground">Emails rotate across selected inboxes. Each lead keeps the same inbox for every follow-up.</p>
          <ul className="space-y-2">
            {(senders.data ?? []).map((x) => (
              <li key={x.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:border-foreground/20">
                  <Checkbox checked={s.sender_ids.includes(x.id)} onCheckedChange={(v) => toggleSender(x.id, !!v)} data-testid={`settings-sender-checkbox-${x.id}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm text-foreground/90">{x.email}</p>
                    <p className="text-xs text-muted-foreground">{x.from_name || "No display name"} · {x.daily_limit}/day</p>
                  </div>
                  {x.status === "error" && <Pill cls="border-red-500/30 bg-red-500/10 text-red-300">Error</Pill>}
                </label>
              </li>
            ))}
            {senders.data?.length === 0 && <li className="text-sm text-muted-foreground">No sender accounts connected yet.</li>}
          </ul>
        </div>
      </Panel>
      <Panel title={<span className="flex items-center gap-2"><CalendarDays className="size-4 text-cyan" />Sending calendar</span>} testId="settings-calendar-panel">
          <div className="space-y-5 p-5">
            <div className="space-y-2">
              <Label>Send on</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = s.send_days.includes(i);
                  return (
                    <button key={d} type="button" onClick={() => setS({ ...s, send_days: on ? s.send_days.filter((x) => x !== i) : [...s.send_days, i].sort() })}
                      className={cn("h-9 w-12 rounded-lg border text-xs font-semibold transition-colors duration-150", on ? "border-blue-500/60 bg-blue-600/15 text-white" : "border-border text-muted-foreground hover:border-foreground/20")}
                      data-testid={`settings-day-${i}`} aria-pressed={on}>
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-3 text-xs">
                <button type="button" className="text-cyan hover:underline" onClick={() => setS({ ...s, send_days: [0, 1, 2, 3, 4] })} data-testid="settings-days-weekdays">Weekdays only</button>
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => setS({ ...s, send_days: [0, 1, 2, 3, 4, 5, 6] })} data-testid="settings-days-all">Every day</button>
              </div>
              {s.send_days.length === 0 && <p className="text-xs text-red-300">Pick at least one day — nothing will send otherwise.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Send from</Label>
                <Select value={String(s.send_start_hour)} onValueChange={(v: string) => setS({ ...s, send_start_hour: Number(v) })}>
                  <SelectTrigger className="w-full" data-testid="settings-start-hour"><SelectValue>{(v) => hourLabel(Number(v))}</SelectValue></SelectTrigger>
                  <SelectContent>{HOURS.slice(0, 24).map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Until</Label>
                <Select value={String(s.send_end_hour)} onValueChange={(v: string) => setS({ ...s, send_end_hour: Number(v) })}>
                  <SelectTrigger className="w-full" data-testid="settings-end-hour"><SelectValue>{(v) => hourLabel(Number(v))}</SelectValue></SelectTrigger>
                  <SelectContent>{HOURS.slice(1).map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-background p-4" data-testid="settings-random-start-section">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Shuffle className="size-4 text-cyan" />Random daily start</p>
              <p className="text-xs text-muted-foreground">Each inbox starts its sending day up to this many minutes after "Send from" — a different random time every day.</p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-sm text-muted-foreground">Up to</span>
                <Input type="number" min={0} max={180} value={s.random_start_minutes} onChange={(e) => setS({ ...s, random_start_minutes: Math.min(180, Math.max(0, Number(e.target.value) || 0)) })} className="w-20" data-testid="settings-random-start-input" />
                <span className="text-sm text-muted-foreground">minutes late</span>
                {[0, 15, 30, 60].map((m) => (
                  <button key={m} type="button" onClick={() => setS({ ...s, random_start_minutes: m })}
                    className={cn("rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors", s.random_start_minutes === m ? "border-cyan-500/50 bg-cyan-500/10 text-cyan" : "border-input text-muted-foreground hover:text-foreground/90")}
                    data-testid={`settings-random-start-preset-${m}`}>{m === 0 ? "Off" : `${m}m`}</button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground" data-testid="settings-random-start-summary">
                {s.random_start_minutes ? `Inboxes start between ${hourLabel(s.send_start_hour)} and ${String(s.send_start_hour + Math.floor(s.random_start_minutes / 60)).padStart(2, "0")}:${String(s.random_start_minutes % 60).padStart(2, "0")}.` : `All inboxes start exactly at ${hourLabel(s.send_start_hour)}.`}
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-background p-4" data-testid="settings-gap-section">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Timer className="size-4 text-cyan" />Gap between emails</p>
              <p className="text-xs text-muted-foreground">After each email, that inbox waits a random time in this range before sending the next one, so sending looks human.</p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Input type="number" min={0} max={240} value={s.gap_min_minutes} onChange={(e) => setS({ ...s, gap_min_minutes: Math.min(240, Math.max(0, Number(e.target.value) || 0)) })} className="w-20" data-testid="settings-gap-min-input" />
                <span className="text-sm text-muted-foreground">to</span>
                <Input type="number" min={0} max={240} value={s.gap_max_minutes} onChange={(e) => setS({ ...s, gap_max_minutes: Math.min(240, Math.max(0, Number(e.target.value) || 0)) })} className="w-20" data-testid="settings-gap-max-input" />
                <span className="text-sm text-muted-foreground">minutes</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[[2, 5], [5, 10], [10, 15], [15, 30]].map(([a, b]) => (
                  <button key={a} type="button" onClick={() => setS({ ...s, gap_min_minutes: a, gap_max_minutes: b })}
                    className={cn("rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors", s.gap_min_minutes === a && s.gap_max_minutes === b ? "border-cyan-500/50 bg-cyan-500/10 text-cyan" : "border-input text-muted-foreground hover:text-foreground/90")}
                    data-testid={`settings-gap-preset-${a}-${b}`}>{a}–{b} min</button>
                ))}
              </div>
              {s.gap_min_minutes > s.gap_max_minutes && <p className="text-xs text-amber-300">Min is above max — they'll be swapped on save.</p>}
              {(() => {
                const avg = (s.gap_min_minutes + s.gap_max_minutes) / 2;
                const hrs = s.send_end_hour - s.send_start_hour;
                const per = avg > 0 ? Math.floor((hrs * 60) / avg) : null;
                return <p className="text-xs text-muted-foreground" data-testid="settings-gap-summary">{per === null ? "No gap — inboxes send as fast as the engine runs." : `≈ ${per} emails per inbox per day max in a ${hrs}h window (×${s.sender_ids.length} inboxes).`}</p>;
              })()}
            </div>
            <div className="space-y-1.5">
              <Label>Campaign timezone</Label>
              <Select value={s.timezone} onValueChange={(v: string) => setS({ ...s, timezone: v })}>
                <SelectTrigger className="w-full" data-testid="settings-timezone-select"><SelectValue>{(v) => tzLabel(v as string)}</SelectValue></SelectTrigger>
                <SelectContent className="max-h-72">{TIMEZONES.map((z) => <SelectItem key={z} value={z}>{tzLabel(z)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border bg-background p-4">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Globe className="size-4 text-cyan" />Send in each lead's timezone</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Uses the <span className="font-mono">timezone</span> CSV column (e.g. America/New_York). Leads without one fall back to the campaign timezone.</p>
              </div>
              <Switch checked={s.use_lead_timezone} onCheckedChange={(v) => setS({ ...s, use_lead_timezone: v })} data-testid="settings-use_lead_timezone-switch" />
            </label>
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="settings-calendar-summary">
              Sends {s.send_days.length === 7 ? "every day" : s.send_days.length === 0 ? "never" : DAYS.filter((_, i) => s.send_days.includes(i)).join(", ")} between {hourLabel(s.send_start_hour)} and {hourLabel(s.send_end_hour)} {s.use_lead_timezone ? "in each lead's local time" : tzLabel(s.timezone)}.
            </p>
          </div>
        </Panel>
      </div>
      <div className="space-y-6 lg:col-span-5">
        <Panel title="Campaign" testId="settings-general-panel">
          <div className="space-y-4 p-5">
            <div className="space-y-1.5"><Label>Name</Label><Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} data-testid="settings-name-input" /></div>
            <div className="space-y-1.5"><Label>Max emails per day (campaign)</Label><Input type="number" min={1} value={s.daily_limit} onChange={(e) => setS({ ...s, daily_limit: Math.max(1, Number(e.target.value) || 1) })} data-testid="settings-daily-limit-input" /></div>
          </div>
        </Panel>
        <Panel title="Tracking & behaviour" testId="settings-tracking-panel">
          <div className="divide-y divide-border">
            {([
              ["track_opens", "Track opens", "Adds an invisible 1px image to each email"],
              ["track_clicks", "Track clicks", "Rewrites links through a redirect"],
              ["stop_on_reply", "Stop on reply", "Halt the sequence when a lead replies"],
              ["include_unsubscribe", "Unsubscribe link", "Append a one-click opt-out link + List-Unsubscribe header"],
            ] as const).map(([k, l, d]) => (
              <label key={k} className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3.5">
                <div><p className="text-sm font-medium text-foreground">{l}</p><p className="text-xs text-muted-foreground">{d}</p></div>
                <Switch checked={s[k]} onCheckedChange={(v) => setS({ ...s, [k]: v })} data-testid={`settings-${k}-switch`} />
              </label>
            ))}
          </div>
        </Panel>
        <Panel title={<span className="flex items-center gap-2"><Timer className="size-4 text-cyan" />Human-send mode</span>} testId="settings-human-panel">
          <div className="divide-y divide-border">
            <label className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p className="text-sm font-medium text-foreground">Plain-text only</p>
                <p className="text-xs text-muted-foreground">Ship text/plain only — no HTML, no tracking pixel, raw URLs. Looks hand-typed to spam filters.</p>
              </div>
              <Switch checked={s.plain_text_only} onCheckedChange={(v) => setS({ ...s, plain_text_only: v })} data-testid="settings-plain_text_only-switch" />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p className="text-sm font-medium text-foreground">Smart "Re:" subject</p>
                <p className="text-xs text-muted-foreground">Follow-ups never show "Re: Re: Re:" — collapses stacked prefixes to one.</p>
              </div>
              <Switch checked={s.smart_subject} onCheckedChange={(v) => setS({ ...s, smart_subject: v })} data-testid="settings-smart_subject-switch" />
            </label>
            <div className="space-y-2 px-5 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Extra jitter per send</p>
                  <p className="text-xs text-muted-foreground">Shift each follow-up by ±N minutes so emails don't line up on the same clock minute.</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    value={s.extra_jitter_minutes}
                    onChange={(e) => setS({ ...s, extra_jitter_minutes: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })}
                    className="w-20"
                    data-testid="settings-extra-jitter-input"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[0, 3, 10, 20].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setS({ ...s, extra_jitter_minutes: m })}
                    className={cn("rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors", s.extra_jitter_minutes === m ? "border-cyan-500/50 bg-cyan-500/10 text-cyan" : "border-input text-muted-foreground hover:text-foreground/90")}
                    data-testid={`settings-extra-jitter-preset-${m}`}
                  >
                    {m === 0 ? "Off" : `±${m}m`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title={<span className="flex items-center gap-2"><Timer className="size-4 text-cyan" />Follow-up priority</span>} testId="settings-followup-panel">
          <div className="space-y-3 p-5">
            <div className="flex items-end justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>New leads</span>
              <span className="font-mono text-sm normal-case tracking-normal text-foreground" data-testid="settings-followup-label">
                {s.followup_priority === 50 ? "Balanced" : s.followup_priority >= 50 ? `${s.followup_priority}% Follow-ups` : `${100 - s.followup_priority}% New leads`}
              </span>
              <span>Follow-ups</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={s.followup_priority}
              onChange={(e) => setS({ ...s, followup_priority: Number(e.target.value) })}
              className="w-full accent-cyan-500"
              data-testid="settings-followup-slider"
              aria-label="Follow-up priority"
            />
            <p className="text-xs text-muted-foreground">
              When the engine has limited daily capacity, this decides who gets served first. Drag right to drain follow-ups before touching new leads (keeps conversations warm). Drag left to prioritize fresh outreach.
            </p>
          </div>
        </Panel>
        <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending} data-testid="settings-save-button">
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save settings
        </Button>
      </div>
    </div>
  );
}
