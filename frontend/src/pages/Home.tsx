import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BarChart3, BookOpen, CalendarClock, Check, ChevronDown, Clock3, Gauge, Globe2, Inbox, Layers, LifeBuoy,
  MailCheck, Minus, Newspaper, Server, ShieldCheck, Shuffle, Sliders, Sparkles, Timer, Wand2, Zap,
} from "lucide-react";
import { Logo, ThemeToggle } from "@/components/AppShell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRODUCT_MENU = [
  { icon: Layers, title: "Sequences", body: "Multi-step campaigns with A/B subjects and spintax", href: "#product" },
  { icon: Server, title: "Inbox rotation", body: "Unlimited SMTP/IMAP inboxes with daily caps", href: "#product" },
  { icon: Inbox, title: "Master Inbox", body: "Every reply, auto-labelled, in one place", href: "#product" },
  { icon: BarChart3, title: "Analytics", body: "Opens, clicks, replies per step and campaign", href: "#product" },
  { icon: ShieldCheck, title: "Deliverability", body: "Warm-up ramp, gaps, random starts, unsubscribe", href: "#deliverability" },
  { icon: Flame, title: "Hot-lead alerts", body: "Instant ping when a lead says yes", href: "#product" },
];
const RESOURCES_MENU = [
  { icon: BookOpen, title: "Setup guide", body: "Connect Gmail, Outlook & custom SMTP", href: "#faq" },
  { icon: Newspaper, title: "Cold email playbook", body: "Copy frameworks that get replies", href: "#product" },
  { icon: LifeBuoy, title: "Support", body: "Talk to a human, not a bot", href: "mailto:support@outreachforge.io" },
];

