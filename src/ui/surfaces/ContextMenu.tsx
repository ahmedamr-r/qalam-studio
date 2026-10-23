import { useEffect, useMemo, useRef } from "react";
import { commandState, getCommand, runCommand, useCommand, useRegistry } from "@/commands";
import { closeContextMenu, openContextMenu, useSurfaces, type ContextMenuState } from "@/commands/surfaces";
import { commandCanvas } from "@/commands/canvas";
import { useStudio, studio } from "@/doc/store";
import { hasClipboard, pasteClipboard } from "@/doc/clipboard";
import { reparent, topLevelOf } from "@/doc/ops";
import { selectionBounds } from "@/doc/geometry";
import { isGroup } from "@/doc/group";
import { Menu, MenuItem, CommandItem, MenuSeparator, SubMenu } from "../menu";
import { QalamAIGlyph } from "../brand";
import { layerKind } from "../layerKind";
import { aiActions } from "./ai-actions";
import { isOstCard } from "@/doc/board";
import CardMenuItems from "../discovery/CardMenu";
import { activePage, canDeletePage, onComponentsPage, pagesOf } from "@/doc/pages";
import { goToPage, moveLayersToPage, newPage, removePage } from "../pages";
import { renamePageInList } from "../PagesSection";
import { pick as pickShowcase, selectedShowcase } from "../components-page/runtime";
import { openWorkspace } from "../workspace/store";
import { useSystems } from "@/design-system/registry";

/*
 * Right-click menu for the canvas and the Layers rows, in Figma's order and words. A right-click on
 * the canvas first selects what is under the pointer (unless it is already selected), like Figma;
 * on empty canvas the menu offers paste, select all, zoom and view options instead. ⌘-right-click
 * lists every layer under the pointer. Rows come from the command registry (keys as plain glyphs,
 * disabled rows say why); Ask Qalam AI is the one row with a glyph. Built on the shared menu
 * (src/ui/menu.tsx) so keyboard, submenus and collision handling match the other menus.
 */

const CANVAS = 'canvas[aria-label="Design canvas"]';


/** The canvas element and a client point in its screen space. */
function canvasPoint(x: number, y: number) {
  const el = document.querySelector<HTMLCanvasElement>(CANVAS);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: x - r.left, y: y - r.top };
}

/** Paste the clipboard on the canvas with its top-left at the clicked point (one undo step). */
function pasteHere(x: number, y: number) {
  const c = commandCanvas();
  const pt = canvasPoint(x, y);
  if (!c || !pt || !hasClipboard()) return;
  const world = c.toWorld(pt);
  const s = studio();
  s.beginTx();
  try {
    s.select([]);
    pasteClipboard();
    const ids = topLevelOf(studio().doc, studio().selection);
    // At the click point means on the canvas, not back inside the frame it was copied from.
    const nested = ids.filter((id) => studio().doc.nodes[id]?.parentId);
    if (nested.length) reparent(nested, null);
    const b = selectionBounds(studio().doc, ids);
    if (b) {
      const dx = Math.round(world.x - b.x);
      const dy = Math.round(world.y - b.y);
      studio().mutate((d) => {
        for (const id of ids) {
          d.nodes[id].x += dx;
          d.nodes[id].y += dy;
        }
      });
    }
    studio().select(ids);
  } finally {
    s.commitTx();
  }
}

/** Where a right-click landed, or null when the native menu should show (fields, text editing, chrome). */
function classify(e: MouseEvent): Omit<ContextMenuState, "x" | "y"> | null {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return null;
  if (t.closest("input, textarea, [contenteditable='true'], [contenteditable='']")) return null;
  const pageRow = t.closest<HTMLElement>("[data-page-id]");
  if (pageRow?.dataset.pageId) return { target: "page-row", layers: [], page: pageRow.dataset.pageId };
  const row = t.closest<HTMLElement>("[data-layer-id]");
  if (row?.dataset.layerId) {
    const id = row.dataset.layerId;
    const s = studio();
    if (!s.doc.nodes[id]) return null;
    if (!s.selection.includes(id)) s.select([id]);
    return { target: "layer-row", layers: [] };
  }
  if (!t.matches(CANVAS)) return null;
  const c = commandCanvas();
  if (!c) return null;
  // The rulers are chrome over the canvas: no selection change and no layer menu under them.
  const pt = canvasPoint(e.clientX, e.clientY);
  if (pt && c.onRulers(pt)) return null;
  // ⌘-right-click (Ctrl on Windows) lists the layers under the pointer without changing the selection.
  if (e.metaKey || (e.ctrlKey && !/mac/i.test(navigator.platform))) {
    const layers = pt ? c.layersAt(pt) : [];
    return layers.length ? { target: "canvas", layers, selectOnly: true } : null;
  }
  // The Components page: a component or one of its variants, as a click picks them.
  if (onComponentsPage(studio().doc)) {
    const id = pt ? pickShowcase(c.toWorld(pt)) : null;
    if (id && !studio().selection.includes(id)) studio().select([id]);
    if (!id) studio().select([]);
    return { target: id ? "canvas" : "empty", layers: [] };
  }
  const layers = c.selectAt({ x: e.clientX, y: e.clientY });
  return { target: studio().selection.length ? "canvas" : "empty", layers };
}

