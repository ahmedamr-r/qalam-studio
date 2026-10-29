import clsx from "clsx";
import { useEffect, useState } from "react";
import { chooseVoice, loadVoice, removeParakeet, useVoice } from "@/org/voice";
import { voiceOffer, type VoiceChoice, type VoiceView } from "@/voice/model";
import { Select } from "../controls";
import { r } from "../recipes";
import { StatusDot } from "../viz";
import { ParakeetInstall } from "../voice/ParakeetInstall";

/*
 * Talking instead of typing on this Mac (src/voice/model.ts): what the mic in the boxes uses, and
 * changing it. Apple's engine where macOS has it, else Parakeet once installed (offered here, never
 * downloaded unasked); their own dictation app, or off.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** How it stands, in a word. */
function word(v: VoiceView): string {
  if (v.use === "apple") return "On · Apple's engine";
  if (v.use === "parakeet") return "On · Parakeet";
  if (v.chosen === "own") return "Your own dictation app";
  return "Off";
}

export function VoiceCard() {
  const view = useVoice((s) => s.view);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void loadVoice(true), []);
  if (!view) return <div className={clsx(r.skeleton, "h-[56px] rounded-lg")} aria-hidden />;
  const offer = voiceOffer(view);
  const choices: { value: VoiceChoice; label: string }[] = [
    ...(offer === "apple" ? [{ value: "apple" as const, label: "Apple's engine, on this Mac" }] : []),
    ...(view.parakeet.installed ? [{ value: "parakeet" as const, label: "Parakeet, on this Mac" }] : []),
    { value: "own", label: "My own dictation app" },
    { value: "off", label: "Off" },
  ];
  // An engine chosen on a Mac that doesn't have it reads as off.
  const value: VoiceChoice = view.use ?? (view.chosen === "own" ? "own" : "off");
  return (
    <section aria-label="Voice" className="flex flex-col gap-[8px] rounded-lg bg-panel px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-start gap-[10px]">
        <StatusDot tone={view.use ? (view.mic === "denied" ? "warn" : "ok") : "off"} className="mt-[6px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <p className="text-body text-fg">
            Talk instead of typing <span className="text-fg-muted">· {offer === "none" ? "Needs the Mac app" : word(view)}</span>
          </p>
          <p className="text-caption text-fg-subtle">
            {offer === "none"
              ? "Your own dictation app works in any box."
              : view.use && view.mic === "denied"
                ? "Allow Qalam in System Settings → Privacy & Security → Microphone."
                : view.use
                  ? "Click the mic in a box you write in, or press ⌃⌥D. English for now; nothing you say leaves this Mac."
                  : view.chosen === "own"
                    ? "Your dictation app types into any box; Qalam's mic stays out of the way."
                    : "Turn it on for a mic in the boxes you write in."}
          </p>
        </div>
        {offer !== "none" && (
          <Select<VoiceChoice>
            ariaLabel="What the mic uses"
            className="w-[220px] shrink-0"
            value={value}
            options={choices}
            onChange={(use) => {
              setError(null);
              void chooseVoice(use).catch((e) => setError(message(e)));
            }}
          />
        )}
      </div>
      {offer === "parakeet" && <ParakeetInstall onDone={() => void chooseVoice("parakeet")} />}
      {view.parakeet.installed && (
        <button
          type="button"
          className={clsx(r.buttonSm, r.buttonGhost, "self-end")}
          onClick={() => {
            setError(null);
            void removeParakeet().catch((e) => setError(message(e)));
          }}
        >
          Remove Parakeet
        </button>
      )}
      {error && <p className="text-caption text-danger">{error}</p>}
    </section>
  );
}
