import { useEffect, useState } from "react";
import clsx from "clsx";
import { firstAnswerProblem, firstQuestion, type StartPath } from "@/onboarding/start";
import { EngineLogo } from "../brand/ConnectorLogo";
import { CopyCommand, EngineSetup, whoLine } from "../connections/EngineCard";
import { trySample } from "../org/sample";
import { checkEngine, engineChanged, openKeyField, skipEngine, startWelcome, useFirstRun } from "../onboarding/flow";
import { r } from "../recipes";
import { CompanyArt, IdeaArt } from "./art";
import { beginReading } from "./flow";
import { answerInput, Stage } from "./Stage";

/*
 * The first run: who it's for, as two cards, then what to read. It's in the address, so Back works.
 * What comes after the first answer is on /o/<org>/start (./Reading.tsx), the project made by then.
 */

const pathIn = (search: string): StartPath | null => {
  const p = new URLSearchParams(search).get("path");
  return p === "company" || p === "idea" ? p : null;
};

const STEPS = 4;

function Card({ title, about, art, onClick }: { title: string; about: string; art: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="q-item q-press flex min-w-0 flex-col gap-[12px] rounded-lg bg-raised p-[16px] text-left shadow-button hover:bg-elevated light:hover:bg-muted" onClick={onClick}>
      {art}
      <span className="flex flex-col gap-[2px]">
        <span className="text-title font-medium text-fg">{title}</span>
        <span className="text-body text-fg-muted">{about}</span>
      </span>
    </button>
  );
}

/** Qalam AI can't answer on this computer: what would let it, and the sample in the meantime. */
function EngineStep({ home }: { home: string }) {
  const e = useFirstRun((s) => s.engine);
  const [error, setError] = useState<string | null>(null);
  const v = e.view;
  const test = e.test ?? v?.test ?? null;
  const detail = test?.detail ?? v?.detail;
  const who = v ? whoLine(v) : "";
  return (
    <Stage pose="shrug" line="I need a brain to borrow. Claude Code or Codex will do." home={home} dots={{ at: 1, of: STEPS }} title="Qalam AI can't answer yet">
      <div className="flex flex-col gap-[6px]">
        {who && v?.ready && (
          <p className="flex items-center gap-[8px] text-body text-fg">
            <EngineLogo kind={v.kind} size={20} decorative />
            {who}
          </p>
        )}
        {detail && <p className="text-body text-fg-muted">{detail}</p>}
        {(e.error || error) && <p className="text-body text-danger">{e.error ?? error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-[8px]">
        {v?.kind === "cli" && test?.word === "Signed out" && <CopyCommand command="claude auth login" />}
        {v?.kind === "codex" && test?.word === "Signed out" && <CopyCommand command="codex login" />}
        {v && !v.claude.found && (
          <a href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noreferrer" className={r.replyChipPrimary}>
            Install Claude Code
          </a>
        )}
        <button type="button" className={r.replyChip} disabled={e.checking} onClick={() => void checkEngine()}>
          {e.checking ? "Checking…" : "Check again"}
        </button>
        {!e.keyOpen && (
          <button type="button" className={r.replyChip} onClick={() => openKeyField(true)}>
            Use another engine
          </button>
        )}
        <button type="button" className={r.replyChip} onClick={() => void trySample()}>
          Try it with a sample
        </button>
        <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={skipEngine}>
          Set up later
        </button>
      </div>
      {e.keyOpen && v && <EngineSetup view={v} fresh onError={setError} onView={(next) => void engineChanged(next)} />}
    </Stage>
  );
}

function FirstAnswer({ path, home }: { path: StartPath; home: string }) {
  const q = firstQuestion(path);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const problem = firstAnswerProblem(path, text);
    setError(problem);
    if (problem || busy) return;
    setBusy(true);
    try {
      await beginReading(path, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Stage pose="idle" line={q.line} home={home} dots={{ at: 1, of: STEPS }} title={q.title}>
      <form
        className="flex flex-col gap-[8px]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input autoFocus dir="auto" aria-label={q.title} className={answerInput} placeholder={q.placeholder} value={text} disabled={busy} maxLength={2000} onChange={(e) => (setText(e.target.value), setError(null))} />
        {error && <p className="text-body text-danger">{error}</p>}
        <div className="mt-[8px] flex items-center justify-between gap-[8px]">
          <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={() => history.back()}>
            Back
          </button>
          <span className="flex items-center gap-[8px]">
            {path === "company" && (
              <a href={`/welcome?${new URLSearchParams(window.location.search).has("new") ? "new=1&" : ""}full=1&for=team`} className={clsx(r.buttonSm, r.buttonGhost)}>
                Set it up in detail instead
              </a>
            )}
            <button type="submit" disabled={busy} className={clsx(r.button, r.buttonPrimary)}>
              {busy ? "Starting…" : "Start reading"}
            </button>
          </span>
        </div>
      </form>
    </Stage>
  );
}

export function StartFlow() {
  const [path, setPath] = useState<StartPath | null>(() => pathIn(window.location.search));
  const engine = useFirstRun((s) => s.engine);
  useEffect(() => {
    startWelcome(window.location.search);
    const back = () => setPath(pathIn(window.location.search));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const home = "/welcome";
  const pick = (p: StartPath) => {
    const u = new URL(window.location.href);
    u.searchParams.set("path", p);
    history.pushState(null, "", u);
    setPath(p);
  };
  if (!path)
    return (
      <Stage pose="idle" line="Pick one. I'll judge you either way." home={home} dots={{ at: 0, of: STEPS }} title="What are you working on?">
        <div className="grid grid-cols-1 gap-[12px] min-[560px]:grid-cols-2">
          <Card title="A product at a company" about="We have customers and a team." art={<CompanyArt />} onClick={() => pick("company")} />
          <Card title="My own idea" about="Just me, seeing whether it's worth building." art={<IdeaArt />} onClick={() => pick("idea")} />
        </div>
        <button type="button" className={clsx(r.buttonSm, r.buttonGhost, "self-start")} onClick={() => void trySample()}>
          Just looking? See a sample
        </button>
      </Stage>
    );
  const ok = !!(engine.test ?? engine.view?.test)?.ok;
  const known = !engine.checking && (engine.view || engine.error);
  if (known && !ok && !engine.skipped) return <EngineStep home={home} />;
  return <FirstAnswer path={path} home={home} />;
}
