import clsx from "clsx";
import { useEffect, useState } from "react";
import { chooseVoice, loadVoice, useVoice } from "@/org/voice";
import { voiceOffer, type VoiceChoice, type VoiceView } from "@/voice/model";
import { Select } from "../controls";
import { r } from "../recipes";
import { StatusDot } from "../viz";

/*
 * Talking instead of typing on this Mac (src/voice/model.ts): what the mic in the boxes uses, and
 * changing it. Apple's engine where macOS has it; their own dictation app, or off.
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
    { value: "own", label: "My own dictation app" },
    { value: "off", label: "Off" },
  ];
  const value: VoiceChoice | "" = view.use ?? view.chosen ?? "";
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
                : "Click the mic in a box you write in, or press ⌃⌥D. English for now; nothing you say leaves this Mac."}
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
      {error && <p className="text-caption text-danger">{error}</p>}
    </section>
  );
}
