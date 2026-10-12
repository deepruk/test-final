import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, Gauge, Timer, Workflow, Loader2, MessageSquareReply, MousePointerClick, Pause, Play, Send, ShieldAlert, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import type { Analytics, Campaign, CampaignLive } from "@/lib/types";
import { CAMPAIGN_STATUS, errMsg, fmt, pctFmt } from "@/lib/format";
import AppShell from "@/components/AppShell";
import { LeadsTab, SequenceTab, SettingsTab } from "@/components/CampaignTabs";
import { Panel, PerformanceChart, Pill, RateBar, SeriesToggles, StatCard, type SeriesKey } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { scoreCampaign, scoreBand } from "@/lib/spam";

function useNow(ms = 1000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setT(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return t;
}

function LiveBar({ campaign }: { campaign: Campaign }) {
  const live = useQuery({ queryKey: ["campaign-live", campaign.id, campaign.status], queryFn: () => apiGet<CampaignLive>(`/campaigns/${campaign.id}/live`), refetchInterval: 10000 });
  const nowMs = useNow();
  const d = live.isError ? undefined : live.data;
  let next = "N/A";
  let nextSub = d?.next_note ?? "";
  if (d?.next_email_at) {
    const secs = Math.round((new Date(d.next_email_at).getTime() - nowMs) / 1000);
    next = secs <= 30 ? "Any moment" : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
    if (!nextSub) nextSub = new Date(d.next_email_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const pct = d?.capacity_used_pct ?? 0;
  const items = [
    { icon: Gauge, label: "Sending capacity", value: d ? `${pct.toFixed(0)}% used` : "—", sub: d ? `${d.sent_today}/${d.daily_capacity} today` : "", tone: pct >= 100 ? "text-amber-300" : "text-emerald-300", id: "capacity" },
    { icon: Workflow, label: "Active sequences", value: d ? fmt(d.active_sequences) : "—", sub: "leads still in sequence", tone: "text-foreground", id: "active" },
    { icon: Send, label: "Emails sent (30m)", value: d ? fmt(d.sent_last_30m) : "—", sub: `gap ${campaign.gap_min_minutes}–${campaign.gap_max_minutes} min per inbox`, tone: "text-foreground", id: "sent30" },
    { icon: Timer, label: "Next email in", value: next, sub: nextSub, tone: d?.next_email_at ? "text-cyan" : "text-muted-foreground", id: "next" },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 divide-border overflow-hidden rounded-xl border border-border bg-panel lg:grid-cols-4 lg:divide-x" data-testid="campaign-live-bar">
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-3 px-5 py-3.5" data-testid={`live-${it.id}`}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary"><it.icon className="size-4 text-cyan" /></span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{it.label}</p>
            <p className={`font-mono text-[15px] font-semibold ${it.tone}`} data-testid={`live-${it.id}-value`}>{it.value}</p>
            {it.sub && <p className="truncate text-[11px] text-muted-foreground" data-testid={`live-${it.id}-sub`}>{it.sub}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Overview({ campaign }: { campaign: Campaign }) {
  const [visible, setVisible] = useState<SeriesKey[]>(["sent", "opened", "clicked", "replied"]);
  const a = useQuery({ queryKey: ["campaign-analytics", campaign.id], queryFn: () => apiGet<Analytics>(`/campaigns/${campaign.id}/analytics?days=14`) });
  const t = campaign.stats;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard testId="campaign-kpi-leads" label="Leads" value={fmt(t.leads)} icon={Users} />
        <StatCard testId="campaign-kpi-sent" label="Sent" value={fmt(t.sent)} icon={Send} />
        <StatCard testId="campaign-kpi-open-rate" label="Open rate" value={pctFmt(t.open_rate)} sub={`${t.opened} opened`} icon={Eye} />
        <StatCard testId="campaign-kpi-click-rate" label="Click rate" value={pctFmt(t.click_rate)} sub={`${t.clicked} clicked`} icon={MousePointerClick} accent="text-amber-300" />
        <StatCard testId="campaign-kpi-reply-rate" label="Reply rate" value={pctFmt(t.reply_rate)} sub={`${t.replied} replied`} icon={MessageSquareReply} accent="text-emerald-300" />
        <StatCard testId="campaign-kpi-bounce-rate" label="Bounce rate" value={pctFmt(t.bounce_rate)} sub={`${t.bounced} bounced · ${t.unsubscribed} unsub`} icon={ShieldAlert} accent="text-red-300" />
      </div>
      <Panel title="Daily activity" action={<SeriesToggles visible={visible} onChange={setVisible} />} testId="campaign-chart-panel">
        <div className="p-4">{a.data ? <PerformanceChart data={a.data.series} visible={visible} height={260} /> : <div className="h-[260px] animate-pulse rounded-lg bg-muted" />}</div>
      </Panel>
      <Panel title="Step performance" testId="campaign-steps-panel">
        <div className="divide-y divide-border">
          {(a.data?.steps ?? []).map((s) => (
            <div key={s.step} className="grid grid-cols-2 items-center gap-4 px-5 py-4 md:grid-cols-12" data-testid={`step-stat-${s.step}`}>
              <div className="col-span-2 min-w-0 md:col-span-4">
                <span className="font-mono text-[11px] uppercase text-cyan">Step {s.step}</span>
                <p className="truncate text-sm text-foreground/90">{s.subject || "Same-thread follow-up"}</p>
              </div>
              {([["Sent", s.sent, 100, "bg-blue-500"], ["Opened", s.opened, s.sent ? (s.opened / s.sent) * 100 : 0, "bg-sky-400"],
                ["Clicked", s.clicked, s.sent ? (s.clicked / s.sent) * 100 : 0, "bg-amber-400"], ["Replied", s.replied, s.sent ? (s.replied / s.sent) * 100 : 0, "bg-emerald-400"]] as const).map(([l, v, p, c]) => (
                <div key={l} className="md:col-span-2">
                  <div className="mb-1 flex justify-between font-mono text-xs"><span className="text-muted-foreground">{l}</span><span className="text-foreground/90">{v}</span></div>
                  <RateBar value={p} color={c} />
                </div>
              ))}
              {s.variants.length > 0 && (
                <div className="col-span-2 grid gap-2 md:col-span-12 md:grid-cols-2" data-testid={`step-ab-results-${s.step}`}>
                  {s.variants.map((v) => {
                    const win = s.ab_winner === v.variant;
                    return (
                      <div key={v.variant} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${win ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-border bg-background"}`} data-testid={`step-${s.step}-variant-${v.variant}`}>
                        <span className={`grid size-6 shrink-0 place-items-center rounded font-mono text-xs font-bold ${win ? "bg-emerald-500 text-white" : "bg-secondary text-foreground/75"}`}>{v.variant.toUpperCase()}</span>
                        <p className="min-w-0 flex-1 truncate text-xs text-foreground/75">{v.subject}</p>
                        <span className="font-mono text-xs text-muted-foreground">{v.sent} sent</span>
                        <span className="font-mono text-xs text-sky-300">{pctFmt(v.open_rate)} open</span>
                        {win && <span className="text-[10px] font-semibold uppercase text-emerald-300">Winner</span>}
                      </div>
                    );
                  })}
                  {!s.ab_winner && <p className="text-[11px] text-muted-foreground md:col-span-2">A/B test running — a winner is chosen automatically after 20 sends per version.</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export default function CampaignDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState(false);
  const [launchWarn, setLaunchWarn] = useState<null | { score: number; label: string; critical: number; warnings: number }>(null);
  const c = useQuery({ queryKey: ["campaign", id], queryFn: () => apiGet<Campaign>(`/campaigns/${id}`), refetchInterval: 30000 });
  const refresh = (data: Campaign) => {
    qc.setQueryData(["campaign", id], data);
    qc.invalidateQueries({ queryKey: ["campaigns"] });
    qc.invalidateQueries({ queryKey: ["campaign-live", id] });
  };
  const launch = useMutation({
    mutationFn: () => apiPost<Campaign>(`/campaigns/${id}/launch`),
    onSuccess: (d) => { refresh(d); setLaunchWarn(null); toast.success("Campaign launched — the engine will start sending within a minute"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const tryLaunch = () => {
    if (!c.data) return;
    const s = scoreCampaign({ steps: c.data.steps, include_unsubscribe: c.data.include_unsubscribe });
    const band = scoreBand(s.score);
    // Hard gate: block Launch when score drops below 60 (= Risky). User can override from the dialog.
    if (s.score < 60) {
      setLaunchWarn({ score: s.score, label: band.label, critical: s.critical, warnings: s.warnings });
      return;
    }
    launch.mutate();
  };
  const pause = useMutation({
    mutationFn: () => apiPost<Campaign>(`/campaigns/${id}/pause`),
    onSuccess: (d) => { refresh(d); toast.success("Campaign paused"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: () => apiDelete(`/campaigns/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["campaigns"] }); toast.success("Campaign deleted"); navigate("/campaigns"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const camp = c.isError ? undefined : c.data;
  const st = camp ? CAMPAIGN_STATUS[camp.status] : undefined;

  return (
    <AppShell>
      <Link to="/campaigns" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground" data-testid="back-to-campaigns-link">
        <ArrowLeft className="size-4" /> Campaigns
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fade-up">
        <div className="min-w-0">
          <h1 className="truncate font-heading text-2xl font-bold text-foreground sm:text-[28px]" data-testid="campaign-title">{camp?.name ?? (c.isError ? "Campaign unavailable" : "Loading…")}</h1>
          {camp && st && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Pill cls={st.cls} dot={st.dot} testId="campaign-status-badge">{st.label}</Pill>
              <span className="text-xs text-muted-foreground">{camp.steps.length} steps · {camp.sender_ids.length} inboxes · {camp.progress.toFixed(0)}% complete</span>
            </div>
          )}
        </div>
        {camp && (
          <div className="flex gap-2">
            {camp.status === "active" ? (
              <Button variant="outline" onClick={() => pause.mutate()} disabled={pause.isPending} data-testid="campaign-pause-button">
                {pause.isPending ? <Loader2 className="size-4 animate-spin" /> : <Pause className="size-4" />} Pause
              </Button>
            ) : (
              <Button onClick={tryLaunch} disabled={launch.isPending} className="bg-emerald-600 hover:bg-emerald-500" data-testid="campaign-launch-button">
                {launch.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {camp.status === "paused" ? "Resume" : "Launch"}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setConfirmDel(true)} data-testid="campaign-delete-button" aria-label="Delete campaign">
              <Trash2 className="size-4 text-muted-foreground" />
            </Button>
          </div>
        )}
      </div>

      {camp && (
        <>
        <LiveBar campaign={camp} />
        <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) })}>
          <TabsList variant="line" className="mb-6 border-b border-border w-full justify-start rounded-none">
            {[["overview", "Overview"], ["leads", `Leads (${camp.stats.leads})`], ["sequence", "Sequence"], ["settings", "Settings"]].map(([k, l]) => (
              <TabsTrigger key={k} value={k} className="flex-none px-4" data-testid={`campaign-tab-${k}`}>{l}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview" className="animate-fade-up"><Overview campaign={camp} /></TabsContent>
          <TabsContent value="leads" className="animate-fade-up"><LeadsTab campaign={camp} /></TabsContent>
          <TabsContent value="sequence" className="animate-fade-up"><SequenceTab key={camp.steps.map((s) => s.id).join()} campaign={camp} /></TabsContent>
          <TabsContent value="settings" className="animate-fade-up"><SettingsTab campaign={camp} /></TabsContent>
        </Tabs>
        </>
      )}

      <Dialog open={confirmDel} onOpenChange={setConfirmDel}>
        <DialogContent className="sm:max-w-md" data-testid="delete-campaign-dialog">
          <DialogHeader>
            <DialogTitle>Delete this campaign?</DialogTitle>
            <DialogDescription>All leads, sent-email stats and inbox conversations for this campaign will be removed permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(false)} data-testid="delete-campaign-cancel">Cancel</Button>
            <Button variant="destructive" onClick={() => del.mutate()} disabled={del.isPending} data-testid="delete-campaign-confirm">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!launchWarn} onOpenChange={(o) => { if (!o) setLaunchWarn(null); }}>
        <DialogContent className="sm:max-w-md" data-testid="launch-gate-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-red-400" /> Launch anyway?
            </DialogTitle>
            <DialogDescription>
              This campaign's spam score is <span className="font-mono font-semibold text-red-300" data-testid="launch-gate-score">{launchWarn?.score}/100</span> ({launchWarn?.label}).
              {launchWarn && launchWarn.critical > 0 && <> {launchWarn.critical} critical and {launchWarn.warnings} warning issue{launchWarn.warnings === 1 ? "" : "s"} will likely land these in Spam.</>}
              <br /><br />
              Fix the red items on the Sequence tab first — or launch anyway if you know what you're doing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLaunchWarn(null); setParams({ tab: "sequence" }); }} data-testid="launch-gate-fix">
              Open Sequence tab
            </Button>
            <Button variant="destructive" onClick={() => launch.mutate()} disabled={launch.isPending} data-testid="launch-gate-force">
              {launch.isPending && <Loader2 className="size-4 animate-spin" />} Launch anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
