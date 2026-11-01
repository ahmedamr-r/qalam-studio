/*
 * The plan limits of the engine Qalam AI runs on (pure, browser-safe), read into one shape in
 * people's words: a Claude plan's (Pro, Max, Team, Enterprise) session and weekly windows and its
 * usage credits, from Claude Code's `get_usage` answer and each call's rate-limit line; a ChatGPT
 * plan's Codex windows, credits and workspace caps, from Codex's app server. On a team's or a
 * company's plan each person has a seat with limits of its own, and each teammate's Qalam runs on
 * their own sign-in, so these are always this person's; what an admin decides (usage credits
 * turned off, a spend cap) is said as theirs to change. server/limits.ts asks; a key or a model on
 * this computer has no plan, so no limits. The answers are read field by field: Claude Code marks
 * `get_usage` as experimental, so a shape it doesn't know reads as nothing rather than wrong.
 */

export type LimitTone = "normal" | "warning" | "critical";

export interface LimitRow {
  /** What it counts: "Session", "Week", "Week · Opus", "5 hours", "30 days". */
  label: string;
  /** How much of it is used, 0–100 (past 100 when use ran over). */
  percent: number;
  /** When it starts over, in ms. */
  resetsAt?: number;
  tone: LimitTone;
}

export interface PlanLimits {
  engine: "cli" | "codex";
  /** The plan, in a word: "Max", "Team", "Plus", "Business". */
  plan?: string;
  /** A seat on a team's or a company's plan: the limits are this person's, an admin decides the rest. */
  seat: boolean;
  rows: LimitRow[];
  /** What carries calls past the plan's limits: Claude's usage credits, Codex's credits. */
  credits?: { label: string; on: boolean; line: string };
  /** The plan stops Qalam AI's calls now: until when (ms), and why, in words. */
  reached?: { until?: number; why: string };
  /** Where the person sees their usage, or gets more. */
  manage: string;
  /** When the engine said so. */
  at: number;
}

const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const str = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const obj = (x: unknown): Record<string, unknown> | undefined => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined);

/** A time as an ISO string, or seconds (or ms) since 1970, in ms. */
function time(x: unknown): number | undefined {
  const s = str(x);
  if (s) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? undefined : t;
  }
  const n = num(x);
  return n === undefined ? undefined : n < 1e12 ? n * 1000 : n;
}

/** The engine's own reading of a window (Claude's server says), else by how full it is. */
const toneOf = (severity: unknown, percent: number): LimitTone =>
  severity === "normal" || severity === "warning" || severity === "critical" ? severity : percent >= 100 ? "critical" : percent >= 80 ? "warning" : "normal";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const words = (id: string) => capital(id.replace(/[_-]+/g, " ").trim());

/** The latest reset among the windows used up, if any is (calls go on only once each has started over). */
function usedUp(rows: LimitRow[], now: number): { until?: number } | null {
  const full = rows.filter((r) => r.percent >= 100 && (r.resetsAt === undefined || r.resetsAt > now));
  if (!full.length) return null;
  const until = Math.max(...full.map((r) => r.resetsAt ?? 0));
  return until ? { until } : {};
}

// ---------------------------------------------------------------------------
// Claude Code