export default function ContextMenu() {
  const menu = useSurfaces((s) => s.contextMenu);
  const seq = useRef(0);
  const last = useRef(menu);
  // What had focus before the right-click: Esc gives it back (the menu's anchor is a hidden span).
  const before = useRef<HTMLElement | null>(null);
  if (menu && menu !== last.current) seq.current++;
  last.current = menu;

  // Right-clicks anywhere: ours on the canvas and layer rows, the browser's elsewhere.
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const hit = classify(e);
      if (!hit) return;
      e.preventDefault();
      before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openContextMenu(e.clientX, e.clientY, hit);
    };
    window.addEventListener("contextmenu", onMenu);
    return () => window.removeEventListener("contextmenu", onMenu);
  }, []);

  // Scrolling, resizing or leaving the window puts it away.
  useEffect(() => {
    if (!menu) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.target instanceof Element && e.target.closest("[data-menu-content]"))) closeContextMenu();
    };
    const away = () => closeContextMenu();
    window.addEventListener("wheel", wheel, { capture: true, passive: true });
    window.addEventListener("resize", away);
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("blur", away);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <Menu
      key={seq.current}
      open
      // Closed after the event that closed it has finished: an Esc must still reach the menu (which
      // keeps it from the canvas shortcuts) instead of an unmounted item, where it would deselect.
      onOpenChange={(o) => !o && setTimeout(closeContextMenu)}
      side="right"
      // Opens down from the click; a menu that doesn't fit slides up just enough (like macOS), keeping it near the pointer.
      align="start"
      sideOffset={2}
      label={menu.selectOnly ? "Select layer" : menu.target === "page-row" ? "Page actions" : "Layer actions"}
      checks={menu.target === "empty" || menu.selectOnly}
      className="w-[240px]"
      // Back to the field or row that had it; from the canvas (the page itself) focus stays on the page, where canvas keys work.
      restoreFocus={() => (before.current && before.current !== document.body && before.current.isConnected ? before.current : null)}
      trigger={<span aria-hidden className="block size-0" />}
      anchor={(trigger) => (
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: menu.x, top: menu.y }}>
          {trigger}
        </span>
      )}
    >
      {menu.target === "page-row" && menu.page ? (
        <PageItems page={menu.page} />
      ) : onComponentsPage(studio().doc) && !menu.selectOnly ? (
        <ComponentsPageItems at={menu} />
      ) : menu.selectOnly ? (
        <LayerList ids={menu.layers} />
      ) : menu.target === "empty" ? (
        <EmptyCanvasItems at={menu} />
      ) : (
        <SelectionItems at={menu} />
      )}
    </Menu>
  );
}

/** Layers under the pointer, top-most first; the selected ones are ticked. */
function LayerList({ ids }: { ids: string[] }) {
  const doc = useStudio((s) => s.doc);
  const selection = useStudio((s) => s.selection);
  return (
    <>
      {ids
        .filter((id) => doc.nodes[id])
        .map((id) => {
          const n = doc.nodes[id];
          const k = layerKind(n);
          return (
            <MenuItem
              key={id}
              checked={selection.includes(id)}
              icon={<k.Icon absoluteStrokeWidth strokeWidth={1.25} className={k.component ? "text-component" : undefined} />}
              onSelect={() => studio().select([id])}
            >
              {n.name || k.label}
            </MenuItem>
          );
        })}
    </>
  );
}

