import { describe, expect, it } from "vitest";
import { fromClaudeUsage, fromCodexLimits, windowLabel, withClaudeEvent } from "./limits";

const NOW = Date.parse("2026-11-01T04:00:00Z");

/** Claude Code 2.1.284's `get_usage` answer on a Max plan (November 2026), trimmed of the fields not read. */
const MAX = {
  session: { total_cost_usd: 0 },
  subscription_type: "max",
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 13, resets_at: "2026-11-01T08:00:00.759664+00:00" },
    seven_day: { utilization: 32, resets_at: "2026-11-06T16:00:00.759682+00:00" },
    seven_day_opus: null,
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null, decimal_places: null, disabled_reason: null, user_disabled: false, spend_limit_reached: false },
    limits: [
      { kind: "session", group: "session", percent: 13, severity: "normal", resets_at: "2026-11-01T08:00:00.759664+00:00", scope: null, is_active: false },
      { kind: "weekly_all", group: "weekly", percent: 32, severity: "normal", resets_at: "2026-11-06T16:00:00.759682+00:00", scope: null, is_active: true },
      { kind: "weekly_scoped", group: "weekly", percent: 0, severity: "normal", resets_at: "2026-11-06T16:00:00+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null }, is_active: false },
    ],
    model_scoped: [{ display_name: "Fable", utilization: 0, resets_at: "2026-11-06T16:00:00+00:00" }],
  },
  behaviors: null,
};

/** A Team seat whose session is used up, its organization's usage credits off. */
const TEAM_FULL = {
  subscription_type: "team",
  rate_limits_available: true,
  rate_limits: {
    extra_usage: { is_enabled: false, disabled_reason: "org_level_disabled" },
    limits: [
      { kind: "session", group: "session", percent: 100, severity: "critical", resets_at: "2026-11-01T06:30:00Z" },
      { kind: "weekly_all", group: "weekly", percent: 71, severity: "warning", resets_at: "2026-11-04T09:00:00Z" },
    ],
  },
};

/** Codex 0.155's `account/rateLimits/read` answer on ChatGPT Free (November 2026). */
const FREE = {
  ordinaryUsageAllowed: true,
  rateLimits: { limitId: "codex", limitName: null, primary: { usedPercent: 2, windowDurationMins: 43200, resetsAt: 1795947470 }, secondary: null, credits: { hasCredits: false, unlimited: false, balance: null }, individualLimit: null, spendControlReached: false, planType: "free", rateLimitReachedType: null },
  rateLimitsByLimitId: { codex: { limitId: "codex", limitName: null, primary: { usedPercent: 2, windowDurationMins: 43200, resetsAt: 1795947470 }, secondary: null, credits: { hasCredits: false, unlimited: false, balance: null }, individualLimit: null, spendControlReached: false, planType: "free", rateLimitReachedType: null } },
  rateLimitResetCredits: { availableCount: 0, credits: null },
  accountId: "acct",
  rateLimitUpsell: null,
};