/** Claude's plans with seats an admin manages. */
const CLAUDE_SEATS = new Set(["team", "enterprise"]);
const CLAUDE_PLAN: Record<string, string> = { free: "Free", pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise" };
export const CLAUDE_USAGE_PAGE = "https://claude.ai/settings/usage";

/** A window's name: the 5-hour session, the week (all models), a week for one model or surface. */
function claudeLabel(kind: string | undefined, group: string | undefined, scope: string | undefined): string {
  const base = kind === "session" || group === "session" ? "Session" : kind?.startsWith("weekly") || group === "weekly" ? "Week" : words(group ?? kind ?? "limit");
  return scope ? `${base} · ${scope}` : base;
}

/**
 * Why usage credits don't carry calls past the plan's limits, in Claude Code's own terms. On a
 * seat, an admin decides; on a plan of one's own, the person does on claude.ai.
 */
const CREDITS_OFF: Record<string, string> = {
  out_of_credits: "None left",
  org_level_disabled: "Turned off by your organization",
  org_service_level_disabled: "Turned off by your organization",
  org_level_disabled_until: "Your organization's cap is reached for now",
  org_spend_cap_reached: "Your organization's cap is reached for now",
  member_level_disabled: "Turned off for your account",
  seat_tier_level_disabled: "Not available for your seat",
  seat_tier_zero_credit_limit: "Not available for your seat",
  member_zero_credit_limit: "Not available for your account",
  group_zero_credit_limit: "Not available for your group",
};

function creditsOff(reason: string | undefined, seat: boolean, userOff = false): string {
  const why = reason ? CREDITS_OFF[reason] : undefined;
  if (why) return seat ? `${why}: ask your admin` : why;
  return userOff ? "Off: you turned them off" : "Off";
}

/** An amount in a currency's minor units (cents), as people write it. */
function money(minor: number, currency: string, places: number): string {
  const amount = minor / 10 ** places;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Claude Code's `get_usage` answer: the plan, its windows (the server's rows, else the named
 * windows), and its usage credits. Null when it has no plan limits (signed in with a key, Bedrock or
 * Vertex) or says nothing readable.
 */
export function fromClaudeUsage(answer: unknown, now = Date.now()): PlanLimits | null {
  const a = obj(answer);
  const rl = obj(a?.rate_limits);
  if (!a || !rl || a.rate_limits_available === false) return null;
  const sub = str(a.subscription_type)?.toLowerCase();
  const seat = !!sub && CLAUDE_SEATS.has(sub);
  const rows: LimitRow[] = [];
  if (Array.isArray(rl.limits)) {
    for (const r of rl.limits) {
      const o = obj(r);
      const percent = num(o?.percent);
      if (!o || percent === undefined) continue;
      const sc = obj(o.scope);
      const scope = str(obj(sc?.model)?.display_name) ?? str(obj(sc?.surface)?.display_name);
      // A window for one model or surface shows once it's in use.
      if (scope && percent <= 0) continue;
      rows.push({ label: claudeLabel(str(o.kind), str(o.group), scope), percent, resetsAt: time(o.resets_at), tone: toneOf(o.severity, percent) });
    }
  } else {
    const named: [string, string, boolean][] = [["five_hour", "Session", true], ["seven_day", "Week", true], ["seven_day_opus", "Week · Opus", false], ["seven_day_sonnet", "Week · Sonnet", false]];
    for (const [key, label, always] of named) {
      const w = obj(rl[key]);
      const percent = num(w?.utilization);
      if (percent !== undefined && (always || percent > 0)) rows.push({ label, percent, resetsAt: time(w?.resets_at), tone: toneOf(undefined, percent) });
    }
    for (const m of Array.isArray(rl.model_scoped) ? rl.model_scoped : []) {
      const o = obj(m);
      const percent = num(o?.utilization);
      const name = str(o?.display_name);
      if (name && percent !== undefined && percent > 0) rows.push({ label: `Week · ${name}`, percent, resetsAt: time(o?.resets_at), tone: toneOf(undefined, percent) });
    }
  }
  const out: PlanLimits = { engine: "cli", ...(sub && CLAUDE_PLAN[sub] ? { plan: CLAUDE_PLAN[sub] } : {}), seat, rows, manage: CLAUDE_USAGE_PAGE, at: now };
  const x = obj(rl.extra_usage);
  if (x) {
    const places = num(x.decimal_places) ?? 2;
    const currency = str(x.currency) ?? "USD";
    const used = num(x.used_credits);
    const cap = num(x.monthly_limit);
    if (x.is_enabled !== true) out.credits = { label: "Usage credits", on: false, line: creditsOff(str(x.disabled_reason), seat, x.user_disabled === true) };
    else if (x.spend_limit_reached === true) out.credits = { label: "Usage credits", on: false, line: seat ? "This month's cap is reached: ask your admin" : "This month's cap is reached" };
    else
      out.credits = {
        label: "Usage credits",
        on: true,
        line: used !== undefined && cap !== undefined ? `${money(used, currency, places)} of ${money(cap, currency, places)} this month` : used !== undefined ? `On · ${money(used, currency, places)} this month` : "On",
      };
  }
  const full = out.credits?.on ? null : usedUp(rows, now);
  if (full) out.reached = { ...full, why: rows.some((r) => r.percent >= 100 && r.label.startsWith("Week")) ? "This week's limit is reached" : "This session's limit is reached" };
  return out;
}

/** The windows a call's rate-limit line names (fractions of each window), for when `get_usage` said nothing. */
const EVENT_WINDOWS: [string, string][] = [["five_hour", "Session"], ["seven_day", "Week"]];

/**
 * What the last call's rate-limit line adds (Claude Code's `rate_limit_event`): whether the plan
 * stops calls now, until when, and why (a team's shared budget used up, usage credits off), and
 * the windows when there's nothing else. Lines whose limit has started over since say nothing.
 */
export function withClaudeEvent(limits: PlanLimits | null, info: unknown, now = Date.now()): PlanLimits | null {
  const e = obj(info);
  if (!e) return limits;
  const out: PlanLimits = limits ? { ...limits, rows: [...limits.rows] } : { engine: "cli", seat: false, rows: [], manage: CLAUDE_USAGE_PAGE, at: now };
  if (!limits) {
    const w = obj(e.unifiedWindows);
    for (const [key, label] of EVENT_WINDOWS) {
      const win = obj(w?.[key]);
      const used = num(win?.utilization);
      if (used !== undefined) out.rows.push({ label, percent: Math.round(used * 100), resetsAt: time(win?.resetsAt), tone: toneOf(undefined, used * 100) });
    }
  }
  const until = time(e.resetsAt);
  const covered = e.overageStatus === "allowed" || e.overageStatus === "allowed_warning";
  if (e.status === "rejected" && !covered && (until === undefined || until > now)) {
    const scope = str(e.limitScope) ?? str(e.overageScope);
    const type = str(e.rateLimitType);
    const why =
      scope === "group_pool" ? "Your team's shared budget is used up"
      : type === "overage" ? "Your usage credits' cap is reached"
      : type?.startsWith("seven_day") ? "This week's limit is reached"
      : "This session's limit is reached";
    out.reached = { ...(until ? { until } : {}), why };
    const reason = str(e.overageDisabledReason);
    if (reason && out.credits?.on !== true) out.credits = { label: "Usage credits", on: false, line: creditsOff(reason, out.seat) };
  }
  if ((e.isUsingOverage === true || e.overageInUse === true) && out.credits) out.credits = { ...out.credits, on: true, line: `In use · ${out.credits.line}` };
  return out.rows.length || out.reached ? out : limits;
}

// ---------------------------------------------------------------------------
// Codex

/** ChatGPT's plans, in a word, and the ones with seats a workspace's owner manages. */
const CHATGPT_PLAN: Record<string, string> = { free: "Free", go: "Go", plus: "Plus", pro: "Pro", prolite: "Pro Lite", team: "Business", business: "Business", edu: "Edu", edu_plus: "Edu", edu_pro: "Edu" };
const chatgptPlan = (t: string) => CHATGPT_PLAN[t] ?? (/business/.test(t) ? "Business" : /^ent|enterprise/.test(t) ? "Enterprise" : undefined);
const chatgptSeat = (t: string) => /^(team|business|edu)/.test(t) || /business|enterprise|^ent/.test(t);
export const CODEX_USAGE_PAGE = "https://chatgpt.com/codex/settings/usage";

/** A window by its length: "5 hours", "Week", "30 days". */
export function windowLabel(mins: number | undefined): string {
  if (!mins) return "Limit";
  if (mins % 10_080 === 0) return mins === 10_080 ? "Week" : `${mins / 10_080} weeks`;
  if (mins % 1440 === 0) return mins === 1440 ? "Day" : `${mins / 1440} days`;
  if (mins % 60 === 0) return mins === 60 ? "Hour" : `${mins / 60} hours`;
  return `${mins} minutes`;
}

/** Why Codex stops, in Codex's own terms. */
const CODEX_REACHED: Record<string, string> = {
  rate_limit_reached: "Your plan's usage limit is reached",
  workspace_owner_credits_depleted: "Your workspace is out of credits: add more in its settings",
  workspace_member_credits_depleted: "Your workspace is out of credits: ask its owner for more",
  workspace_owner_usage_limit_reached: "You hit your workspace's spend cap: raise it in its settings",
  workspace_member_usage_limit_reached: "You hit the spend cap your workspace's owner set: ask an owner to raise it",
};

/**
 * Codex's `account/rateLimits/read` answer: each bucket's windows (its 5-hour and weekly ones on a
 * paid plan, one 30-day window on Free), the spend cap a workspace's owner set for this person,
 * credits, and whether Codex stops now and why. Null when it says nothing readable.
 */
export function fromCodexLimits(answer: unknown, now = Date.now()): PlanLimits | null {
  const a = obj(answer);
  const snap = obj(a?.rateLimits);
  if (!a || !snap) return null;
  const byId = obj(a.rateLimitsByLimitId);
  const buckets = (byId ? Object.values(byId).map(obj) : [snap]).filter((b): b is Record<string, unknown> => !!b);
  const type = str(snap.planType)?.toLowerCase();
  const seat = !!type && chatgptSeat(type);
  const rows: LimitRow[] = [];
  for (const b of buckets) {
    const name = buckets.length > 1 ? str(b.limitName) : undefined;
    for (const key of ["primary", "secondary"]) {
      const w = obj(b[key]);
      const percent = num(w?.usedPercent);
      if (percent === undefined) continue;
      const label = windowLabel(num(w?.windowDurationMins));
      rows.push({ label: name ? `${label} · ${name}` : label, percent, resetsAt: time(w?.resetsAt), tone: toneOf(undefined, percent) });
    }
  }
  const cap = obj(snap.individualLimit);
  const left = num(cap?.remainingPercent);
  if (left !== undefined) rows.push({ label: "Spend cap", percent: Math.max(0, 100 - left), resetsAt: time(cap?.resetsAt), tone: toneOf(undefined, 100 - left) });
  const out: PlanLimits = { engine: "codex", ...(type && chatgptPlan(type) ? { plan: chatgptPlan(type) } : {}), seat, rows, manage: CODEX_USAGE_PAGE, at: now };
  const c = obj(snap.credits);
  if (c?.unlimited === true) out.credits = { label: "Credits", on: true, line: "Unlimited" };
  else if (c?.hasCredits === true) out.credits = { label: "Credits", on: true, line: str(c.balance) ? `${str(c.balance)} left` : "On" };
  const reachedType = str(snap.rateLimitReachedType);
  const full = usedUp(rows, now);
  // Credits carry calls past the plan's windows; a workspace's cap or empty credits stop them anyway.
  if (reachedType || snap.spendControlReached === true || ((a.ordinaryUsageAllowed === false || full) && !out.credits?.on)) {
    const why = (reachedType && CODEX_REACHED[reachedType]) ?? (snap.spendControlReached === true ? (seat ? "You hit your workspace's spend cap: ask an owner to raise it" : "You hit your spend cap") : "Your plan's usage limit is reached");
    // Calls go on again once the window that's used up starts over; with none used up, Codex doesn't say when.
    out.reached = { ...(full?.until ? { until: full.until } : {}), why };
  }
  return out;
}
