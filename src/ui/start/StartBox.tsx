import { useEffect, useState } from "react";
import clsx from "clsx";
import { startProblem } from "@/onboarding/start";
import { noOrgHere } from "@/org/client";
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
import { choiceChip } from "./Stage";

/*
 * The one box that starts a project (the first run's page, and the top of the organizations page):
 * what they're working on in their words, files and pictures, or a tool's items. Send makes the
 * project and opens its canvas, whose chat takes it from there (./flow.ts). Nothing on a page with
 * it belongs to a project until then, so it never touches the one opened last.
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

/** Openings that say whose it is, so the box reads it (`whoseOf`). */
const STARTS = [
  { label: "Our product…", draft: "Our product is " },
  { label: "My idea…", draft: "My idea is " },
] as const;

/** Whether the box is going: Send pressed and the project being made, or a file still being read. */
export function useStartBusy(busy: boolean) {
  const engine = useEngineCheck();
  const reading = useAttach((s) => s.items.some((a) => a.state === "reading"));
  const ok = !!(engine.test ?? engine.view?.test)?.ok;
  const known = !engine.checking && !!(engine.view || engine.error);
  return { busy, reading, missing: known && !ok && !engine.skipped };
}

/**
 * The box, its chips and, where Qalam AI can't answer, what would let it. `search`: the page's
 * address, which says whether this computer is new to Qalam (a passed engine check from the last
 * hour counts for another project). `sample`: offer the sample.
 */
export function StartBox({ search, sample = true, onBusy }: { search: string; sample?: boolean; onBusy?: (busy: boolean) => void }) {
  const engine = useEngineCheck();
  const items = useAttach((s) => s.items);
  const [draft, setDraft] = useState<{ text: string; key: string }>({ text: "", key: "start" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    noOrgHere();
    holdPictures(true);
    clearAttachments();
    startWelcome(search);
    return () => holdPictures(false);
  }, []);
  useEffect(() => onBusy?.(busy), [busy]);

  const ok = !!(engine.test ?? engine.view?.test)?.ok;
  const known = !engine.checking && !!(engine.view || engine.error);
  const reading = items.some((a) => a.state === "reading");
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
    <div className="flex flex-col gap-[20px]">
      <LoneComposer
        variant="hero"
        label="What you're working on"
        placeholder="Your product, an idea, or what's going wrong with it"
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
        {sample && (
          <button type="button" className={clsx(choiceChip, "gap-[6px]")} disabled={busy} onClick={() => void trySample()}>
            <QalamAIGlyph size={12} />
            See a sample
          </button>
        )}
      </div>
      {known && !ok && !engine.skipped && <EngineNotice />}
    </div>
  );
}
