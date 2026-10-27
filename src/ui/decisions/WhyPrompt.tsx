import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { Button, fieldBox, IconBtn } from "../controls";
import { patchDecision, useWhy } from "./recorder";

/**
 * The one line a big decision asks for: why the solution was dropped, the opportunity parked, the
 * target changed. Optional: it goes away after 20 s untouched, and a why can be added later from
 * the card's History. It sits above the toasts (the change often brings one) and never takes the
 * keyboard from the board.
 */
export default function WhyPrompt() {
  const ask = useWhy((s) => s.ask);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  useEffect(() => {
    setText("");
    touched.current = false;
    if (!ask) return;
    const t = setTimeout(() => !touched.current && useWhy.setState({ ask: null }), 20_000);
    return () => clearTimeout(t);
  }, [ask]);
  if (!ask) return null;
  const close = () => useWhy.setState({ ask: null });
  const save = async () => {
    const why = text.trim();
    if (!why) return close();
    setBusy(true);
    try {
      await patchDecision(ask.id, { why });
      feedback("Saved with the decision", { kind: "success", id: "decisions.why" });
      close();
    } catch {
      feedback("Couldn't save the why. Add it from the card's History", { kind: "error", id: "decisions.why" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      role="dialog"
      aria-label="Why this decision"
      className="pointer-events-auto absolute bottom-[calc(var(--toolbar-h)+80px)] left-1/2 z-[4] flex w-[min(480px,calc(100%-24px))] -translate-x-1/2 flex-col gap-[6px] rounded-lg bg-elevated p-[8px] text-caption text-fg shadow-popover q-fade"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onPointerDown={(e) => {
        touched.current = true;
        e.stopPropagation();
      }}
    >
      <div className="flex items-center gap-[6px] pl-[2px]">
        <span className="min-w-0 flex-1 truncate font-medium" title={ask.what} dir="auto">
          {ask.what}
        </span>
        <IconBtn size="sm" label="Skip" onClick={close}>
          <X size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      </div>
      <div className="flex items-center gap-[6px]">
        <label className={`${fieldBox} flex-1 px-[8px]`}>
          <input
            className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-subtle"
            value={text}
            maxLength={500}
            dir="auto"
            placeholder="Why? One line for whoever asks later (optional)"
            aria-label="Why"
            onFocus={() => (touched.current = true)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") close();
            }}
          />
        </label>
        <Button size="sm" type="submit" disabled={busy || !text.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