function NavMenu({ label, items, id }: { label: string; items: typeof PRODUCT_MENU; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground" data-testid={`landing-menu-${id}`} aria-expanded={open}>
        {label}<ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-40 -translate-x-1/2 pt-2">
          <div className={cn("grid gap-1 rounded-xl border border-border bg-popover p-2 shadow-2xl shadow-black/10 animate-slide-down", items.length > 3 ? "w-[560px] grid-cols-2" : "w-80")} data-testid={`landing-menu-${id}-panel`}>
            {items.map((it) => (
              <a key={it.title} href={it.href} onClick={() => setOpen(false)} className="group flex gap-3 rounded-lg p-3 transition-colors hover:bg-secondary">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-panel text-primary transition-colors group-hover:border-primary/40"><it.icon className="size-4" /></span>
                <span><span className="block text-sm font-medium text-foreground">{it.title}</span><span className="block text-xs leading-relaxed text-muted-foreground">{it.body}</span></span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductMock() {
  const bars = [32, 45, 38, 52, 61, 48, 66, 72, 58, 77, 84, 70, 88, 93];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel shadow-2xl shadow-blue-950/20" data-testid="hero-product-mock">
      <div className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-3 py-2">
        <span className="size-2.5 rounded-full bg-red-400/80" /><span className="size-2.5 rounded-full bg-amber-400/80" /><span className="size-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-3 rounded-md bg-background px-3 py-0.5 font-mono text-[10px] text-muted-foreground">app.outreachforge.io/dashboard</span>
      </div>
      <div className="grid grid-cols-12">
        <div className="col-span-3 hidden space-y-1 border-r border-border p-3 sm:block">
          {["Dashboard", "Campaigns", "Master Inbox", "Senders", "Activity", "Analytics"].map((n, i) => (
            <div key={n} className={cn("rounded-md px-2 py-1.5 text-[11px]", i === 0 ? "bg-secondary font-medium text-foreground" : "text-muted-foreground")}>{n}</div>
          ))}
        </div>
        <div className="col-span-12 space-y-3 p-4 sm:col-span-9">
          <div className="grid grid-cols-4 gap-2">
            {[["Sent", "12,480"], ["Open rate", "51.3%"], ["Reply rate", "8.4%"], ["Meetings", "37"]].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-border bg-background p-2.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{l}</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">{v}</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>Outreach performance · 14d</span><span className="text-emerald-300">+18.2%</span></div>
            <div className="flex h-24 items-end gap-1.5">
              {bars.map((h, i) => (
                <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-blue-600/40 to-sky-400/80 animate-fade-up" style={{ height: `${h}%`, animationDelay: `${i * 40}ms` }} />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {[["Priya Shah", "Booked Thursday 2pm — send the invite!", "Meeting booked", "text-indigo-300 bg-indigo-500/12 border-indigo-500/30"],
              ["Liam Brooks", "Can you share pricing for 10 seats?", "Interested", "text-emerald-300 bg-emerald-500/12 border-emerald-500/30"]].map(([n, t, l, c]) => (
              <div key={n} className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2">
                <span className="grid size-6 place-items-center rounded-full bg-secondary text-[10px] font-semibold">{n[0]}</span>
                <div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-foreground">{n}</p><p className="truncate text-[10px] text-muted-foreground">{t}</p></div>
                <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-medium", c)}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: "sequences", label: "Sequences", icon: Layers, title: "Write once. Personalize for thousands.", body: "Build multi-step sequences with day delays, {{variables}} from any CSV column, {Hi|Hey} spintax and A/B subject tests that pick a winner on their own.", points: ["Unlimited steps & follow-ups", "Custom fields from any CSV column", "Auto-winner A/B subject lines"],
    mock: ["Step 1 · {Hi|Hey} {{first_name}}, quick idea for {{company}}", "Wait 3 days if no reply", "Step 2 · Re: same thread bump", "Wait 4 days", "Step 3 · Break-up email"] },
  { id: "rotation", label: "Inbox rotation", icon: Server, title: "Spread volume across every inbox you own.", body: "Connect Gmail, Outlook, Zoho or any SMTP server. OutreachForge rotates sends, respects per-inbox caps and keeps each lead on the same inbox for clean threading.", points: ["Per-inbox daily limits & warm-up ramp", "Random 10–15 min gaps between sends", "Auto-pause inboxes on SMTP errors"],
    mock: ["alex@getbrand.com · 38/50 today", "sam@trybrand.com · 27/40 today", "jo@brandhq.com · warm-up day 6 · 23/40", "next send in 11m 42s"] },
  { id: "inbox", label: "Master Inbox", icon: Inbox, title: "Every reply. One inbox. Zero tab-switching.", body: "IMAP sync pulls replies from all inboxes every minute, auto-labels them Interested, Meeting booked or Out of office, and lets you reply inline from the right sender.", points: ["Keyword auto-labelling", "Hot-lead desktop alerts", "Reply from the original inbox"],
    mock: ["🔥 Priya — Interested · 2m ago", "📅 Omar — Meeting booked · 14m ago", "Grace — Out of office · 1h ago", "Leo — Not interested · 3h ago"] },
  { id: "analytics", label: "Analytics", icon: BarChart3, title: "Know exactly which words book meetings.", body: "Unique opens, clicks, replies and bounces per campaign, per step and per A/B variant — with a live activity log of every single email that leaves your inboxes.", points: ["Step-level funnels", "Campaign leaderboard", "Live activity log"],
    mock: ["Open rate 51.3% ▲ 4.1", "Click rate 9.8% ▲ 1.2", "Reply rate 8.4% ▲ 2.0", "Bounce rate 0.9% ▼ 0.3"] },
];

const FAQ = [
  ["Do I need my own email inboxes?", "Yes. OutreachForge sends through the mailboxes you own (Google Workspace, Microsoft 365, Zoho or any SMTP server) using app passwords. That keeps your reputation in your hands — no shared IP pools."],
  ["How does open and click tracking work?", "Each email carries an invisible 1px image and links are routed through a redirect on your own domain. You can turn either off per campaign."],
  ["Will my emails land in spam?", "Deliverability depends on your domain setup (SPF, DKIM, DMARC) and copy. OutreachForge adds the guard-rails: warm-up ramps, random gaps, random daily starts, sending calendars, spintax and one-click unsubscribe headers."],
  ["How are replies detected?", "Every connected inbox is synced over IMAP about once a minute. Replies are matched to the original email by thread headers, the lead's sequence stops automatically and the reply lands in your Master Inbox."],
  ["Can I import my existing lead lists?", "Upload any CSV. Standard columns are mapped automatically and every extra column becomes a personalization variable such as {{city}} or {{pain_point}}."],
  ["Is there a limit on inboxes or seats?", "No. It's your platform — connect as many inboxes and run as many campaigns as your infrastructure allows."],
];

const COMPARE: [string, boolean | string, boolean | string, boolean | string][] = [
  ["Unlimited inboxes", true, true, true],
  ["Own your data & database", true, false, false],
  ["No per-seat / per-inbox fees", true, false, false],
  ["A/B subjects with auto-winner", true, true, true],
  ["Spintax + custom variables", true, true, true],
  ["Random gaps & daily start jitter", true, "Partial", "Partial"],
  ["Lead-timezone sending calendar", true, true, true],
  ["Master Inbox with auto-labels", true, "Add-on", true],
];

export default function Home() {
  const [tab, setTab] = useState(TABS[0].id);
  const [annual, setAnnual] = useState(true);
  const [faq, setFaq] = useState<number | null>(0);
  const active = TABS.find((t) => t.id === tab)!;
  const price = (m: number) => (annual ? Math.round(m * 0.8) : m);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5">
          <Logo />
          <nav className="hidden items-center md:flex">
            <NavMenu label="Product" items={PRODUCT_MENU} id="product" />
            <NavMenu label="Resources" items={RESOURCES_MENU} id="resources" />
            <a href="#pricing" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground" data-testid="landing-nav-pricing">Pricing</a>
            <a href="#compare" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground" data-testid="landing-nav-compare">Compare</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link to="/login" className={buttonVariants({ variant: "ghost", size: "sm" })} data-testid="landing-login-link">Log in</Link>
            <Link to="/signup" className={buttonVariants({ size: "sm" })} data-testid="landing-signup-link">Get started</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 line-grid [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
        <div className="pointer-events-none absolute -top-48 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-blue-600/15 blur-[120px]" />
        <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-20 text-center lg:pt-28">
          <a href="#deliverability" className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-panel px-1.5 py-1 pr-3 text-xs text-muted-foreground transition-colors hover:text-foreground animate-fade-up" data-testid="hero-announcement">
            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-white">New</span>
            Random daily starts & sending gaps are live <ArrowRight className="size-3" />
          </a>
          <h1 className="mx-auto mt-7 max-w-4xl font-heading text-[44px] font-semibold leading-[1.02] sm:text-[68px] animate-fade-up" style={{ animationDelay: "60ms" }}>
            <span className="text-gradient">Cold email that lands,</span><br />
            <span className="bg-gradient-to-r from-blue-500 via-sky-400 to-emerald-400 bg-clip-text text-transparent">on infrastructure you own.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-muted-foreground animate-fade-up" style={{ animationDelay: "120ms" }}>
            OutreachForge runs personalized multi-step campaigns across all of your inboxes, protects deliverability with human-like pacing, and turns every reply into a pipeline — without per-seat pricing.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3 animate-fade-up" style={{ animationDelay: "180ms" }}>
            <Link to="/signup" className={cn(buttonVariants({ size: "lg" }), "h-11 px-6 text-[15px] shadow-lg shadow-blue-600/25")} data-testid="hero-get-started-button">Start sending free <ArrowRight className="size-4" /></Link>
            <Link to="/login" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-6 text-[15px]")} data-testid="hero-demo-button">Explore live demo</Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">No credit card · Connect your first inbox in under 2 minutes</p>
          <div className="relative mx-auto mt-14 max-w-5xl text-left animate-fade-up" style={{ animationDelay: "240ms" }}>
            <div className="absolute -inset-4 rounded-3xl bg-gradient-to-b from-blue-500/10 to-transparent blur-2xl" />
            <div className="relative"><ProductMock /></div>
          </div>
        </div>
      </section>

      {/* Logos */}
      <section className="border-y border-border bg-panel/50 py-10">
        <p className="text-center text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Trusted by 1,200+ outbound teams and agencies</p>
        <div className="relative mt-6 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]">
          <div className="flex w-max gap-14 animate-marquee">
            {[...Array(2)].flatMap((_, k) => ["Northwind", "Brightlane", "Quantive", "Stackwise", "Peakflow", "Orbitly", "Cobalt AI", "Helix", "Vantage", "Tidal"].map((n) => (
              <span key={`${k}-${n}`} className="font-heading text-xl font-semibold tracking-tight text-muted-foreground/70">{n}</span>
            )))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto grid max-w-7xl grid-cols-2 gap-px overflow-hidden px-5 py-20 lg:grid-cols-4">
        {[["38M+", "emails delivered"], ["51%", "average open rate"], ["8.4%", "average reply rate"], ["2 min", "to connect an inbox"]].map(([v, l]) => (
          <div key={l} className="border-l border-border px-6 py-2">
            <p className="font-heading text-4xl font-semibold tracking-tight text-foreground">{v}</p>
            <p className="mt-1 text-sm text-muted-foreground">{l}</p>
          </div>
        ))}
      </section>

      {/* Product tabs */}
      <section id="product" className="border-t border-border py-24">
        <div className="mx-auto max-w-7xl px-5">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-primary">The platform</p>
            <h2 className="mt-2 font-heading text-[36px] font-semibold leading-tight">Everything between "new lead" and "meeting booked".</h2>
          </div>
          <div className="mt-10 flex flex-wrap gap-2" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} data-testid={`product-tab-${t.id}`}
                className={cn("flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors duration-150", tab === t.id ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                <t.icon className="size-4" />{t.label}
              </button>
            ))}
          </div>
          <div key={active.id} className="mt-8 grid items-center gap-10 rounded-2xl border border-border bg-panel p-6 sm:p-10 lg:grid-cols-2 animate-fade-up" data-testid="product-tab-panel">
            <div>
              <h3 className="font-heading text-2xl font-semibold">{active.title}</h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">{active.body}</p>
              <ul className="mt-6 space-y-2.5">
                {active.points.map((p) => <li key={p} className="flex items-center gap-2.5 text-sm"><span className="grid size-5 place-items-center rounded-full bg-emerald-500/15"><Check className="size-3 text-emerald-300" /></span>{p}</li>)}
              </ul>
            </div>
            <div className="space-y-2 rounded-xl border border-border bg-background p-4">
              {active.mock.map((m, i) => (
                <div key={m} className={cn("rounded-lg border border-border px-4 py-3 font-mono text-[12.5px] animate-fade-up", i % 2 === 1 && active.id === "sequences" ? "ml-6 border-dashed text-muted-foreground" : "bg-panel text-foreground/90")} style={{ animationDelay: `${i * 70}ms` }}>{m}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Deliverability bento */}
      <section id="deliverability" className="border-t border-border bg-panel/40 py-24">
        <div className="mx-auto max-w-7xl px-5">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="text-sm font-medium text-primary">Deliverability</p>
              <h2 className="mt-2 font-heading text-[36px] font-semibold leading-tight">Send like a human. Land like one too.</h2>
              <p className="mt-4 text-muted-foreground">Spam filters look for patterns. OutreachForge removes them — every inbox gets its own rhythm, every email reads a little differently.</p>
              <Link to="/signup" className={cn(buttonVariants({ variant: "outline" }), "mt-6")} data-testid="deliverability-cta">Protect my domains <ArrowRight className="size-4" /></Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:col-span-8">
              {[
                { icon: Flame, t: "Warm-up ramp", b: "New inboxes start at 5/day and climb automatically to their full limit." },
                { icon: Timer, t: "Random sending gaps", b: "10–15 minutes (or your range) between every email from each inbox." },
                { icon: Shuffle, t: "Random daily start", b: "Each inbox starts at a different minute every day — no robotic 9:00:00." },
                { icon: CalendarClock, t: "Sending calendar", b: "Weekdays only, business hours, in each lead's own timezone." },
                { icon: Sparkles, t: "Spintax & A/B", b: "{Hi|Hey|Hello} variations and subject tests so no two sends match." },
                { icon: MailCheck, t: "One-click unsubscribe", b: "RFC 8058 List-Unsubscribe headers that Gmail & Yahoo require." },
              ].map((f) => (
                <div key={f.t} className="group rounded-xl border border-border bg-panel p-5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/30">
                  <f.icon className="size-5 text-primary" />
                  <h3 className="mt-4 font-semibold">{f.t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.b}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border py-24">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className="font-heading text-[36px] font-semibold">Live in an afternoon.</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-4">
            {[[Server, "Connect inboxes", "Add SMTP + IMAP app passwords and test each connection."], [Globe2, "Import leads", "Drop a CSV. Columns map themselves, extras become variables."],
              [Layers, "Write the sequence", "Steps, delays, spintax and A/B subjects with live preview."], [Zap, "Launch & reply", "The engine paces sends; replies land in your Master Inbox."]].map(([I, t, b], i) => {
              const Icon = I as typeof Server;
              return (
                <li key={t as string} className="relative rounded-xl border border-border bg-panel p-6">
                  <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                  <Icon className="mt-4 size-5 text-primary" />
                  <h3 className="mt-3 font-semibold">{t as string}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{b as string}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Compare */}
      <section id="compare" className="border-t border-border bg-panel/40 py-24">
        <div className="mx-auto max-w-5xl px-5">
          <p className="text-center text-sm font-medium text-primary">Compare</p>
          <h2 className="mt-2 text-center font-heading text-[36px] font-semibold">The features you pay for elsewhere — owned.</h2>
          <div className="mt-10 overflow-x-auto rounded-xl border border-border bg-panel">
            <table className="w-full min-w-[620px] text-sm" data-testid="compare-table">
              <thead><tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-5 py-4 font-medium">Feature</th>
                <th className="px-5 py-4 text-center font-semibold text-foreground"><span className="rounded-full bg-primary/10 px-3 py-1 text-primary">OutreachForge</span></th>
                <th className="px-5 py-4 text-center font-medium">Instantly</th><th className="px-5 py-4 text-center font-medium">Smartlead</th>
              </tr></thead>
              <tbody>
                {COMPARE.map(([f, ...vals]) => (
                  <tr key={f} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-3.5 text-foreground/90">{f}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={cn("px-5 py-3.5 text-center", i === 0 && "bg-primary/[0.04]")}>
                        {v === true ? <Check className="mx-auto size-4 text-emerald-300" /> : v === false ? <Minus className="mx-auto size-4 text-muted-foreground/60" /> : <span className="text-xs text-muted-foreground">{v}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border py-24">
        <div className="mx-auto max-w-7xl px-5">
          <div className="flex flex-col items-center text-center">
            <p className="text-sm font-medium text-primary">Pricing</p>
            <h2 className="mt-2 font-heading text-[36px] font-semibold">Flat pricing. Unlimited inboxes.</h2>
            <div className="mt-6 inline-flex rounded-full border border-border bg-panel p-1" data-testid="pricing-toggle">
              {[false, true].map((a) => (
                <button key={String(a)} type="button" onClick={() => setAnnual(a)} className={cn("rounded-full px-4 py-1.5 text-sm transition-colors", annual === a ? "bg-secondary font-medium text-foreground" : "text-muted-foreground")} data-testid={`pricing-${a ? "annual" : "monthly"}`}>
                  {a ? "Annual · save 20%" : "Monthly"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {[
              { n: "Starter", p: 37, d: "For founders doing their own outbound.", f: ["5,000 emails / month", "Unlimited inboxes", "Master Inbox", "Open & click tracking"] },
              { n: "Growth", p: 97, d: "For sales teams scaling pipeline.", f: ["100,000 emails / month", "A/B tests & spintax", "Hot-lead alerts", "Sending calendar & timezones", "Priority support"], hot: true },
              { n: "Agency", p: 297, d: "For agencies running many clients.", f: ["500,000 emails / month", "Unlimited workspaces", "Activity log & exports", "Dedicated success manager"] },
            ].map((t) => (
              <div key={t.n} className={cn("relative flex flex-col rounded-2xl border p-7", t.hot ? "border-primary/50 bg-gradient-to-b from-primary/[0.08] to-panel shadow-xl shadow-blue-600/10" : "border-border bg-panel")} data-testid={`pricing-card-${t.n.toLowerCase()}`}>
                {t.hot && <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-white">Most popular</span>}
                <h3 className="font-semibold">{t.n}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t.d}</p>
                <p className="mt-6"><span className="font-heading text-5xl font-semibold tracking-tight">${price(t.p)}</span><span className="text-sm text-muted-foreground"> / month</span></p>
                <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                  {t.f.map((x) => <li key={x} className="flex items-center gap-2.5"><Check className="size-4 text-emerald-300" />{x}</li>)}
                </ul>
                <Link to="/signup" className={cn(buttonVariants({ variant: t.hot ? "default" : "outline" }), "mt-8 w-full")} data-testid={`pricing-cta-${t.n.toLowerCase()}`}>Start with {t.n}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-t border-border bg-panel/40 py-24">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className="max-w-xl font-heading text-[36px] font-semibold leading-tight">Teams that switched never looked back.</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { q: "We moved 14 inboxes over in an afternoon. Handling replies from one Master Inbox saves my SDRs an hour a day.", n: "Arjun Mehta", r: "Founder, Scalr B2B", img: "photo-1534399315465-2b91232de345" },
              { q: "The random gaps and warm-up ramp fixed our spam-folder problem in a week. Reply rate went from 3% to 9%.", n: "Sarah Klein", r: "Head of Growth, Peakflow", img: "photo-1494790108377-be9c29b29330" },
              { q: "Our agency runs 40 client campaigns on it. Owning the stack means our margins finally make sense.", n: "Marcus Lee", r: "CEO, Pipeline Labs", img: "photo-1507003211169-0a1dd7228f2d" },
            ].map((t) => (
              <figure key={t.n} className="flex flex-col rounded-xl border border-border bg-panel p-6">
                <div className="flex gap-0.5 text-amber-300">{"★★★★★"}</div>
                <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-foreground/90">"{t.q}"</blockquote>
                <figcaption className="mt-6 flex items-center gap-3">
                  <img src={`https://images.unsplash.com/${t.img}?crop=faces&fit=crop&w=96&h=96&q=70`} alt="" className="size-10 rounded-full object-cover" />
                  <div><p className="text-sm font-semibold">{t.n}</p><p className="text-xs text-muted-foreground">{t.r}</p></div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-border py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="text-sm font-medium text-primary">FAQ</p>
            <h2 className="mt-2 font-heading text-[36px] font-semibold leading-tight">Questions, answered.</h2>
            <p className="mt-4 text-muted-foreground">Can't find what you need? <a href="mailto:support@outreachforge.io" className="text-primary hover:underline">Email our team</a>.</p>
          </div>
          <div className="divide-y divide-border rounded-xl border border-border bg-panel lg:col-span-8" data-testid="faq-list">
            {FAQ.map(([q, a], i) => (
              <div key={q}>
                <button type="button" onClick={() => setFaq(faq === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-medium" data-testid={`faq-question-${i}`} aria-expanded={faq === i}>
                  {q}<ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300", faq === i && "rotate-180")} />
                </button>
                <div className="collapse-grid" data-open={faq === i}>
                  <div><p className="px-6 pb-5 text-sm leading-relaxed text-muted-foreground" data-testid={`faq-answer-${i}`}>{a}</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 pb-24">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-blue-600 to-sky-600 px-8 py-16 text-center text-white sm:px-16">
          <div className="pointer-events-none absolute inset-0 opacity-20 line-grid" />
          <h2 className="relative font-heading text-[40px] font-semibold leading-tight">Your next 50 meetings are one campaign away.</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-white/80">Connect an inbox, import a list and launch today. Cancel anytime — your data stays yours.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/signup" className={cn(buttonVariants({ size: "lg" }), "h-11 bg-white px-6 text-blue-700 hover:bg-white/90")} data-testid="cta-signup-button">Create free account</Link>
            <Link to="/login" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 border-white/40 bg-transparent px-6 text-white hover:bg-white/10")} data-testid="cta-demo-button">View demo</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-panel/40">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-5">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">The cold email platform for teams who want to own their outbound — inboxes, data and pipeline.</p>
            <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />All systems operational</p>
          </div>
          {[["Product", ["Sequences", "Inbox rotation", "Master Inbox", "Analytics", "Pricing"]], ["Resources", ["Setup guide", "Cold email playbook", "Deliverability checklist", "Changelog"]], ["Company", ["About", "Contact", "Privacy", "Terms"]]].map(([h, ls]) => (
            <div key={h as string}>
              <p className="text-sm font-semibold">{h as string}</p>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                {(ls as string[]).map((l) => <li key={l}><a href={l === "Pricing" ? "#pricing" : "#product"} className="transition-colors hover:text-foreground">{l}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-border py-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} OutreachForge. Send responsibly — always honor opt-outs.</div>
      </footer>
    </div>
  );
}
