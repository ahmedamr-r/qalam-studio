import { useEffect, useState } from "react";
import clsx from "clsx";
import { startProblem } from "@/onboarding/start";
import { noOrgHere } from "@/org/client";
import { orgsHref } from "@/projects/model";
import { EngineLogo } from "../brand/ConnectorLogo";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { CopyCommand, EngineSetup, whoLine } from "../connections/EngineCard";
import { LoneComposer } from "../chat/ChatThread";
import { AttachmentChips, SourceMenu } from "../chat/SourcePicker";
import { attachFiles, clearAttachments, heldImages, holdPictures, readyDocs, useAttach } from "../chat/attach";
import { trySample } from "../org/sample";
import { r } from "../recipes";
import { checkEngine, engineChanged, openKeyField, skipEngine, startWelcome, useEngineCheck } from "./engine";
import { boxDocs, sendStart } from "./flow";
import { choiceChip, Stage } from "./Stage";

/*
 * The first run: one box, as a chat's home page has. What they're working on in their words, a
 * product's name or link, files and pictures, or what's in a tool they use. Send makes the project
 * and opens its canvas, whose chat takes it from there (./flow.ts). Nothing here belongs to a
 * project until then, so a window opened for a new one never touches the one opened last.
 */

/** Qalam AI can't answer on this computer: what would let it. Words can still go; files need it. */
function EngineNotice() {
  const e = useEngineCheck();
  const [error, setError] = useState<string | null>(null);
  const v = e.view;
  const test = e.test ?? v?.test ?? null;
  const detail = test?.detail ?? v?.detail;
  const who = v ? whoLine(v) : "";
  return (
    <section aria-label="Qalam AI isn't ready" className={clsx("q-sheet q-rise flex flex-col gap-[10px] rounded-xl p-[14px]")}>
      <div className="flex flex-col gap-[4px]">
        <p className="text-title font-medium text-fg">Qalam AI can&apos;t answer on this computer yet</p>
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
        <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={skipEngine}>
          Set up later
        </button>
      </div>
      {e.keyOpen && v && <EngineSetup view={v} fresh onError={setError} onView={(next) => void engineChanged(next)} />}
    </section>
  );
}

/** What the researcher says, by what's going on. */
const LINES = {
  idle: "Tell me what you're making. I'll find the people it annoys.",
  reading: "Reading it now. Don't watch.",
  writing: "Making you a project. Try to look busy.",
  shrug: "I need a brain to borrow. Claude Code or Codex will do.",
} as const;

/** Openings that say whose it is, so the box reads it (`whoseOf`). */
const STARTS = [
  { label: "Our product…", draft: "Our product is " },
  { label: "My idea…", draft: "My idea is " },
] as const;

export function StartFlow() {
  const engine = useEngineCheck();
  const items = useAttach((s) => s.items);
  const [draft, setDraft] = useState<{ text: string; key: string }>({ text: "", key: "start" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fresh = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1";
  useEffect(() => {
    noOrgHere();
    holdPictures(true);
    clearAttachments();
    startWelcome(window.location.search);
    return () => holdPictures(false);
  }, []);

  const ok = !!(engine.test ?? engine.view?.test)?.ok;
  const known = !engine.checking && !!(engine.view || engine.error);
  const missing = known && !ok;
  const reading = items.some((a) => a.state === "reading");
  const pose = busy ? "writing" : missing && !engine.skipped ? "shrug" : reading ? "reading" : "idle";
  const ready = readyDocs(items).length + heldImages(items).length;

  const send = async (text: string) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      if (await sendStart(text, items)) return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
    return false;
  };

  return (
    <Stage pose={pose} line={LINES[pose]} home={fresh ? orgsHref() : "/welcome"} title="What are you working on?" about="A product, an idea, or what your customers told you. Add files or screenshots as you go.">
      <LoneComposer
        variant="hero"
        label="What you're working on"
        placeholder="Basket, an App Store link, or your idea in a sentence"
        submit="enter"
        disabled={busy}
        running={false}
        draft={draft.text}
        draftKey={draft.key}
        check={(text) => (reading ? "Wait a moment: a file is still being read." : startProblem(text, boxDocs(items), engine.checking || !known ? "checking" : ok ? "ok" : "none"))}
        onSend={send}
        plus={<SourceMenu fit="customers" />}
        attached={<AttachmentChips />}
        onFiles={attachFiles}
        sendEmpty={ready > 0}
      />
      {error && <p className="text-center text-body text-danger">{error}</p>}
      <div className="flex flex-wrap items-center justify-center gap-[8px]">
        {STARTS.map((s) => (
          <button key={s.label} type="button" className={choiceChip} disabled={busy} onClick={() => setDraft({ text: s.draft, key: `${s.label}:${Date.now()}` })}>
            {s.label}
          </button>
        ))}
        <button type="button" className={clsx(choiceChip, "gap-[6px]")} disabled={busy} onClick={() => void trySample()}>
          <QalamAIGlyph size={12} />
          See a sample
        </button>
      </div>
      {missing && !engine.skipped && <EngineNotice />}
      {fresh && (
        <a href={orgsHref()} className={clsx(r.buttonSm, r.buttonGhost, "self-center")}>
          Back to your organizations
        </a>
      )}
    </Stage>
  );
}
