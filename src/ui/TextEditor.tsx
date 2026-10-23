import { useEffect, useRef } from "react";
import { useStudio, studio } from "@/doc/store";
import type { TextNode } from "@/doc/schema";
import { worldMatrix, apply } from "@/doc/geometry";
import { fitText, deleteNodes } from "@/doc/ops";
import { resolvedDirection } from "@/engine/text";
import { dispatchKeyDown } from "@/commands";

/** DOM textarea overlaid on the canvas while a text node is being edited. */
export default function TextEditor() {
  const id = useStudio((s) => s.editingTextId);
  const node = useStudio((s) => (id ? (s.doc.nodes[id] as TextNode | undefined) : undefined));
  const cam = useStudio((s) => s.camera);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!id) return;
    studio().beginTx();
    const focus = requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
    return () => {
      cancelAnimationFrame(focus);
      const s = studio();
      const n = s.doc.nodes[id] as TextNode | undefined;
      if (n && !n.text.content.trim()) {
        s.commitTx();
        deleteNodes([id]);
        return;
      }
      s.commitTx();
    };
  }, [id]);

  if (!id || !node || node.type !== "text") return null;
  const m = worldMatrix(studio().doc, id);
  const p = apply(m, { x: 0, y: 0 });
  const t = node.text;
  const dir = resolvedDirection(t);
  const left = (p.x - cam.x) * cam.zoom;
  const top = (p.y - cam.y) * cam.zoom;

  const finish = () => studio().setEditingText(null);

  return (
    <textarea
      ref={ref}
      dir={dir}
      spellCheck={false}
      value={t.content}
      aria-label="Edit text"
      // Selected characters tint with the canvas selection blue (not the chrome's saffron), over any text colour.
      className="selection:bg-selection/30"
      onChange={(e) => {
        const value = e.target.value;
        studio().mutate((d) => {
          const n = d.nodes[id] as TextNode;
          n.text.content = value;
          if (n.name === "Text" || n.name === t.content.slice(0, 32)) n.name = value.slice(0, 32) || "Text";
          fitText(n);
        });
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        // Typing never reaches the canvas shortcuts; text commands (Esc, ⌘↵, ⌘B, ⌥⌘L, ⇧⌘>…) still run.
        e.stopPropagation();
        dispatchKeyDown(e.nativeEvent, "text-edit");
      }}
      style={{
        position: "absolute",
        left,
        top,
        width: Math.max(node.w, 4) * cam.zoom + (t.autoSize === "width" ? 40 * cam.zoom : 0),
        height: node.h * cam.zoom + 2,
        transformOrigin: "0 0",
        // The layer's own and its parents' rotation and flips (the matrix carries no scale).
        transform: m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 ? undefined : `matrix(${m[0]}, ${m[1]}, ${m[2]}, ${m[3]}, 0, 0)`,
        font: `${t.fontWeight} ${t.fontSize * cam.zoom}px/${t.lineHeight * cam.zoom}px "${t.fontFamily}", "IBM Plex Sans Arabic", Inter`,
        letterSpacing: `${t.letterSpacing * cam.zoom}px`,
        color: node.fill?.color ?? "#000",
        textAlign: t.align === "center" ? "center" : t.align === "end" ? "end" : t.align === "justify" ? "justify" : "start",
        fontStyle: t.italic ? "italic" : undefined,
        textDecoration: t.decoration === "underline" ? "underline" : t.decoration === "strikethrough" ? "line-through" : undefined,
        background: "transparent",
        border: "none",
        // The canvas selection colour (renderer and DOM read the same token in both themes).
        outline: "1px solid var(--color-selection)",
        padding: 0,
        margin: 0,
        resize: "none",
        overflow: "hidden",
        whiteSpace: t.autoSize === "width" ? "pre" : "pre-wrap",
        caretColor: "var(--color-selection)",
        zIndex: 5,
      }}
    />
  );
}
