import { useCallback, useEffect, useState, type FormEvent } from "react";
import clsx from "clsx";
import { Copy } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { modelFamily, type CallKind, type ModelMix } from "@/ai/models";
import { shortCount, type UsageSummary } from "@/ai/usage-shared";
import { engineDb, type EngineKind, type EngineTest, type EngineView } from "@/org/engine";
import { QalamAIGlyph } from "../brand";
import { Button, Segmented, Tip } from "../controls";
import { r } from "../recipes";
import { Sparkline, StatusDot } from "../viz";
import { refreshHealth } from "../frame/useHealth";

/*
 * The engine behind Qalam AI, on one card: which one is live and whether it's ready (a dot and a
 * word), whose account pays, a Test that makes a short real call, the switch between Claude Code on
 * this Mac and a Claude API key (tested before it's kept in the Keychain), which models its calls
 * run on (Balanced: Sonnet reads, Opus decides; Best: Opus for everything), and what Qalam AI used
 * this week, by model and by job. "Claude Code" names the engine; Qalam's own AI is Qalam AI.
 */

export const PLAN: Record<string, string> = { max: "Max", pro: "Pro", team: "Team", enterprise: "Enterprise" };
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** What each kind of call does, for the week's breakdown. */
const JOB: Record<CallKind | "other", string> = {
  extract: "Reading sources",
  topics: "Filing into topic pages",
  "setup-shape": "Shaping the organization",
  claims: "Checking outside numbers",
  reader: "Reading code",
  research: "Looking things up",
  synthesize: "Placing quotes on boards",
  draft: "Drafting trees",
  followups: "Board follow-ups",
  "dump-read": "Reading brain dumps",
  "dump-followup": "Reading answers",
  "dump-place": "Placing brain dumps",
  "setup-read": "Reading the setup dump",
  "setup-followup": "Reading setup answers",
  "setup-place": "Proposing the About and products",
  review: "Reviews",
  bearings: "Problems against goals",
  jobs: "Planning jobs",
  breakdown: "Breaking goals down",
  ask: "Ask",
  connector: "Connector calls",
  numbers: "Reading numbers",
  other: "Other calls",
};

/** "Sonnet reads, Opus decides", or "Opus for everything": what the tiers run on now. */
function mixLine(view: EngineView) {
  const [read, decide] = [modelFamily(view.tiers.read), modelFamily(view.tiers.decide)];
  return read === decide ? `${decide} for everything` : `${read} reads, ${decide} decides`;
}

