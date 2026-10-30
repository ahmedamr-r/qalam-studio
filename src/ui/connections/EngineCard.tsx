import { useCallback, useEffect, useState, type FormEvent } from "react";
import clsx from "clsx";
import { Copy } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { modelFamily, type CallKind, type ModelMix, type Tier } from "@/ai/models";
import { shortCount, type UsageSummary } from "@/ai/usage-shared";
import { engineDb, type EngineKind, type EngineOption, type EngineTest, type EngineView } from "@/org/engine";
import { ENGINE_LABEL, isKeyed, isLocal, type KeyedKind } from "@/ai/engine-kinds";
import { QalamAIGlyph } from "../brand";
import { Button, Segmented, Select, Tip } from "../controls";
import { r } from "../recipes";
import { Sparkline, StatusDot } from "../viz";
import { refreshHealth } from "../frame/useHealth";

/*
 * The engine behind Qalam AI, on one card: which one is live and whether it's ready (a dot and a
 * word), whose account pays, a Test that makes a short real call, which engine (Claude Code on this
 * computer, a model on this computer through Ollama or LM Studio, or a key for Claude, OpenAI,
 * Gemini or OpenRouter, tested before it's kept in the Keychain), which models its calls run on
 * (Claude: Balanced or Best; any other: the models picked from its own list), and what Qalam AI used
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
  "seen-read": "Reading screenshots",
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
  solutions: "Drafting solutions",
  tests: "Drafting tests",
  breakdown: "Breaking goals down",
  ask: "Ask",
  steps: "Placing quotes at funnel steps",
  "seen-place": "Placing screens in flows",
  connector: "Connector calls",
  numbers: "Reading numbers",
  other: "Other calls",
};

/** "Sonnet reads, Opus decides", or "Opus, and Sonnet where it measured as good": what the mix runs on now. */
function mixLine(view: EngineView) {
  const [read, decide] = [modelFamily(view.tiers.read), modelFamily(view.tiers.decide)];
  if (read === decide) return `${decide} for everything`;
  return view.models === "balanced" ? `${read} reads, ${decide} decides` : `${decide}, and ${read} where it measured as good`;
}

/** How an engine stands, after its name in the picker. */
const STATE_WORD: Record<EngineOption["state"], string | null> = { ready: null, "no-key": "no key yet", "pick-model": "pick a model", offline: "not running", missing: "not installed", "signed-out": "signed out" };

/** A keyed engine's key, for people. */
const KEY_WORD: Record<KeyedKind, string> = { api: "Claude API key", openai: "OpenAI API key", gemini: "Gemini API key", openrouter: "OpenRouter key" };
const article = (w: string) => `${/^[AEIOU]/.test(w) ? "an" : "a"} ${w}`;

