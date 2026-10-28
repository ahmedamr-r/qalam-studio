import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check } from "lucide-react";
import { createOrg } from "@/org/client";
import { engineDb, type EngineTest, type EngineView } from "@/org/engine";
import { orgHref, setupHref } from "@/projects/model";
import { QalamAIGlyph, QalamMark } from "../brand";
import { Button, Spinner } from "../controls";
import { r } from "../recipes";
import Toasts from "../toast";
import { StatusDot } from "../viz";
import { CopyCommand, KeyField, PLAN } from "../connections/EngineCard";
import { ThisMac } from "../connections/ThisMac";
import { StepHeader } from "./StepHeader";
import { changesThings, welcomeMode, type WelcomeMode } from "./steps";

/**
 * The welcome, like OpenClaw's QuickStart: Qalam finds the Claude this Mac already has and makes a
 * short real call to it, then they name the organization and go on to tell Qalam AI about it (the
 * setup page). Anything else waits for later. Opened when there's no organization yet, for a new
 * one from the organization menu (?new=1), and to check the setup again (?verify=1), which only
 * tests and reports.
 */
export default function WelcomePage() {
  const [mode] = useState<WelcomeMode>(() => welcomeMode(window.location.search));
  const [engineDone, setEngineDone] = useState(false);
  useEffect(() => {
    document.title = mode === "verify" ? "Check the setup · Qalam" : "Welcome · Qalam";
  }, [mode]);
  return (
    <Tooltip.Provider delayDuration={500}>
      <div className="relative min-h-screen bg-app text-fg" style={{ "--toolbar-h": "0px" } as CSSProperties}>
        <header className={r.topBar}>
          <a href={mode === "first" ? "/welcome" : orgHref()} aria-label="Qalam" className={r.brandCell}>
            <QalamMark size={20} />
          </a>
        </header>
        <main className="mx-auto flex w-full max-w-[600px] flex-col gap-[24px] px-[24px] py-[40px]">
          <div className="flex flex-col gap-[6px]">
            <h1 className="text-display font-semibold text-fg">{mode === "verify" ? "Check the setup" : mode === "new" ? "A new organization" : "Welcome to Qalam"}</h1>
            <p className="text-body text-fg-muted">{mode === "verify" ? "Each part tested again. Nothing is changed." : "Decide what to build from what your customers say."}</p>
          </div>
          {mode !== "verify" && <StepHeader at={engineDone ? "name" : "engine"} />}
          <EngineStep mode={mode} onDone={() => setEngineDone(true)} />
          {mode === "verify" ? (
            <>
              <ThisMac withEngine={false} />
              <a href={orgHref()} className={clsx(r.button, r.buttonSecondary, "self-start")}>
                Back
              </a>
            </>
          ) : (
            engineDone && <NameStep />
          )}
        </main>
        <Toasts />
      </div>
    </Tooltip.Provider>
  );
}

/** Qalam AI: what this Mac already has, tested with a short real call; or a key instead; or later. */
function EngineStep({ mode, onDone }: { mode: WelcomeMode; onDone: () => void }) {
  const [view, setView] = useState<EngineView | null>(null);
  const [test, setTest] = useState<EngineTest | null>(null);
  const [busy, setBusy] = useState(true);
  const [useKey, setUseKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      let v = await engineDb.view();
      // What's here already: Claude Code signed in, and no key set, is used (OpenClaw's detection).
      if (changesThings(mode) && v.kind === "api" && !v.key && v.claude.found && v.claude.signedIn) v = await engineDb.choose("cli");
      setView(v);
      const testable = v.kind === "cli" ? v.claude.found && v.claude.signedIn !== false : !!v.key;
      const t = testable ? await engineDb.test() : null;
      setTest(t);
      if (t?.ok && mode !== "verify") onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => void check(), []);

  const ok = !!test?.ok;
  const a = view?.claude.account;
  const what = !view ? "" : view.kind === "cli" ? ["Claude Code on this Mac", a?.plan ? `${PLAN[a.plan] ?? a.plan} plan` : null, a?.email ?? null].filter(Boolean).join(" · ") : view.key ? `API key ending ${view.key.last4}` : "Claude API key";
  const word = busy ? (view ? "Making a short call…" : "Looking for Claude Code on this Mac…") : ok ? "Ready" : (test?.word ?? view?.word ?? "Not set up");
  const detail = busy || ok ? null : (test?.detail ?? view?.detail);

  return (
    <section aria-label="Qalam AI" className="flex flex-col gap-[12px] rounded-lg bg-panel p-[16px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-start gap-[12px]">
        <span className={clsx("grid size-[36px] shrink-0 place-items-center rounded-md", ok ? "bg-success-subtle text-success" : "bg-raised")}>{ok ? <Check size={18} strokeWidth={2} /> : busy ? <Spinner /> : <QalamAIGlyph size={18} />}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <p className="flex items-center gap-[8px] text-body font-medium text-fg">
            Qalam AI
            <span className="inline-flex items-center gap-[6px] text-caption font-normal text-fg-muted">
              {!busy && <StatusDot tone={ok ? "ok" : "bad"} />}
              {word}
              {ok && test && <span className="text-fg-subtle tnum">· {(test.ms / 1000).toFixed(1)} s</span>}
            </span>
          </p>
          {what && <p className="truncate text-caption text-fg-subtle">{what}</p>}
          {detail && <p className="pt-[2px] text-caption text-fg-muted">{detail}</p>}
          {error && <p className="pt-[2px] text-caption text-danger">{error}</p>}
        </div>
      </div>
      {!busy && !ok && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {view?.kind === "cli" && test?.word === "Signed out" && <CopyCommand command="claude auth login" />}
          {view?.kind === "cli" && !view.claude.found && (
            <a href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noreferrer" className={clsx(r.buttonSm, r.buttonSecondary)}>
              Install Claude Code
            </a>
          )}
          <Button variant="secondary" size="sm" onClick={() => void check()}>
            Check again
          </Button>
          {changesThings(mode) && !useKey && (
            <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={() => setUseKey(true)}>
              Use an API key instead
            </button>
          )}
          {changesThings(mode) && (
            <button type="button" className={clsx(r.buttonSm, r.buttonGhost, "ml-auto")} onClick={onDone}>
              Set up later
            </button>
          )}
        </div>
      )}
      {useKey && view && !ok && (
        <KeyField
          view={{ ...view, key: null }}
          onError={setError}
          onSaved={async () => {
            setUseKey(false);
            await check();
          }}
        />
      )}
    </section>
  );
}

/** The organization's name: a folder in ~/Qalam, then on to telling Qalam AI about it. */
function NameStep() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const org = await createOrg(name.trim());
      window.location.assign(`${setupHref(org.id)}?first=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void go(e)} aria-label="Name it" className="flex flex-col gap-[8px]">
      <label className="text-micro font-medium text-fg-subtle" htmlFor="org-name">
        A company, a client or a side project
      </label>
      <div className="flex items-center gap-[8px]">
        <span className={clsx(r.field, "h-[36px] flex-1")}>
          <input id="org-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Basket" className={clsx(r.fieldInput, "text-body")} />
        </span>
        <Button disabled={!name.trim() || busy}>{busy ? "Making it…" : "Continue"}</Button>
      </div>
      {error && <p className="text-caption text-danger">{error}</p>}
    </form>
  );
}