function PasteHere({ at }: { at: ContextMenuState }) {
  const keys = useCommand("edit.paste")?.keys[0];
  const clip = hasClipboard();
  return (
    <MenuItem disabled={clip ? false : "Copy a layer first"} shortcut={keys} onSelect={() => pasteHere(at.x, at.y)}>
      Paste here
    </MenuItem>
  );
}

/** Commands that only apply to some selections (E2c's vector ops): listed when they can run. */
function useRunnable(ids: string[]) {
  const version = useRegistry((s) => s.version);
  const doc = useStudio((s) => s.doc);
  const selection = useStudio((s) => s.selection);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ids.filter((id) => { const c = getCommand(id); return c && commandState(c) === true; }), [version, doc, selection, ids.join()]);
}

/** A command row without a check column (toggles such as "Use as mask" in a menu of actions). */
function PlainCommand({ id, label }: { id: string; label?: string }) {
  const c = useCommand(id);
  if (!c || c.unavailable) return null;
  return (
    <MenuItem shortcut={c.keys[0]} disabled={c.enabled === true ? false : c.enabled} onSelect={() => runCommand(id, "context")}>
      {label ?? c.label}
    </MenuItem>
  );
}

const BOOLEANS = ["shape.union", "shape.subtract", "shape.intersect", "shape.exclude"];
const VECTOR_OPS = ["shape.flatten", "shape.outline-stroke", "shape.mask"];

function SelectionItems({ at }: { at: ContextMenuState }) {
  const doc = useStudio((s) => s.doc);
  const selection = useStudio((s) => s.selection);
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean);
  const grouped = nodes.length > 0 && nodes.every((n) => n.type === "frame" && isGroup(n));
  const autoLayout = nodes.some((n) => n.type === "frame" && n.layout);
  const instance = nodes.some((n) => n.meta.component);
  const booleans = useRunnable(BOOLEANS);
  const vectorOps = useRunnable(VECTOR_OPS);
  const ai = aiActions(doc, selection);
  const canvas = at.target === "canvas";
  // Tree cards on a Discovery board: the tree's commands.
  if (nodes.length && nodes.every((n) => isOstCard(n))) return <CardMenuItems ai={ai} />;

  return (
    <>
      <CommandItem id="edit.copy" source="context" />
      <SubMenu label="Copy/Paste as">
        <CommandItem id="edit.copy-png" source="context" />
        <CommandItem id="edit.copy-properties" source="context" />
        <CommandItem id="edit.paste-properties" source="context" />
      </SubMenu>
      {canvas && <PasteHere at={at} />}
      <CommandItem id="edit.paste-replace" source="context" />
      <MenuSeparator />
      <CommandItem id="edit.duplicate" source="context" />
      <CommandItem id="edit.rename" source="context" />
      <MoveToPage ids={selection} />
      <MenuSeparator />
      {canvas && at.layers.length > 1 && (
        <SubMenu label="Select layer" checks>
          <LayerList ids={at.layers} />
        </SubMenu>
      )}
      <CommandItem id="select.matching" source="context" />
      <MenuSeparator />
      {grouped ? <CommandItem id="arrange.ungroup" label="Ungroup" source="context" /> : <CommandItem id="arrange.group" source="context" />}
      <CommandItem id="arrange.frame-selection" source="context" />
      {autoLayout ? <CommandItem id="autolayout.remove" source="context" /> : <CommandItem id="autolayout.add" source="context" />}
      <CommandItem id="components.create" source="context" />
      {instance && <CommandItem id="components.detach" source="context" />}
      {(vectorOps.length > 0 || booleans.length > 0) && (
        <>
          <MenuSeparator />
          {vectorOps.map((id) => (
            <PlainCommand key={id} id={id} />
          ))}
          {booleans.length > 0 && (
            <SubMenu label="Boolean groups">
              {booleans.map((id) => (
                <PlainCommand key={id} id={id} label={getCommand(id)!.label.replace(/ selection$/, "")} />
              ))}
            </SubMenu>
          )}
        </>
      )}
      <MenuSeparator />
      <CommandItem id="arrange.bring-front" source="context" />
      <CommandItem id="arrange.send-back" source="context" />
      <MenuSeparator />
      <CommandItem id="transform.flip-h" source="context" />
      <CommandItem id="transform.flip-v" source="context" />
      <CommandItem id="arrange.hide" label="Show/Hide" source="context" />
      <CommandItem id="arrange.lock" label="Lock/Unlock" source="context" />
      <MenuSeparator />
      <SubMenu label="Ask Qalam AI" icon={<QalamAIGlyph size={14} />}>
        {ai.map((a) => (
          <MenuItem key={a.id} disabled={a.enabled === true ? false : a.enabled} onSelect={a.run}>
            {a.label}
          </MenuItem>
        ))}
      </SubMenu>
      <MenuSeparator />
      <CommandItem id="edit.delete" danger source="context" />
    </>
  );
}

