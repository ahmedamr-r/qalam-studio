import { useEffect, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { worldBounds } from "@/doc/geometry";
import { cardOf, updateCardIn } from "@/discovery/ops";
import { buildHandoff } from "@/discovery/handoff";
import type { DesignHandoff } from "@/discovery/types";
import { projectHref, type Project } from "@/projects/model";
import { createProject, currentProject, flushDoc } from "@/projects/session";
import { listProjects } from "@/projects/library";
import { projectsDb } from "@/projects/db";
import { useSystems } from "@/design-system/registry";
import { feedback } from "@/commands/feedback";
import { Button, Checkbox, IconBtn, Select } from "../controls";
import { r } from "../recipes";
import { placeCard } from "../ai/anchor";
import { qr } from "../ai/Questionnaire";
import { useDiscovery } from "./store";
import { EvidenceList, Lineage, RiskiestAssumptions } from "./Lineage";

const W = 360;
/** The tallest it gets; on a short board it's shorter, and its middle scrolls. */
const MAX_H = 560;

/**
 * "Design this" on a solution: where to design it (a new Screens project, or one you have), and
 * what goes along. The Screens project opens with Qalam AI already planning the screens with this
 * context (Plan first); its Knowledge hub is seeded so critiques judge the screens against the need.
 */
export default function DesignThis({ vp }: { vp: { w: number; h: number } }) {
  const id = useDiscovery((s) => s.designFor);
  const node = useStudio((s) => (id ? s.doc.nodes[id] : undefined));
  const cam = useStudio((s) => s.camera);
  if (!id || !node) return null;
  const card = cardOf(studio().doc, id);
  if (!card || card.kind !== "solution") return null;
  const h = Math.min(MAX_H, vp.h - 16);
  const at = placeCard(worldBounds(studio().doc, id), cam, vp, { w: W, h });
  return (
    <div className="pointer-events-auto absolute flex flex-col" style={{ left: at.left, top: at.top, width: W, maxHeight: h }}>
      <Card id={id} key={id} />
    </div>
  );
}

function Card({ id }: { id: string }) {
  const project = currentProject();
  const [h, setH] = useState<DesignHandoff | null>(() => (project ? buildHandoff(studio().doc, id, { projectId: project.id, projectName: project.name }) : null));
  const [screens, setScreens] = useState<Project[]>([]);
  const [target, setTarget] = useState<string>("new");
  const [name, setName] = useState(() => h?.solution.title ?? "");
  const [prompt, setPrompt] = useState(() => h?.prompt ?? "");
  const [newTab, setNewTab] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => useDiscovery.setState({ designFor: null });

  useEffect(() => {
    void listProjects().then((list) => setScreens(list.filter((p) => p.type === "screens")));
  }, []);
  useEffect(() => {
    if (project) setH(buildHandoff(studio().doc, id, { projectId: project.id, projectName: project.name }));
  }, [id, project]);

  if (!h || !project) return null;

  const go = async () => {
    setBusy(true);
    const handoff: DesignHandoff = { ...h, prompt: prompt.trim() || h.prompt, at: Date.now() };
    try {
      let dest: Project;
      if (target === "new") {
        dest = await createProject("screens", name.trim() || h.solution.title || "Untitled", { handoff, systemId: useSystems.getState().activeId });
      } else {
        // Read the record fresh and write only the hand-off: the project's own tab owns the rest.
        const fresh = await projectsDb.get(target);
        if (!fresh) throw new Error("That project isn't in this browser any more.");
        dest = { ...fresh, handoff };
        await projectsDb.put(dest);
      }
      studio().mutate((d) => updateCardIn(d, id, (c) => void (c.designs = [...(c.designs ?? []).filter((x) => x.projectId !== dest.id), { projectId: dest.id, at: Date.now() }])));
      close();
      await flushDoc();
      if (newTab) {
        window.open(projectHref(dest), "_blank", "noopener");
        feedback(`Opened ${dest.name} in a new tab`, { id: "discovery.design" });
      } else window.location.assign(projectHref(dest));
    } catch (e) {
      feedback(`Couldn't send it to design: ${e instanceof Error ? e.message : String(e)}`, { kind: "error", id: "discovery.design" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label="Design this" className="q-pop flex min-h-0 flex-col overflow-hidden rounded-xl bg-raised shadow-floating">
      <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line-subtle pr-[8px] pl-[14px]">
        <h2 className="flex-1 text-body font-semibold">Design this</h2>
        <IconBtn size="sm" label="Close" onClick={close}>
          <X size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      </div>
      <div className="flex min-h-0 flex-col gap-[14px] overflow-y-auto p-[14px]">
        <Lineage h={h} />

        <div role="radiogroup" aria-label="Where to design it" className="flex flex-col gap-[6px]">
          <span className="text-micro text-fg-subtle">Where</span>
          <Choice on={target === "new"} onPick={() => setTarget("new")} label="A new Screens project" />
          {target === "new" && (
            <div className={r.field}>
              <input aria-label="Project name" className={r.fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <Choice on={target !== "new"} disabled={!screens.length} onPick={() => screens[0] && setTarget(screens[0].id)} label={screens.length ? "A Screens project you have" : "No Screens projects yet"} />
          {target !== "new" && <Select ariaLabel="Screens project" value={target} options={screens.map((p) => ({ value: p.id, label: p.name }))} onChange={setTarget} />}
        </div>

        <div className="flex flex-col gap-[6px]">
          <span className="text-micro text-fg-subtle">What Qalam AI is asked</span>
          <textarea aria-label="Request" className={clsx(r.textarea, "text-body")} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <p className="text-caption text-fg-muted">It plans first: a few questions about the screens, with what's below as context.</p>
        </div>

        <EvidenceList evidence={h.evidence} />
        <RiskiestAssumptions assumptions={h.assumptions} />
        <Checkbox checked={newTab} onChange={setNewTab} label="Open in a new tab" />
      </div>
      <div className="flex shrink-0 justify-end gap-[8px] border-t border-line-subtle px-[14px] py-[10px]">
        <Button size="sm" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void go()}>
          Design it
        </Button>
      </div>
    </div>
  );
}

function Choice({ on, label, onPick, disabled }: { on: boolean; label: string; onPick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onPick} className={clsx(qr.option, on ? qr.optionSelected : qr.optionIdle, "items-center py-[6px] disabled:opacity-50")}>
      <span className={clsx(qr.radio, "mt-0", on && qr.radioOn)}>{on && <span className={qr.radioDot} />}</span>
      <span className="text-caption text-fg">{label}</span>
    </button>
  );
}