/** Who runs Qalam AI and who pays, in one line: the Claude plan, the key's last four, or this computer. */
export function whoLine(view: EngineView): string {
  const a = view.claude.account;
  if (view.kind === "cli") return ["Claude Code on this computer", a?.plan ? `${PLAN[a.plan] ?? a.plan} plan` : null, a?.email ?? null].filter(Boolean).join(" · ");
  if (isKeyed(view.kind)) return view.key ? `${KEY_WORD[view.kind]} ending ${view.key.last4} · ${view.key.from === "keychain" ? "in the Keychain" : "from the environment"}` : KEY_WORD[view.kind];
  if (view.kind === "codex") return ["Codex on this computer", view.codex?.method === "chatgpt" ? "your ChatGPT plan" : view.codex?.method === "api-key" ? "signed in with an OpenAI API key" : null].filter(Boolean).join(" · ");
  if (isLocal(view.kind)) return `${view.label ?? ENGINE_LABEL[view.kind]} on this computer · nothing leaves it`;
  return view.label ?? ENGINE_LABEL[view.kind];
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
  const chooseModels = async (models: ModelMix) => {
    if (!view || models === view.models) return;
    setError(null);
    try {
      setView(await engineDb.models(models));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const changed = useCallback((v: EngineView) => {
    setView(v);
    setTest(null);
    void refreshHealth();
  }, []);

  if (!view) return <div className={clsx(r.skeleton, "h-[132px] rounded-lg")} aria-hidden />;
  const shown = test ?? view.test;
  const ready = shown ? shown.ok : view.ready;
  const word = shown && !shown.ok ? shown.word : view.ready ? "Ready" : view.word;
  const detail = shown && !shown.ok ? shown.detail : view.ready ? undefined : view.detail;
  const a = view.claude.account;
  const claude = view.kind === "cli" || view.kind === "api";

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
          <p className="truncate text-caption text-fg-subtle">{whoLine(view)}</p>
          {detail && <p className="pt-[2px] text-caption text-fg-muted">{detail}</p>}
          {view.kind === "cli" && a?.apiKeySource && <p className="pt-[2px] text-caption text-warning">{a.apiKeySource} is set on this computer. Qalam leaves it out, so your sign-in is what's used.</p>}
        </div>
        <div className="flex shrink-0 items-center gap-[6px]">
          {view.kind === "cli" && word === "Signed out" && <CopyCommand command="claude auth login" />}
          {view.kind === "codex" && word === "Signed out" && <CopyCommand command="codex login" />}
          <Button variant="secondary" size="sm" disabled={testing} onClick={() => void runTest()}>
            {testing ? "Testing…" : "Test"}
          </Button>
        </div>
      </div>

      <EngineSetup view={view} onView={changed} onError={setError} />
      {isLocal(view.kind) && <WebSearch view={view} onSaved={changed} onError={setError} />}

      {claude && (
        <div className="flex flex-wrap items-center gap-[12px]">
          <Segmented<ModelMix>
            label="Models"
            value={view.models}
            onChange={(m) => void chooseModels(m)}
            className="w-[240px]"
            options={[
              { value: "balanced", label: "Balanced", title: "Sonnet reads sources and files them, Opus proposes and decides. Fewer tokens." },
              { value: "best", label: "Best", title: "Opus, and Sonnet only for the reads it measured as good at (goals' numbers, outside numbers)" },
            ]}
          />
          <span className="text-caption text-fg-subtle">{mixLine(view)}</span>
        </div>
      )}
      {error && <p className="text-caption text-danger">{error}</p>}

      {usage && <Usage u={usage} kind={view.kind} />}
    </section>
  );
}

/**
 * Which engine, and what it needs: a key for one reached with a key (tested before it's kept), the
 * address of a model on this computer, and the models an engine that isn't Claude runs on. The
 * welcome shows the same. `fresh`: a key field even when a key is kept (the welcome, after a test failed).
 */
export function EngineSetup({ view, onView, onError, fresh }: { view: EngineView; onView: (v: EngineView) => void; onError: (m: string | null) => void; fresh?: boolean }) {
  const options: EngineOption[] = view.options ?? [
    { kind: "cli", label: ENGINE_LABEL.cli, state: "ready" },
    { kind: "api", label: ENGINE_LABEL.api, state: "ready" },
  ];
  const choose = async (kind: EngineKind) => {
    if (kind === view.kind) return;
    onError(null);
    try {
      onView(await engineDb.choose(kind));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const live = options.find((o) => o.kind === view.kind);
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <Select<EngineKind>
          ariaLabel="Engine"
          value={view.kind}
          onChange={(k) => void choose(k)}
          className="w-[240px]"
          options={options.map((o) => ({ value: o.kind, label: [o.label, STATE_WORD[o.state]].filter(Boolean).join(" · "), group: o.kind === "cli" || isLocal(o.kind) ? "On this computer" : "With a key" }))}
        />
        {isKeyed(view.kind) && <KeyField view={fresh ? { ...view, key: null } : view} kind={view.kind} onSaved={onView} onError={onError} />}
        {isLocal(view.kind) && <BaseField key={view.kind} view={view} onSaved={onView} onError={onError} />}
      </div>
      {!(view.kind === "cli" || view.kind === "api") && (live?.state === "ready" || live?.state === "pick-model") && <TierPicker key={view.kind} view={view} picked={live.models ?? {}} onSaved={onView} onError={onError} />}
    </div>
  );
}

const SAME = "same";
/** Codex picks its own model unless one is picked. */
const ITS_OWN = "its-own";

/** The models an engine that isn't Claude runs on, from its own list: one that decides, and one that reads (the same, unless picked). */
function TierPicker({ view, picked, onSaved, onError }: { view: EngineView; picked: Partial<Record<Tier, string>>; onSaved: (v: EngineView) => void; onError: (m: string | null) => void }) {
  const [list, setList] = useState<string[] | null>(null);
  const kind = view.kind;
  useEffect(() => {
    let live = true;
    void engineDb.list(kind).then(
      (l) => live && setList(l),
      (e: unknown) => {
        if (!live) return;
        setList([]);
        onError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => void (live = false);
  }, [kind, view.key?.last4, view.base, onError]);
  const pick = async (tier: Tier, model: string) => {
    const next = { ...picked, [tier]: model };
    if (model === SAME || model === ITS_OWN) delete next[tier];
    onError(null);
    try {
      onSaved(await engineDb.tiers(kind, next));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  if (!list) return <span className="q-shimmer-text text-caption text-fg-subtle">Looking at its models…</span>;
  if (!list.length) return <span className="text-caption text-fg-subtle">{isLocal(kind) ? `No models yet. Download one in ${view.label ?? ENGINE_LABEL[kind]}, then come back.` : "This key offers no models."}</span>;
  const models = list.map((m) => ({ value: m, label: m }));
  return (
    <div className="flex flex-wrap items-center gap-[12px]">
      <label className="flex items-center gap-[8px]">
        <span className="text-micro font-medium text-fg-subtle">Decides</span>
        <Select<string>
          ariaLabel="The model that decides"
          value={picked.decide ?? (kind === "codex" ? ITS_OWN : "")}
          onChange={(m) => void pick("decide", m)}
          className="w-[220px]"
          options={kind === "codex" ? [{ value: ITS_OWN, label: "Codex's choice" }, ...models] : models}
        />
      </label>
      <label className="flex items-center gap-[8px]">
        <span className="text-micro font-medium text-fg-subtle">Reads</span>
        <Select<string> ariaLabel="The model that reads" value={picked.read ?? SAME} onChange={(m) => void pick("read", m)} className="w-[220px]" options={[{ value: SAME, label: "The same model" }, ...models]} />
      </label>
    </div>
  );
}

/** A model on this computer has no web search of its own: it looks things up through Tavily once a key is kept here. */
function WebSearch({ view, onSaved, onError }: { view: EngineView; onSaved: (v: EngineView) => void; onError: (m: string | null) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const t = view.web?.tavily;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      onSaved(await engineDb.saveTavily(key));
      setKey("");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-[12px]">
      <span className="text-micro font-medium text-fg-subtle">Web search</span>
      {t ? (
        <>
          <span className="text-caption text-fg-muted">
            Through Tavily · key ending {t.last4} · {t.from === "keychain" ? "in the Keychain" : "from the environment"}
          </span>
          {t.from === "keychain" && (
            <button
              type="button"
              className={clsx(r.buttonSm, r.buttonGhost)}
              onClick={() =>
                void engineDb.forgetTavily().then(onSaved, (e: unknown) => onError(e instanceof Error ? e.message : String(e)))
              }
            >
              Remove the key
            </button>
          )}
        </>
      ) : view.canStore ? (
        <form onSubmit={(e) => void save(e)} className="flex min-w-[280px] flex-1 items-center gap-[8px]">
          <label className={clsx(r.field, "flex-1")}>
            <span className="sr-only">Tavily key</span>
            <input type="password" autoComplete="off" spellCheck={false} placeholder="Off: paste a Tavily key to look things up online" value={key} onChange={(e) => setKey(e.target.value)} className={r.fieldInput} />
          </label>
          <Button type="submit" size="sm" disabled={busy || key.trim().length < 20}>
            {busy ? "Testing…" : "Test and keep"}
          </Button>
        </form>
      ) : (
        <span className="text-caption text-fg-subtle">Off: set TAVILY_API_KEY where Qalam starts.</span>
      )}
    </div>
  );
}

/** Where a model on this computer answers: its usual address, or another one on this computer. */
function BaseField({ view, onSaved, onError }: { view: EngineView; onSaved: (v: EngineView) => void; onError: (m: string | null) => void }) {
  const [base, setBase] = useState(view.base ?? "");
  const save = async () => {
    if (base.trim() === (view.base ?? "")) return;
    onError(null);
    try {
      onSaved(await engineDb.base(view.kind, base.trim() || null));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setBase(view.base ?? "");
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex min-w-[220px] flex-1 items-center gap-[8px]"
    >
      <label className={clsx(r.field, "flex-1")}>
        <span className="sr-only">Its address on this computer</span>
        <input spellCheck={false} value={base} onChange={(e) => setBase(e.target.value)} onBlur={() => void save()} className={clsx(r.fieldInput, "font-mono")} />
      </label>
    </form>
  );
}

/** A key typed in once: tested, then kept in the Keychain (never shown again, only its last four). */
export function KeyField({ view, kind = "api", onSaved, onError }: { view: EngineView; kind?: KeyedKind; onSaved: (v: EngineView) => void; onError: (m: string | null) => void }) {
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
              void engineDb.forgetKey(kind).then(
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
  if (!view.canStore) return <span className="text-caption text-fg-subtle">Set the key where Qalam starts: this computer has no Keychain.</span>;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      onSaved(await engineDb.saveKey(key, kind));
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
        <span className="sr-only">{KEY_WORD[kind]}</span>
        <input type="password" autoComplete="off" spellCheck={false} placeholder={`Paste ${article(KEY_WORD[kind])}`} value={key} onChange={(e) => setKey(e.target.value)} className={r.fieldInput} />
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
        <Tip label={kind === "cli" ? "Claude Code's own estimate, at API prices. Your Claude plan covers these calls." : isLocal(kind) ? "Calls on this computer cost nothing." : "As the calls reported it."}>
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
