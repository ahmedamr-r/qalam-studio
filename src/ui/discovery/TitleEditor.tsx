import { useEffect, useLayoutEffect, useRef } from "react";
import { studio, useStudio } from "@/doc/store";
import { apply, worldMatrix } from "@/doc/geometry";
import { dispatchKeyDown } from "@/commands";
import { cardOf, updateCardIn } from "@/discovery/ops";
import { CARD, cardBox, placeholderTitle, titleProps } from "@/discovery/metrics";
import { CARD_WIDTH } from "@/discovery/kinds";
import { useDiscovery } from "./store";
import { finishTitleEdit } from "./editing";
import { addChildCard, addSiblingCard } from "./commands";

/**
 * Typing a card's title in place: a textarea laid exactly over the title the card paints (same
 * font, size and width), so the card grows as you type. ↵ keeps it, ⇥ keeps it and starts a card
 * under it, Esc keeps it (a new card left empty goes away), clicking elsewhere keeps it.
 */
export default function TitleEditor() {
  const editing = useDiscovery((s) => s.editing);
  const id = editing?.id ?? null;
  const node = useStudio((s) => (id ? s.doc.nodes[id] : undefined));
  const cam = useStudio((s) => s.camera);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Focus as it mounts (same commit as the key that made the card), so the next key types here.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!id || !el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, [id]);

  // Undo while typing, or the card deleted under the editor: stop editing it.
  useEffect(() => {
    if (id && !node) finishTitleEdit("commit");
  }, [id, node]);

  const card = id && node ? cardOf(studio().doc, id) : null;
  if (!id || !node || !card) return null;
  const box = cardBox(card);
  const t = titleProps(card);
  const p = apply(worldMatrix(studio().doc, id), { x: CARD.pad, y: box.titleY });
  const z = cam.zoom;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      finishTitleEdit("commit");
      return;
    }
    if (e.key === "Tab" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      finishTitleEdit("commit");
      if (!studio().doc.nodes[id]) return;
      if (e.shiftKey) addSiblingCard(id);
      else addChildCard(id);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      finishTitleEdit("commit");
      return;
    }
    // App-wide commands (⌘K, ⌘\…) still run from here, as from any field.
    dispatchKeyDown(e.nativeEvent, "field");
  };

  return (
    <textarea
      ref={ref}
      dir="auto"
      rows={1}
      spellCheck
      value={card.title}
      placeholder={placeholderTitle(card.kind)}
      aria-label={`${card.kind === "outcome" ? "Outcome" : "Card"} title`}
      maxLength={240}
      className="selection:bg-selection/30 placeholder:text-fg-faint"
      onChange={(e) => {
        const title = e.target.value.replace(/\s*\n\s*/g, " ");
        studio().mutate((d) => updateCardIn(d, id, (c) => void (c.title = title)));
      }}
      onBlur={() => {
        if (useDiscovery.getState().editing?.id === id) finishTitleEdit("commit");
      }}
      onKeyDown={onKeyDown}
      style={{
        position: "absolute",
        left: (p.x - cam.x) * z,
        top: (p.y - cam.y) * z,
        width: (CARD_WIDTH[card.kind] - CARD.pad * 2) * z,
        height: Math.max(box.titleH, t.lineHeight) * z + 2,
        font: `${t.fontWeight} ${t.fontSize * z}px/${t.lineHeight * z}px Inter, "IBM Plex Sans Arabic"`,
        letterSpacing: `${t.letterSpacing * z}px`,
        color: "var(--color-fg)",
        background: "transparent",
        border: "none",
        outline: "none",
        padding: 0,
        margin: 0,
        resize: "none",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        caretColor: "var(--color-selection)",
        pointerEvents: "auto",
        zIndex: 5,
      }}
    />
  );
}

