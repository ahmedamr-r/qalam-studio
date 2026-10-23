import { designSystemFromInterview } from "@/design-system/interview/expand";
import { keystoneFor, keystoneSpec } from "@/design-system/interview/keystones";
import type { Scenario } from "@/design-system/interview/scenarios";
import { buildScreenNodes, ensureSystemFonts } from "@/design-system/place";
import { flushSystems, getSystem, useSystems } from "@/design-system/registry";
import type { Doc } from "@/doc/schema";
import { ensureYoga } from "@/engine/layout";
import { projectsDb } from "@/projects/db";
import { screenPNG } from "../componentPreviews";
import { promptDialog } from "../surfaces/dialog";
import { busy, interview, renameTo, saveProject, update } from "./store";
import { scenariosFor } from "./previewCache";

/**
 * Save the interview as a design system. The first save also lays the preview screens out on the
 * project's canvas, bound to the new system (so they restyle as its tokens are edited); saving
 * again from "Refine with the interview" updates the same system and leaves the canvas alone.
 */
export async function saveInterview(name: string): Promise<void> {
  const { project, state } = interview();
  if (!project || !state.knobs || !state.read) return;
  const existing = project.systemId ? getSystem(project.systemId) : undefined;
  const ds = designSystemFromInterview({ knobs: state.knobs, read: state.read, name, projectId: project.id, ...(existing && existing.source !== "builtin" ? { id: existing.id } : {}) });
  const systems = useSystems.getState();
  if (existing && existing.source !== "builtin") systems.update(ds.id, { name: ds.name, tree: ds.tree, docs: ds.docs, fonts: ds.fonts, notes: ds.notes });
  else systems.add(ds, false);
  flushSystems();

  const list = scenariosFor(state.read);
  // The canvas gets the keystone too: the piece the components were shaped around.
  const keystone: Scenario = { id: "keystone", label: keystoneFor(state.read.domain).name, spec: keystoneSpec(state.read) };
  if (!existing) await projectsDb.putDoc(project.id, await specimenDoc([...list.slice(0, 1), keystone, ...list.slice(1)], ds.id));
  const hero = list.find((s) => s.id === "hero");
  const thumb = hero ? await screenPNG(hero.spec, ds, 320).catch(() => null) : null;

  renameTo(name);
  update((s) => ({ ...s, stage: "saved" }));
  await saveProject({ systemId: ds.id, ...(thumb ? { thumbnail: `data:image/png;base64,${thumb.data}` } : {}) });
  // Reopen the project: now it shows its system in the studio.
  window.location.reload();
}

/** Ask for a name, then save. */
export async function promptAndSave() {
  const { project, state } = interview();
  const name = await promptDialog({
    title: "Save your design system",
    label: "Name",
    defaultValue: project?.name && project.name !== "Untitled system" ? project.name : (state.read?.slots.brand ?? "My system"),
    confirmLabel: "Save",
    validate: (v) => (v.trim() ? null : "Give it a name"),
  });
  if (name) await busy("Saving your system", () => saveInterview(name));
}

/** The preview screens side by side, built with the saved system. */
async function specimenDoc(list: Scenario[], dsId: string): Promise<Doc> {
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  const doc: Doc = { nodes: {}, roots: [] };
  let x = 0;
  for (const s of list) {
    const nodes = buildScreenNodes(s.spec, dsId, { x, y: 0 }, "user");
    for (const n of nodes) doc.nodes[n.id] = n;
    doc.roots.push(nodes[0].id);
    x += nodes[0].w + 120;
  }
  return doc;
}
