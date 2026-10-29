import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check } from "lucide-react";
import { formatKeys, kb } from "@/commands/registry";
import { orgFetch } from "@/org/client";
import { Button, Kbd, Segmented } from "../controls";
import { r } from "../recipes";
import { useCurrentOrg } from "../frame/store";
import { Dictated } from "../voice/MicButton";

/**
 * Quick capture, from any app (⌃⌥Space in the menu bar's Qalam): a note, a customer's quote with
 * who said it, or a link. It goes into the organization's inbox folder, which takes it from there
 * (read, filed into the topic pages, placed on the boards). ⌘↵ adds it; Esc puts the window away.
 */

type Kind = "note" | "quote" | "link";

export default function CapturePage() {
  const org = useCurrentOrg();
  const [kind, setKind] = useState<Kind>("note");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const ready = kind === "link" ? /^https?:\/\/\S+\.\S+/.test(url.trim()) : text.trim().length > 0;

  useEffect(() => {
    document.title = "Quick capture · Qalam";
    const away = (e: KeyboardEvent) => e.key === "Escape" && window.close();
    window.addEventListener("keydown", away);
    // Shown again for the next one: start clean, in the field.
    const fresh = () => document.visibilityState === "visible" && area.current?.focus();
    document.addEventListener("visibilitychange", fresh);
    area.current?.focus();
    return () => {
      window.removeEventListener("keydown", away);
      document.removeEventListener("visibilitychange", fresh);
    };
  }, []);

  const add = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready || state === "adding") return;
    setState("adding");
    setError(null);
    try {
      await orgFetch("/quick", { method: "POST", json: { kind, text, ...(kind === "link" ? { url: url.trim() } : {}), ...(kind === "quote" && speaker.trim() ? { speaker: speaker.trim() } : {}) } });
      setState("added");
      setText("");
      setUrl("");
      setSpeaker("");
      // The capture window goes away; a tab stays, ready for the next one.
      setTimeout(() => {
        window.close();
        setState("idle");
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  };

  return (
    <Tooltip.Provider delayDuration={500}>
      <form
        onSubmit={(e) => void add(e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void add();
        }}
        className="flex h-screen flex-col gap-[10px] bg-app p-[14px] text-fg [-webkit-app-region:drag]"
        style={{ "--toolbar-h": "0px" } as CSSProperties}
      >
        <div className="flex items-center justify-between gap-[12px] [-webkit-app-region:no-drag]">
          <Segmented<Kind>
            label="What it is"
            value={kind}
            onChange={setKind}
            className="w-[240px]"
            options={[
              { value: "note", label: "Note" },
              { value: "quote", label: "Quote" },
              { value: "link", label: "Link" },
            ]}
          />
          <span className="truncate text-caption text-fg-subtle">Into {org?.name ?? "the organization"}&apos;s inbox</span>
        </div>
        {kind === "link" && (
          <span className={clsx(r.field, "[-webkit-app-region:no-drag]")}>
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Link" className={r.fieldInput} />
          </span>
        )}
        <Dictated field={area} set={setText} className="flex min-h-0 flex-1 flex-col [-webkit-app-region:no-drag]">
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === "quote" ? "What the customer said, word for word" : kind === "link" ? "Why it matters (optional)" : "What you noticed"}
            aria-label={kind === "quote" ? "Quote" : "Note"}
            className="min-h-0 flex-1 resize-none rounded-md bg-field px-[10px] py-[8px] text-body text-fg outline-none placeholder:text-fg-faint focus:shadow-focus-field"
          />
        </Dictated>
        <div className="flex items-center gap-[8px] [-webkit-app-region:no-drag]">
          {kind === "quote" && (
            <span className={clsx(r.field, "w-[200px]")}>
              <input value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="Who said it" aria-label="Who said it" className={r.fieldInput} />
            </span>
          )}
          {error && <span className="truncate text-caption text-danger">{error}</span>}
          <span className="ml-auto flex items-center gap-[8px]">
            {state === "added" ? (
              <span className="inline-flex items-center gap-[6px] text-caption text-success">
                <Check size={14} strokeWidth={2} /> In the inbox
              </span>
            ) : (
              <Button type="submit" size="sm" disabled={!ready || state === "adding"}>
                {state === "adding" ? "Adding…" : "Add"}
                <Kbd keys={formatKeys(kb("⌘↵"))} size="sm" />
              </Button>
            )}
          </span>
        </div>
      </form>
    </Tooltip.Provider>
  );
}
