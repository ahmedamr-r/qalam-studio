import { useState } from "react";
import { studio } from "@/doc/store";
import { emptyBrief, updateScreen } from "@/doc/brief";
import type { ProjectBrief } from "@/doc/schema";
import { feedback } from "@/commands/feedback";
import { getSystem, useSystems } from "@/design-system/registry";
import { locateDsFact, replaceDsFact } from "@/knowledge/edit";
import { dsKeyOf, ref } from "@/knowledge/refs";
import type { KnowledgeNode } from "@/knowledge/types";
import { Button, Field } from "../controls";
import { editSystem } from "../workspace/editing";
import { moveControls } from "./actions";

/**
 * Editing a fact in the hub's inspector. Brief entries change in the document (out of undo, like
 * the Library panel's edits); design-system rules change the system, and a built-in rule's edit
 * goes into a copy of the system that becomes the active one.
 */

/** Brief edits stay out of undo history, like the critique's own writes. */
function setBrief(fn: (b: ProjectBrief) => ProjectBrief) {
  const next = fn(studio().doc.brief ?? emptyBrief());
  studio().mutate(
    (d) => {
      d.brief = { ...next, updatedAt: Date.now() };
    },
    { history: false },
  );
}

function canEdit(n: KnowledgeNode): boolean {
  if (n.status === "ghost") return false;
  if (n.kind === "summary" || n.kind === "answer" || n.kind === "screen-goal") return true;
  const ds = dsKeyOf(n.ref);
  if (!ds) return false;
  const sys = getSystem(ds.systemId);
  return !!sys && !!locateDsFact(sys.docs, ds.key);
}

/** `onDone` gets the fact's ref after the edit (an edited rule has new words, so a new ref, maybe in a copy of its system). */
export default function EditFact({ n, onDone }: { n: KnowledgeNode; onDone: (ref?: string) => void }) {
  if (n.kind === "screen-goal") return <EditScreenGoal n={n} onDone={() => onDone()} />;
  return <EditText n={n} onDone={onDone} />;
}
EditFact.canEdit = canEdit;

function EditText({ n, onDone }: { n: KnowledgeNode; onDone: (ref?: string) => void }) {
  const [text, setText] = useState(n.text);
  const save = () => {
    const words = text.trim();
    if (!words || words === n.text.trim()) return onDone();
    if (n.kind === "summary") setBrief((b) => ({ ...b, summary: words.slice(0, 2000) }));
    else if (n.kind === "answer") {
      const id = n.ref.slice(ref.answer("").length);
      setBrief((b) => ({ ...b, answers: b.answers.map((a) => (a.id === id ? { ...a, answer: words.slice(0, 600) } : a)) }));
    } else {
      const ds = dsKeyOf(n.ref)!;
      let newKey = ds.key;
      const r = editSystem(ds.systemId, `Edit ${n.label}`, (_tree, docs) => {
        const out = replaceDsFact(docs, ds.key, words);
        if ("error" in out) return out;
        newKey = out.key;
        return { docs: out.docs };
      });
      if ("error" in r) {
        feedback(r.error, { kind: "error", id: "knowledge-edit" });
        return;
      }
      // Old decisions read the old words: the edited fact says what it replaced.
      const target = getSystem(r.id);
      if (target) useSystems.getState().update(r.id, { provenance: { ...target.provenance, [newKey]: { origin: "you", at: Date.now(), ...(newKey !== ds.key ? { editedFrom: ds.key } : {}) } } });
      moveControls(n.ref, ref.ds(r.id, newKey));
      if (r.id !== ds.systemId) feedback(`Saved in a copy, ${target?.name ?? "the edited system"}${useSystems.getState().activeId === r.id ? ", now the active system" : ""}.`, { id: "knowledge-edit" });
      return onDone(ref.ds(r.id, newKey));
    }
    onDone();
  };
  return (
    <div className="flex flex-col gap-[8px]">
      <textarea
        autoFocus
        value={text}
        dir="auto"
        rows={4}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        aria-label={`Edit ${n.label}`}
        className="ds-textarea w-full resize-y"
      />
      <div className="flex gap-[6px]">
        <Button size="sm" onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function EditScreenGoal({ n, onDone }: { n: KnowledgeNode; onDone: () => void }) {
  const id = n.ref.slice(ref.screenGoal("").length);
  const cur = studio().doc.brief?.screens[id];
  const [goal, setGoal] = useState(cur?.goal ?? "");
  const [firstNotice, setFirstNotice] = useState(cur?.firstNotice ?? "");
  const [primaryAction, setPrimaryAction] = useState(cur?.primaryAction ?? "");
  const save = () => {
    const name = studio().doc.nodes[id]?.name ?? cur?.name ?? "";
    setBrief((b) => updateScreen(b, id, name, { goal: goal.trim().slice(0, 400), firstNotice: firstNotice.trim().slice(0, 400), primaryAction: primaryAction.trim().slice(0, 400) }, Date.now()));
    onDone();
  };
  const field = (label: string, v: string, set: (v: string) => void) => (
    <Field label={label}>
      <input value={v} dir="auto" onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} className="ds-input w-full" />
    </Field>
  );
  return (
    <div className="flex flex-col gap-[8px]">
      {field("Goal", goal, setGoal)}
      {field("Must be noticed first", firstNotice, setFirstNotice)}
      {field("Primary action", primaryAction, setPrimaryAction)}
      <div className="flex gap-[6px]">
        <Button size="sm" onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