describe("a Claude plan's limits", () => {
  it("reads the server's rows: the session, the week, and a week for one model only once it's in use", () => {
    const l = fromClaudeUsage(MAX, NOW)!;
    expect(l).toMatchObject({ engine: "cli", plan: "Max", seat: false, manage: "https://claude.ai/settings/usage", at: NOW });
    expect(l.rows).toEqual([
      { label: "Session", percent: 13, resetsAt: Date.parse("2026-11-01T08:00:00.759Z"), tone: "normal" },
      { label: "Week", percent: 32, resetsAt: Date.parse("2026-11-06T16:00:00.759Z"), tone: "normal" },
    ]);
    expect(l.credits).toEqual({ label: "Usage credits", on: false, line: "Off" });
    expect(l.reached).toBeUndefined();
    const fable = { ...MAX, rate_limits: { ...MAX.rate_limits, limits: MAX.rate_limits.limits.map((r) => (r.scope ? { ...r, percent: 40 } : r)) } };
    expect(fromClaudeUsage(fable, NOW)!.rows.map((r) => r.label)).toEqual(["Session", "Week", "Week · Fable"]);
  });

  it("falls back on the named windows when the server sends no rows", () => {
    const { limits: _rows, ...named } = MAX.rate_limits;
    const l = fromClaudeUsage({ ...MAX, rate_limits: { ...named, seven_day_opus: { utilization: 85, resets_at: "2026-11-06T16:00:00Z" } } }, NOW)!;
    expect(l.rows.map((r) => [r.label, r.percent, r.tone])).toEqual([
      ["Session", 13, "normal"],
      ["Week", 32, "normal"],
      ["Week · Opus", 85, "warning"],
    ]);
  });

  it("says when a seat's limit stops calls, until when, and that its admin decides on usage credits", () => {
    const l = fromClaudeUsage(TEAM_FULL, NOW)!;
    expect(l).toMatchObject({ plan: "Team", seat: true });
    expect(l.rows.map((r) => r.tone)).toEqual(["critical", "warning"]);
    expect(l.credits).toEqual({ label: "Usage credits", on: false, line: "Turned off by your organization: ask your admin" });
    expect(l.reached).toEqual({ until: Date.parse("2026-11-01T06:30:00Z"), why: "This session's limit is reached" });
    // Past its reset, it doesn't stop anything.
    expect(fromClaudeUsage(TEAM_FULL, Date.parse("2026-11-01T07:00:00Z"))!.reached).toBeUndefined();
  });

  it("counts usage credits in money, and a limit they cover doesn't stop calls", () => {
    const on = { ...TEAM_FULL, rate_limits: { ...TEAM_FULL.rate_limits, extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1240, currency: "USD" } } };
    const l = fromClaudeUsage(on, NOW)!;
    expect(l.credits).toEqual({ label: "Usage credits", on: true, line: "$12.40 of $50 this month" });
    expect(l.reached).toBeUndefined();
    const capped = { ...on, rate_limits: { ...on.rate_limits, extra_usage: { is_enabled: true, spend_limit_reached: true } } };
    expect(fromClaudeUsage(capped, NOW)!.credits).toEqual({ label: "Usage credits", on: false, line: "This month's cap is reached: ask your admin" });
    expect(fromClaudeUsage(capped, NOW)!.reached).toBeDefined();
  });

  it("is nothing for a sign-in with no plan limits, or an answer it can't read", () => {
    expect(fromClaudeUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null }, NOW)).toBeNull();
    expect(fromClaudeUsage(null, NOW)).toBeNull();
    expect(fromClaudeUsage("Usage unavailable", NOW)).toBeNull();
    expect(fromClaudeUsage({ rate_limits: { limits: [{ kind: "session", percent: "lots" }] } }, NOW)!.rows).toEqual([]);
  });

  it("takes a call's rate-limit line: a stop until its reset, a team's shared budget, and the windows when nothing else said", () => {
    const base = fromClaudeUsage(MAX, NOW)!;
    const reset = Math.floor(Date.parse("2026-11-01T08:00:00Z") / 1000);
    expect(withClaudeEvent(base, { status: "allowed", resetsAt: reset, utilization: 0.13 }, NOW)).toEqual(base);
    expect(withClaudeEvent(base, { status: "rejected", rateLimitType: "five_hour", resetsAt: reset }, NOW)!.reached).toEqual({ until: reset * 1000, why: "This session's limit is reached" });
    expect(withClaudeEvent(base, { status: "rejected", rateLimitType: "seven_day", resetsAt: reset }, NOW)!.reached!.why).toBe("This week's limit is reached");
    // Usage credits that cover it: nothing stops.
    expect(withClaudeEvent(base, { status: "rejected", resetsAt: reset, overageStatus: "allowed", isUsingOverage: true }, NOW)!.reached).toBeUndefined();
    // A line from before the reset says nothing now.
    expect(withClaudeEvent(base, { status: "rejected", resetsAt: reset }, reset * 1000 + 1)!.reached).toBeUndefined();
    const team = withClaudeEvent(fromClaudeUsage({ ...TEAM_FULL, rate_limits: { limits: [] } }, NOW), { status: "rejected", limitScope: "group_pool", overageDisabledReason: "member_level_disabled", resetsAt: reset }, NOW)!;
    expect(team.reached!.why).toBe("Your team's shared budget is used up");
    expect(team.credits).toEqual({ label: "Usage credits", on: false, line: "Turned off for your account: ask your admin" });
    const alone = withClaudeEvent(null, { status: "allowed_warning", unifiedWindows: { five_hour: { utilization: 0.82, resetsAt: reset }, seven_day: { utilization: 0.4, resetsAt: reset + 86_400 } } }, NOW)!;
    expect(alone.rows).toEqual([
      { label: "Session", percent: 82, resetsAt: reset * 1000, tone: "warning" },
      { label: "Week", percent: 40, resetsAt: (reset + 86_400) * 1000, tone: "normal" },
    ]);
    expect(withClaudeEvent(null, { status: "allowed" }, NOW)).toBeNull();
    expect(withClaudeEvent(base, "nonsense", NOW)).toBe(base);
  });
});

