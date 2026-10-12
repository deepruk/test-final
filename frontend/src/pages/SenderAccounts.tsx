import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Flame, Loader2, MoreHorizontal, Pause, Play, Plug, Plus, Server, SlidersHorizontal, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import type { ConnectionTest, Sender, SenderIn, SenderUpdate } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { SENDER_STATUS, errMsg, fmt, timeAgo } from "@/lib/format";
import AppShell, { PageHeader } from "@/components/AppShell";
import { EmptyState, Pill, RateBar, StatCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const PRESETS: Record<string, Partial<SenderIn> & { label: string; hint: string }> = {
  gmail: { label: "Google / Gmail", smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_security: "starttls", imap_host: "imap.gmail.com", imap_port: 993, hint: "Enable 2-Step Verification, then create an App Password at myaccount.google.com/apppasswords." },
  outlook: { label: "Microsoft 365 / Outlook", smtp_host: "smtp.office365.com", smtp_port: 587, smtp_security: "starttls", imap_host: "outlook.office365.com", imap_port: 993, hint: "SMTP AUTH must be enabled for the mailbox in the Microsoft 365 admin center." },
  zoho: { label: "Zoho Mail", smtp_host: "smtp.zoho.com", smtp_port: 465, smtp_security: "ssl", imap_host: "imap.zoho.com", imap_port: 993, hint: "Generate an application-specific password in Zoho Accounts → Security." },
  custom: { label: "Custom SMTP / IMAP", hint: "Use the SMTP and IMAP details from your email provider." },
};

const EMPTY: SenderIn = {
  email: "", from_name: "", smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_security: "starttls", smtp_user: "", smtp_pass: "",
  imap_host: "imap.gmail.com", imap_port: 993, imap_user: "", imap_pass: "", daily_limit: 40,
  warmup_enabled: true, warmup_start: 5, warmup_increment: 3, signatures: [],
};

function WarmupFields({ v, onChange, idPrefix }: {
  v: { daily_limit: number; warmup_enabled: boolean; warmup_start: number; warmup_increment: number };
  onChange: (p: Partial<{ daily_limit: number; warmup_enabled: boolean; warmup_start: number; warmup_increment: number }>) => void; idPrefix: string;
}) {
  const days = v.warmup_enabled ? Math.max(1, Math.ceil((v.daily_limit - v.warmup_start) / Math.max(1, v.warmup_increment)) + 1) : 0;
  return (
    <fieldset className="space-y-3 rounded-lg border border-orange-500/20 bg-orange-500/[0.03] p-4" data-testid={`${idPrefix}-warmup-fieldset`}>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Flame className="size-4 text-orange-400" />Warm-up ramp</p>
          <p className="text-xs text-muted-foreground">Start low and raise the daily cap each day to build sender reputation.</p>
        </div>
        <Switch checked={v.warmup_enabled} onCheckedChange={(c) => onChange({ warmup_enabled: c })} data-testid={`${idPrefix}-warmup-switch`} />
      </label>
      {v.warmup_enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Start at (emails/day)</Label><Input type="number" min={1} value={v.warmup_start} onChange={(e) => onChange({ warmup_start: Math.max(1, Number(e.target.value) || 1) })} data-testid={`${idPrefix}-warmup-start-input`} /></div>
            <div className="space-y-1.5"><Label>Increase per day</Label><Input type="number" min={1} value={v.warmup_increment} onChange={(e) => onChange({ warmup_increment: Math.max(1, Number(e.target.value) || 1) })} data-testid={`${idPrefix}-warmup-increment-input`} /></div>
          </div>
          <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-warmup-summary`}>
            Day 1: {Math.min(v.warmup_start, v.daily_limit)}/day → reaches the full {v.daily_limit}/day on day {days}.
          </p>
        </>
      )}
    </fieldset>
  );
}

function EditLimitsDialog({ sender, onClose }: { sender: Sender | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ daily_limit: 40, warmup_enabled: false, warmup_start: 5, warmup_increment: 3, from_name: "", signatures: "" });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (sender && loadedFor !== sender.id) {
    setLoadedFor(sender.id);
    setV({ daily_limit: sender.daily_limit, warmup_enabled: sender.warmup_enabled, warmup_start: sender.warmup_start, warmup_increment: sender.warmup_increment, from_name: sender.from_name, signatures: (sender.signatures ?? []).join("\n---\n") });
  }
  const save = useMutation({
    mutationFn: () => {
      const sigs = v.signatures.split(/\n-{3,}\n/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
      const payload: SenderUpdate = {
        from_name: v.from_name, daily_limit: v.daily_limit,
        warmup_enabled: v.warmup_enabled, warmup_start: v.warmup_start, warmup_increment: v.warmup_increment,
        signatures: sigs,
      };
      return apiPatch<Sender>(`/senders/${sender?.id}`, payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["senders"] }); toast.success("Sending limits saved"); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const sigCount = v.signatures.split(/\n-{3,}\n/).map((x) => x.trim()).filter(Boolean).length;
  return (
    <Dialog open={!!sender} onOpenChange={(o) => { if (!o) { onClose(); setLoadedFor(null); } }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md scroll-thin" data-testid="edit-sender-dialog">
        <DialogHeader>
          <DialogTitle>Sending limits</DialogTitle>
          <DialogDescription className="font-mono">{sender?.email}</DialogDescription>
        </DialogHeader>
        <div className="my-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>From name</Label><Input value={v.from_name} onChange={(e) => setV({ ...v, from_name: e.target.value })} data-testid="edit-sender-from-name-input" /></div>
            <div className="space-y-1.5"><Label>Max per day</Label><Input type="number" min={1} max={2000} value={v.daily_limit} onChange={(e) => setV({ ...v, daily_limit: Math.max(1, Number(e.target.value) || 1) })} data-testid="edit-sender-daily-limit-input" /></div>
          </div>
          <WarmupFields v={v} onChange={(p) => setV({ ...v, ...p })} idPrefix="edit-sender" />
          <div className="space-y-1.5 rounded-lg border border-border bg-background p-4" data-testid="edit-sender-signatures-fieldset">
            <Label>Signatures <span className="font-normal text-muted-foreground">· 1–5, rotated per lead</span></Label>
            <Textarea
              rows={6}
              value={v.signatures}
              onChange={(e) => setV({ ...v, signatures: e.target.value })}
              placeholder={"Alex\nFounder, Northwind\n\n---\n\nAlex Morgan\nnorthwind.com"}
              className="font-mono text-[12px] leading-relaxed"
              data-testid="edit-sender-signatures-input"
            />
            <p className="text-xs text-muted-foreground">
              Separate signatures with a line of three dashes (<span className="font-mono">---</span>). Each lead keeps the same signature across follow-ups. <span className="font-mono text-foreground/75">{sigCount}</span> signature{sigCount === 1 ? "" : "s"} ready.
            </p>
          </div>
          {sender?.warmup_enabled && <p className="text-xs text-muted-foreground">Turning warm-up off and on again restarts the ramp from day 1.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="edit-sender-cancel">Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="edit-sender-save">{save.isPending && <Loader2 className="size-4 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestResult({ r, authType = "smtp" }: { r: ConnectionTest; authType?: string }) {
  const row = (ok: boolean, label: string, err: string) => (
    <div className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" />}
      <div><p className={ok ? "text-emerald-300" : "text-red-300"}>{label} {ok ? "connected" : "failed"}</p>{!ok && err && <p className="text-xs text-muted-foreground">{err}</p>}</div>
    </div>
  );
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3" data-testid="connection-test-result">
      {row(r.smtp_ok, authType === "google_oauth" ? "Gmail API (sending)" : "SMTP (sending)", r.smtp_error)}
      {row(r.imap_ok, authType === "google_oauth" ? "Gmail API (reply sync)" : "IMAP (reply sync)", r.imap_error)}
    </div>
  );
}

function AddSenderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [preset, setPreset] = useState("gmail");
  const [f, setF] = useState<SenderIn>(EMPTY);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const set = <K extends keyof SenderIn>(k: K, v: SenderIn[K]) => setF((p) => ({ ...p, [k]: v }));
  const payload = (): SenderIn => ({ ...f, smtp_user: f.smtp_user || f.email, imap_user: f.imap_user || f.smtp_user || f.email, imap_pass: f.imap_pass || f.smtp_pass });
  const test = useMutation({
    mutationFn: () => apiPost<ConnectionTest>("/senders/test", payload()),
    onSuccess: setResult,
    onError: (e) => toast.error(errMsg(e)),
  });
  const create = useMutation({
    mutationFn: () => apiPost<Sender>("/senders", payload()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["senders"] });
      toast.success("Sender account connected");
      onOpenChange(false);
      setF(EMPTY);
      setResult(null);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const applyPreset = (k: string) => {
    setPreset(k);
    const p = PRESETS[k];
    setF((prev) => ({ ...prev, ...(k === "custom" ? {} : { smtp_host: p.smtp_host!, smtp_port: p.smtp_port!, smtp_security: p.smtp_security!, imap_host: p.imap_host!, imap_port: p.imap_port! }) }));
  };
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl scroll-thin" data-testid="add-sender-dialog">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Connect a sender account</DialogTitle>
            <DialogDescription>{PRESETS[preset].hint}</DialogDescription>
          </DialogHeader>
          <div className="my-5 space-y-5">
            <Button type="button" variant="outline" className="w-full justify-center gap-2 border-blue-500/40" onClick={() => { window.location.assign("/api/senders/google/oauth/start"); }} data-testid="connect-google-oauth-button">
              <span className="grid size-5 place-items-center rounded-full bg-white text-xs font-bold text-blue-600">G</span>
              Continue with Google
            </Button>
            <p className="text-center text-xs text-muted-foreground">Secure OAuth connection. No Gmail password or App Password required.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(PRESETS).map(([k, p]) => (
                <button key={k} type="button" onClick={() => applyPreset(k)} data-testid={`sender-preset-${k}`}
                  className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors duration-150 ${preset === k ? "border-blue-500/60 bg-blue-600/10 text-white" : "border-border text-muted-foreground hover:border-foreground/20"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2"><Label>Email address</Label><Input type="email" required value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="you@yourdomain.com" data-testid="sender-email-input" /></div>
              <div className="space-y-1.5"><Label>Daily limit</Label><Input type="number" min={1} max={2000} value={f.daily_limit} onChange={(e) => set("daily_limit", Number(e.target.value) || 1)} data-testid="sender-daily-limit-input" /></div>
              <div className="space-y-1.5 sm:col-span-3"><Label>From name</Label><Input value={f.from_name} onChange={(e) => set("from_name", e.target.value)} placeholder="Alex Morgan" data-testid="sender-from-name-input" /></div>
            </div>
            <fieldset className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">SMTP · sending</legend>
              <div className="grid gap-3 sm:grid-cols-6">
                <div className="space-y-1.5 sm:col-span-3"><Label>Host</Label><Input required value={f.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} data-testid="sender-smtp-host-input" /></div>
                <div className="space-y-1.5"><Label>Port</Label><Input type="number" required value={f.smtp_port} onChange={(e) => set("smtp_port", Number(e.target.value))} data-testid="sender-smtp-port-input" /></div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Security</Label>
                  <Select value={f.smtp_security} onValueChange={(v: string) => set("smtp_security", v as SenderIn["smtp_security"])}>
                    <SelectTrigger className="w-full" data-testid="sender-smtp-security-select"><SelectValue>{(v) => ({ ssl: "SSL/TLS", starttls: "STARTTLS", none: "None" })[v as string]}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="starttls">STARTTLS</SelectItem><SelectItem value="ssl">SSL/TLS</SelectItem><SelectItem value="none">None</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-3"><Label>Username</Label><Input value={f.smtp_user} onChange={(e) => set("smtp_user", e.target.value)} placeholder="Defaults to email" data-testid="sender-smtp-user-input" /></div>
                <div className="space-y-1.5 sm:col-span-3"><Label>Password / app password</Label><Input type="password" required value={f.smtp_pass} onChange={(e) => set("smtp_pass", e.target.value)} data-testid="sender-smtp-pass-input" /></div>
              </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">IMAP · reply sync (SSL)</legend>
              <div className="grid gap-3 sm:grid-cols-6">
                <div className="space-y-1.5 sm:col-span-4"><Label>Host</Label><Input value={f.imap_host} onChange={(e) => set("imap_host", e.target.value)} placeholder="Leave empty to skip reply sync" data-testid="sender-imap-host-input" /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label>Port</Label><Input type="number" value={f.imap_port} onChange={(e) => set("imap_port", Number(e.target.value))} data-testid="sender-imap-port-input" /></div>
                <div className="space-y-1.5 sm:col-span-3"><Label>Username</Label><Input value={f.imap_user} onChange={(e) => set("imap_user", e.target.value)} placeholder="Same as SMTP" data-testid="sender-imap-user-input" /></div>
                <div className="space-y-1.5 sm:col-span-3"><Label>Password</Label><Input type="password" value={f.imap_pass} onChange={(e) => set("imap_pass", e.target.value)} placeholder="Same as SMTP" data-testid="sender-imap-pass-input" /></div>
              </div>
            </fieldset>
            <WarmupFields v={f} onChange={(p) => setF((prev) => ({ ...prev, ...p }))} idPrefix="sender" />
            {result && <TestResult r={result} />}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !f.email || !f.smtp_pass} data-testid="sender-test-connection-button">
              {test.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} Test connection
            </Button>
            <Button type="submit" disabled={create.isPending} data-testid="sender-save-button">
              {create.isPending && <Loader2 className="size-4 animate-spin" />} Connect account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SenderAccounts() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [open, setOpenRaw] = useState(params.get("connect") === "1");
  useEffect(() => { if (params.get("connect") === "1") setOpenRaw(true); }, [params]);
  const setOpen = (v: boolean) => { setOpenRaw(v); if (!v && params.get("connect")) setParams({}); };
  const [testRes, setTestRes] = useState<{ id: string; r: ConnectionTest } | null>(null);
  const [editing, setEditing] = useState<Sender | null>(null);
  const senders = useQuery({ queryKey: ["senders"], queryFn: () => apiGet<Sender[]>("/senders") });
  const inv = () => qc.invalidateQueries({ queryKey: ["senders"] });
  useEffect(() => {
    const status = params.get("google_oauth");
    if (!status) return;
    if (status === "connected") {
      toast.success("Gmail connected with Google OAuth");
      qc.invalidateQueries({ queryKey: ["senders"] });
    } else {
      const reason = params.get("reason");
      const message = reason === "consent_denied" ? "Google authorization was cancelled."
        : reason === "state_expired" ? "Google authorization expired. Please try again."
        : "Could not connect Gmail. Check the Google OAuth configuration and try again.";
      toast.error(message);
    }
    const next = new URLSearchParams(params);
    next.delete("google_oauth");
    next.delete("reason");
    setParams(next, { replace: true });
  }, [params, setParams, qc]);
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<Sender, "status" | "daily_limit">> }) => apiPatch<Sender>(`/senders/${id}`, body),
    onSuccess: () => { inv(); toast.success("Sender updated"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/senders/${id}`),
    onSuccess: () => { inv(); toast.success("Sender removed"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const test = useMutation({
    mutationFn: (id: string) => apiPost<ConnectionTest>(`/senders/${id}/test`),
    onSuccess: (r, id) => { setTestRes({ id, r }); inv(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const list = senders.isError ? [] : senders.data ?? [];
  const cap = list.reduce((a, s) => a + s.effective_limit, 0);
  const today = list.reduce((a, s) => a + s.sent_today, 0);
  const healthy = list.filter((s) => s.status === "active" || s.status === "demo").length;

  return (
    <AppShell>
      <PageHeader
        title="Sender Accounts"
        subtitle="The inboxes your campaigns send from and sync replies into."
        actions={<Button onClick={() => setOpen(true)} data-testid="add-sender-button"><Plus className="size-4" /> Connect inbox</Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard testId="senders-kpi-total" label="Connected inboxes" value={fmt(list.length)} icon={Server} />
        <StatCard testId="senders-kpi-healthy" label="Healthy" value={`${healthy}/${list.length}`} icon={CheckCircle2} accent="text-emerald-300" />
        <StatCard testId="senders-kpi-capacity" label="Daily capacity" value={fmt(cap)} sub={`emails / day · ${list.filter((s) => s.warmup_enabled && s.effective_limit < s.daily_limit).length} warming up`} />
        <StatCard testId="senders-kpi-today" label="Sent today" value={fmt(today)} sub={`${cap ? ((today / cap) * 100).toFixed(0) : 0}% of capacity`} />
      </div>

      {senders.data && list.length === 0 ? (
        <EmptyState icon={Server} testId="senders-empty" title="Connect your first inbox" body="Add any Gmail, Outlook or custom-domain mailbox with SMTP + IMAP credentials."
          action={<Button onClick={() => setOpen(true)} data-testid="empty-add-sender-button"><Plus className="size-4" />Connect inbox</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s, i) => (
            <div key={s.id} className="group rounded-xl border border-border bg-panel p-5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 animate-fade-up" style={{ animationDelay: `${i * 50}ms` }} data-testid={`sender-card-${s.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium text-foreground">{s.email}</p>
                  <p className="text-xs text-muted-foreground">{s.from_name || "—"} · {s.smtp_host}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" data-testid={`sender-menu-${s.id}`} />}>
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => test.mutate(s.id)} data-testid={`sender-test-${s.id}`}><Plug className="size-4" />Test connection</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setEditing(s)} data-testid={`sender-edit-limits-${s.id}`}><SlidersHorizontal className="size-4" />Limits & warm-up</DropdownMenuItem>
                    {s.status !== "demo" && (s.status === "paused" ? (
                      <DropdownMenuItem onClick={() => patch.mutate({ id: s.id, body: { status: "active" } })} data-testid={`sender-resume-${s.id}`}><Play className="size-4" />Resume sending</DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => patch.mutate({ id: s.id, body: { status: "paused" } })} data-testid={`sender-pause-${s.id}`}><Pause className="size-4" />Pause sending</DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => del.mutate(s.id)} data-testid={`sender-delete-${s.id}`}><Trash2 className="size-4" />Remove</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Pill cls={SENDER_STATUS[s.status].cls} testId={`sender-status-${s.id}`}>{SENDER_STATUS[s.status].label}</Pill>
                {s.auth_type === "google_oauth" && <Pill cls="border-blue-500/30 bg-blue-500/10 text-blue-300">Google OAuth</Pill>}
                {s.warmup_enabled && (
                  <Pill cls={s.effective_limit < s.daily_limit ? "border-orange-500/30 bg-orange-500/10 text-orange-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"} testId={`sender-warmup-${s.id}`}>
                    <Flame className="size-3" />{s.effective_limit < s.daily_limit ? `Warm-up day ${s.warmup_day}` : "Warm-up complete"}
                  </Pill>
                )}
              </div>
              {s.last_error && <p className="mt-2 line-clamp-2 text-xs text-red-300" data-testid={`sender-error-${s.id}`}>{s.last_error}</p>}
              <div className="mt-5">
                <div className="mb-1.5 flex justify-between font-mono text-xs"><span className="text-muted-foreground">Sent today</span><span className="text-foreground/90">{s.sent_today}/{s.effective_limit}</span></div>
                <RateBar value={(s.sent_today / Math.max(1, s.effective_limit)) * 100} color={s.status === "error" ? "bg-red-500" : "bg-cyan-500"} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center font-mono">
                <div><p className="text-base text-foreground">{fmt(s.sent_total)}</p><p className="text-[10px] uppercase text-muted-foreground">Sent</p></div>
                <div><p className="text-base text-emerald-300">{fmt(s.reply_count)}</p><p className="text-[10px] uppercase text-muted-foreground">Replies</p></div>
                <div><p className="text-xs leading-6 text-foreground/75">{s.imap_host ? timeAgo(s.last_synced_at) : "off"}</p><p className="text-[10px] uppercase text-muted-foreground">IMAP sync</p></div>
              </div>
              {s.warmup_enabled && s.effective_limit < s.daily_limit && (
                <div className="mt-3" data-testid={`sender-warmup-progress-${s.id}`}>
                  <div className="mb-1 flex justify-between font-mono text-[11px] text-muted-foreground"><span>Ramp {s.effective_limit}/{s.daily_limit} per day</span><span>+{s.warmup_increment}/day</span></div>
                  <RateBar value={(s.effective_limit / s.daily_limit) * 100} color="bg-orange-400" />
                </div>
              )}
              {testRes?.id === s.id && <div className="mt-4"><TestResult r={testRes.r} authType={s.auth_type} /></div>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-8 grid gap-4 lg:grid-cols-3" data-testid="deliverability-guide">
        <div className="rounded-xl border border-border bg-panel p-6 lg:col-span-2">
          <p className="text-xs font-medium text-primary">Deliverability checklist</p>
          <h2 className="mt-1 font-heading text-lg font-semibold text-foreground">Before you send from a new domain</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ["SPF record", "Authorize your mail provider: v=spf1 include:_spf.google.com ~all"],
              ["DKIM signing", "Enable DKIM in Google Workspace / Microsoft 365 and publish the TXT key."],
              ["DMARC policy", "Start with v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com"],
              ["Custom tracking domain", "Point a subdomain (e.g. track.yourdomain.com) at this app for opens & clicks."],
              ["Warm-up ramp", "Keep warm-up on for 2–3 weeks; start at 5/day, +3/day."],
              ["Separate sending domain", "Use lookalike domains (getbrand.com) so your main domain stays clean."],
            ].map(([t, b]) => (
              <li key={t} className="flex gap-3 rounded-lg border border-border bg-background p-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                <div><p className="text-sm font-medium text-foreground">{t}</p><p className="mt-0.5 font-mono text-[11px] leading-relaxed text-muted-foreground">{b}</p></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-gradient-to-b from-primary/[0.07] to-panel p-6">
          <p className="text-xs font-medium text-primary">Recommended limits</p>
          <h2 className="mt-1 font-heading text-lg font-semibold text-foreground">Healthy sending volume</h2>
          <div className="mt-4 space-y-3 text-sm">
            {[["Week 1", "5–15 / day"], ["Week 2", "15–30 / day"], ["Week 3+", "30–50 / day"], ["Gap between sends", "8–15 min"], ["Inboxes per domain", "2–3 max"]].map(([a, b]) => (
              <div key={a} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0"><span className="text-muted-foreground">{a}</span><span className="font-mono text-foreground">{b}</span></div>
            ))}
          </div>
        </div>
      </div>
      <AddSenderDialog open={open} onOpenChange={setOpen} />
      <EditLimitsDialog sender={editing} onClose={() => setEditing(null)} />
    </AppShell>
  );
}