/** The Components page: open a component, insert it on a page, look around. Nothing that edits it. */
function ComponentsPageItems({ at }: { at: ContextMenuState }) {
  const doc = useStudio((s) => s.doc);
  const selection = useStudio((s) => s.selection);
  const picked = at.target === "canvas" ? selectedShowcase(doc, selection) : null;
  const component = picked?.meta.component;
  return (
    <>
      {component && (
        <>
          <MenuItem onSelect={() => openWorkspace("components", { component, systemId: useSystems.getState().activeId })}>Open in library</MenuItem>
          <MenuSeparator />
          <CommandItem id="edit.copy-png" source="context" />
          <CommandItem id="zoom.selection" source="context" />
          <MenuSeparator />
        </>
      )}
      <CommandItem id="zoom.fit" source="context" />
      <CommandItem id="zoom.100" source="context" />
      <CommandItem id="zoom.in" source="context" />
      <CommandItem id="zoom.out" source="context" />
      <MenuSeparator />
      <CommandItem id="view.rulers" source="context" />
      <CommandItem id="view.toggle-ui" label="Hide UI" source="context" />
      <MenuSeparator />
      <CommandItem id="essential.actions" label="Actions…" source="context" />
      <CommandItem id="essential.shortcuts" source="context" />
    </>
  );
}

/** A page in the Pages list: rename or delete it (a project keeps one page at least). */
function PageItems({ page }: { page: string }) {
  const doc = useStudio((s) => s.doc);
  const del = canDeletePage(doc, page);
  return (
    <>
      <MenuItem onSelect={() => goToPage(page)}>Go to page</MenuItem>
      <MenuItem onSelect={() => renamePageInList(page)}>Rename page</MenuItem>
      <MenuItem onSelect={() => void newPage()}>Add page</MenuItem>
      <MenuSeparator />
      <MenuItem danger disabled={del === true ? false : del} onSelect={() => removePage(page)}>
        Delete page
      </MenuItem>
    </>
  );
}

/** "Move to page ▸" for top-level layers, when the project has another page to move them to. */
function MoveToPage({ ids }: { ids: string[] }) {
  const doc = useStudio((s) => s.doc);
  if (onComponentsPage(doc)) return null;
  const top = ids.filter((id) => doc.nodes[id] && !doc.nodes[id].parentId);
  const here = activePage(doc);
  const others = pagesOf(doc).filter((p) => p.id !== here);
  if (!others.length || !top.length || top.length !== ids.length)
    return <MenuItem disabled={!others.length ? "Add another page first" : "Select top-level layers to move"} onSelect={() => {}}>Move to page</MenuItem>;
  return (
    <SubMenu label="Move to page">
      {others.map((p) => (
        <MenuItem key={p.id} onSelect={() => moveLayersToPage(top, p.id)}>
          {p.name}
        </MenuItem>
      ))}
    </SubMenu>
  );
}

function EmptyCanvasItems({ at }: { at: ContextMenuState }) {
  return (
    <>
      <PasteHere at={at} />
      <MenuSeparator />
      <CommandItem id="select.all" source="context" />
      <MenuSeparator />
      <CommandItem id="zoom.fit" source="context" />
      <CommandItem id="zoom.100" source="context" />
      <CommandItem id="zoom.in" source="context" />
      <CommandItem id="zoom.out" source="context" />
      <MenuSeparator />
      <CommandItem id="view.rulers" source="context" />
      <CommandItem id="view.outlines" source="context" />
      <CommandItem id="view.pixel-grid" source="context" />
      <CommandItem id="view.layout-grids" source="context" />
      <CommandItem id="view.toggle-ui" label="Hide UI" source="context" />
      <MenuSeparator />
      <CommandItem id="essential.actions" label="Actions…" source="context" />
      <CommandItem id="essential.shortcuts" source="context" />
    </>
  );
}