export function EngineCard() {
  const [view, setView] = useState<EngineView | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<EngineTest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void engineDb.view().then(setView, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void engineDb.usage(7).then(setUsage, () => {});
  }, []);
  useEffect(load, [load]);

  const runTest = async (kind?: EngineKind) => {
    setTesting(true);
    setError(null);
    try {
      setTest(await engineDb.test(kind));
      load();
      void refreshHealth();
    } finally {
      setTesting(false);
    }
  };
  const choose = async (kind: EngineKind) => {
    if (!view || kind === view.kind) return;
    setTest(null);
    setView(await engineDb.choose(kind));
    void refreshHealth();
  };
  const chooseModels = async (models: ModelMix) => {
    if (!view || models === view.models) return;
    setError(null);
    try {
      setView(await engineDb.models(models));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!view) return <div className={clsx(r.skeleton, "h-[132px] rounded-lg")} aria-hidden />;
  const shown = test ?? view.test;
  const ready = shown ? shown.ok : view.ready;
  const word = shown && !shown.ok ? shown.word : view.ready ? "Ready" : view.word;
  const detail = shown && !shown.ok ? shown.detail : view.ready ? undefined : view.detail;
  const a = view.claude.account;

  return (
    <section aria-label="Qalam AI" className="flex flex-col gap-[14px] rounded-lg bg-panel p-[16px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-start gap-[12px]">
        <span className="grid size-[36px] shrink-0 place-items-center rounded-md bg-raised">
          <QalamAIGlyph size={18} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <p className="flex items-center gap-[8px] text-body font-medium text-fg">
            Qalam AI
            <span className="inline-flex items-center gap-[6px] text-caption font-normal text-fg-muted">
              <StatusDot tone={ready ? "ok" : "bad"} />
              {word}
              {shown?.ok && <span className="text-fg-subtle tnum">· {(shown.ms / 1000).toFixed(1)} s</span>}
            </span>
          </p>
          <p className="truncate text-caption text-fg-subtle">
            {view.kind === "cli"
              ? ["Claude Code on this Mac", a?.plan ? `${PLAN[a.plan] ?? a.plan} plan` : null, a?.email ?? null].filter(Boolean).join(" · ")
              : view.key
                ? `API key ending ${view.key.last4} · ${view.key.from === "keychain" ? "in the Keychain" : "from the environment"}`
                : "Claude API key"}
          </p>
          {detail && <p className="pt-[2px] text-caption text-fg-muted">{detail}</p>}
          {view.kind === "cli" && a?.apiKeySource && <p className="pt-[2px] text-caption text-warning">{a.apiKeySource} is set on this Mac. Qalam leaves it out, so your sign-in is what's used.</p>}
        </div>
        <div className="flex shrink-0 items-center gap-[6px]">
          {view.kind === "cli" && word === "Signed out" && <CopyCommand command="claude auth login" />}
          <Button variant="secondary" size="sm" disabled={testing} onClick={() => void runTest()}>
            {testing ? "Testing…" : "Test"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[12px]">
        <Segmented<EngineKind>
          label="Engine"
          value={view.kind}
          onChange={(k) => void choose(k)}
          className="w-[240px]"
          options={[
            { value: "cli", label: "Claude Code", title: "Your own Claude Code on this Mac, signed in with your Claude plan" },
            { value: "api", label: "API key", title: "A Claude API key from the Claude Console, kept in the Keychain" },
          ]}
        />
        {view.kind === "api" && <KeyField view={view} onSaved={(v) => (setView(v), setTest(null), void refreshHealth())} onError={setError} />}
      </div>

      <div className="flex flex-wrap items-center gap-[12px]">
        <Segmented<ModelMix>
          label="Models"
          value={view.models}
          onChange={(m) => void chooseModels(m)}
          className="w-[240px]"
          options={[
            { value: "balanced", label: "Balanced", title: "Sonnet reads sources and files them, Opus proposes and decides. Fewer tokens." },
            { value: "best", label: "Best", title: "Opus for everything Qalam AI does" },
          ]}
        />
        <span className="text-caption text-fg-subtle">{mixLine(view)}</span>
      </div>
      {error && <p className="text-caption text-danger">{error}</p>}

      {usage && <Usage u={usage} kind={view.kind} />}
    </section>
  );
}

/** A key typed in once: tested, then kept in the Keychain (never shown again, only its last four). */
export function KeyField({ view, onSaved, onError }: { view: EngineView; onSaved: (v: EngineView) => void; onError: (m: string | null) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  if (view.key && !key)
    return (
      <span className="flex items-center gap-[8px]">
        {view.key.from === "keychain" && (
          <button
            type="button"
            className={clsx(r.buttonSm, r.buttonGhost)}
            onClick={() =>
              void engineDb.forgetKey().then(
                (v) => onSaved(v),
                (e: unknown) => onError(e instanceof Error ? e.message : String(e)),
              )
            }
          >
            Remove the key
          </button>
        )}
      </span>
    );
  if (!view.canStore) return <span className="text-caption text-fg-subtle">Set ANTHROPIC_API_KEY where Qalam starts: this computer has no Keychain.</span>;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      onSaved(await engineDb.saveKey(key));
      setKey("");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void save(e)} className="flex min-w-[280px] flex-1 items-center gap-[8px]">
      <label className={clsx(r.field, "flex-1")}>
        <span className="sr-only">Claude API key</span>
        <input type="password" autoComplete="off" spellCheck={false} placeholder="Paste a Claude API key" value={key} onChange={(e) => setKey(e.target.value)} className={r.fieldInput} />
      </label>
      <Button type="submit" size="sm" disabled={busy || key.trim().length < 20}>
        {busy ? "Testing…" : "Test and keep"}
      </Button>
    </form>
  );
}

/** This week: calls a day, by model (and by job, on hover), tokens in and out, and the cost where the engine says. */
function Usage({ u, kind }: { u: UsageSummary; kind: EngineKind }) {
  const models = u.byModel.map((m, i) => `${m.model} ${i ? m.calls : plural(m.calls, "call")}`).join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[6px] border-t border-line-subtle pt-[12px]">
      <span className="text-micro font-medium text-fg-subtle">This week</span>
      <Sparkline values={u.days} width={84} height={20} label={`Calls each day, last 7 days: ${u.days.join(", ")}`} />
      {u.calls ? (
        <Tip
          label={
            <span className="flex flex-col gap-[2px] tnum">
              {u.byKind.slice(0, 12).map((k) => (
                <span key={`${k.kind} ${k.model}`}>
                  {JOB[k.kind]}: {k.model} {k.calls}
                </span>
              ))}
            </span>
          }
        >
          <span className="text-caption text-fg-muted tnum">{models}</span>
        </Tip>
      ) : (
        <span className="text-caption text-fg-muted">No calls yet</span>
      )}
      {u.calls > 0 && <span className="text-caption text-fg-subtle tnum">{`${shortCount(u.input)} in · ${shortCount(u.output)} out`}</span>}
      {u.cost !== null && (
        <Tip label={kind === "cli" ? "Claude Code's own estimate, at API prices. Your Claude plan covers these calls." : "As the calls reported it."}>
          <span className="text-caption text-fg-subtle tnum">≈ ${u.cost.toFixed(2)}</span>
        </Tip>
      )}
    </div>
  );
}

export function CopyCommand({ command }: { command: string }) {
  return (
    <Tip label="Run it in a terminal, then Test">
      <button
        type="button"
        className={clsx(r.buttonSm, r.buttonGhost, "font-mono")}
        onClick={() =>
          void navigator.clipboard.writeText(command).then(
            () => feedback(`Copied: ${command}`, { kind: "success", id: "connections.copy" }),
            () => feedback("Couldn't copy it", { kind: "error", id: "connections.copy" }),
          )
        }
      >
        <Copy size={12} absoluteStrokeWidth strokeWidth={1.25} />
        {command}
      </button>
    </Tip>
  );
}