describe("a ChatGPT plan's Codex limits", () => {
  it("reads each window by its length, the plan and its credits", () => {
    const l = fromCodexLimits(FREE, NOW)!;
    expect(l).toMatchObject({ engine: "codex", plan: "Free", seat: false, manage: "https://chatgpt.com/codex/settings/usage", at: NOW });
    expect(l.rows).toEqual([{ label: "30 days", percent: 2, resetsAt: 1795947470_000, tone: "normal" }]);
    expect(l.credits).toBeUndefined();
    expect(l.reached).toBeUndefined();
  });

  it("names windows as people do", () => {
    expect(windowLabel(300)).toBe("5 hours");
    expect(windowLabel(10_080)).toBe("Week");
    expect(windowLabel(1440)).toBe("Day");
    expect(windowLabel(43_200)).toBe("30 days");
    expect(windowLabel(90)).toBe("90 minutes");
    expect(windowLabel(undefined)).toBe("Limit");
  });

  it("says when a workspace's member hits the cap its owner set, and what to do", () => {
    const snap = {
      limitId: "codex",
      primary: { usedPercent: 64, windowDurationMins: 300, resetsAt: 1793520000 },
      secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1793900000 },
      credits: { hasCredits: false, unlimited: false, balance: null },
      individualLimit: { limit: "500", used: "500", remainingPercent: 0, resetsAt: 1794000000 },
      spendControlReached: true,
      planType: "business",
      rateLimitReachedType: "workspace_member_usage_limit_reached",
    };
    const l = fromCodexLimits({ ordinaryUsageAllowed: false, rateLimits: snap, rateLimitsByLimitId: { codex: snap } }, NOW)!;
    expect(l).toMatchObject({ plan: "Business", seat: true });
    expect(l.rows.map((r) => [r.label, r.percent, r.tone])).toEqual([
      ["5 hours", 64, "normal"],
      ["Week", 100, "critical"],
      ["Spend cap", 100, "critical"],
    ]);
    expect(l.reached).toEqual({ until: 1794000000_000, why: "You hit the spend cap your workspace's owner set: ask an owner to raise it" });
  });

  it("goes on with credits past the plan's windows, and names each bucket when there are several", () => {
    const codex = { limitId: "codex", limitName: "GPT-5.5", primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1793520000 }, secondary: null, credits: { hasCredits: true, unlimited: false, balance: "120" }, planType: "plus" };
    const mini = { limitId: "codex_mini", limitName: "GPT-5.5 Mini", primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1793520000 }, secondary: null, planType: "plus" };
    const l = fromCodexLimits({ ordinaryUsageAllowed: false, rateLimits: codex, rateLimitsByLimitId: { codex, codex_mini: mini } }, NOW)!;
    expect(l.rows.map((r) => r.label)).toEqual(["5 hours · GPT-5.5", "5 hours · GPT-5.5 Mini"]);
    expect(l.credits).toEqual({ label: "Credits", on: true, line: "120 left" });
    expect(l.reached).toBeUndefined();
    expect(fromCodexLimits({ rateLimits: { ...codex, credits: { hasCredits: false } } }, NOW)!.reached).toEqual({ until: 1793520000_000, why: "Your plan's usage limit is reached" });
  });

  it("is nothing for an answer it can't read", () => {
    expect(fromCodexLimits(null, NOW)).toBeNull();
    expect(fromCodexLimits({ error: "unauthorized" }, NOW)).toBeNull();
  });
});
