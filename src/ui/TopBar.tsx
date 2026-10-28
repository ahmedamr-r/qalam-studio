import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Play, Redo2, Undo2 } from "lucide-react";
import { useStudio, studio } from "@/doc/store";
import { activePage, clearPage, onComponentsPage, pageName } from "@/doc/pages";
import { emptyDoc } from "@/doc/schema";
import { useActiveSystem } from "@/design-system/registry";
import { runCommand, useCommand } from "@/commands/registry";
import { Button, IconBtn, Tip } from "./controls";
import { getController } from "./CanvasView";
import { Menu, MenuItem, CommandItem, MenuSeparator, SubMenu } from "./menu";
import { r } from "./recipes";
import { QalamAIGlyph, QalamMark, Wordmark } from "./brand";
import { confirmDialog } from "./surfaces/dialog";
import { usePreviewedDraft } from "./ai/extractChat";
import Presence from "./ai/Presence";
import { loadDemo } from "./demo";
import { goHome, renameProject, reopenInterview, useProject } from "@/projects/session";
import { currentOrg } from "@/org/client";
import { promptDialog } from "./surfaces/dialog";
import { useProjectType } from "@/projects/mode";
import { allCards } from "@/discovery/tree";

/*
 * The top bar (design/spec.md §6 Shell): the saffron mark in the rail-axis cell, "Qalam Studio ⌄"
 * (the main menu: File / Edit / View / Object / Text / Arrange / Vector built from the commands
 * registry, theme, help), the design system and screen you are in, then who's working, undo/redo,
 * zoom, Export and Generate, the one saffron fill in the view. Every shortcut shown comes from the
 * registry; commands Qalam can't do are left out of the menus.
 */

const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function TopBar() {
  // A Discovery board has no Generate (no saffron there): Qalam AI works from its cards.
  const board = useProjectType() === "discovery";
  const canUndo = useCommand("edit.undo")?.enabled === true;
  const canRedo = useCommand("edit.redo")?.enabled === true;
  return (
    <header className={clsx(r.topBar, "min-w-0 flex-1")} data-region="topbar">
      <div className={r.brandCell}>
        <QalamMark size={20} />
      </div>
      <MainMenu />
      <Crumbs />
      <div className={r.topRight}>
        {/* Brings its own separator, and steps aside while you are alone in the file. */}
        <Presence />
        <IconBtn label="Undo" command="edit.undo" disabled={!canUndo} onClick={() => runCommand("edit.undo", "toolbar")}>
          <Undo2 {...ICON} />
        </IconBtn>
        <IconBtn label="Redo" command="edit.redo" disabled={!canRedo} onClick={() => runCommand("edit.redo", "toolbar")}>
          <Redo2 {...ICON} />
        </IconBtn>
        <ZoomMenu />
        <span aria-hidden className={r.vsep} />
        {!board && (
          <IconBtn label="Present prototype" command="prototype.present" onClick={() => runCommand("prototype.present", "toolbar")}>
            <Play {...ICON} />
          </IconBtn>
        )}
        <ExportMenu />
        {!board && (
          <Tip label="Generate screens with Qalam AI">
            <Button variant="brand" className="ml-[6px]" onClick={() => runCommand("ai.generate", "toolbar")}>
              <QalamAIGlyph size={14} tone="ink" />
              Generate
            </Button>
          </Tip>
        )}
      </div>
    </header>
  );
}

// ── Main menu ────────────────────────────────────────────────────────────────

function MainMenu() {
  const board = useProjectType() === "discovery";
  const name = useProject((s) => s.project?.name);
  return (
    <Menu
      label="Main menu"
      sideOffset={8}
      alignOffset={-4}
      className="w-[240px]"
      trigger={
        <button type="button" aria-label="Main menu" className={clsx(r.mainMenuTrigger, "aria-expanded:bg-active")}>
          {board && name ? <span className="max-w-[220px] truncate text-body font-medium text-fg">{name}</span> : <Wordmark />}
          <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
        </button>
      }
    >
      <CommandItem id="essential.actions" />
      <MenuSeparator />
      <SubMenu label="File">
        <FileItems />
      </SubMenu>
      <SubMenu label="Edit">
        <EditItems />
      </SubMenu>
      <SubMenu label="View" checks>
        <ViewItems />
      </SubMenu>
      {!board && (
        <>
          <SubMenu label="Object">
            <ObjectItems />
          </SubMenu>
          <SubMenu label="Text" checks>
            <TextItems />
          </SubMenu>
          <SubMenu label="Arrange">
            <ArrangeItems />
          </SubMenu>
          <SubMenu label="Vector">
            <VectorItems />
          </SubMenu>
        </>
      )}
      <MenuSeparator />
      <SubMenu label="Theme" checks>
        <CommandItem id="view.theme-dark" />
        <CommandItem id="view.theme-light" />
        <CommandItem id="view.theme-system" />
      </SubMenu>
      <SubMenu label="Help">
        <CommandItem id="essential.shortcuts" />
        <CommandItem id="essential.actions" label="Search actions" />
        <CommandItem id="tool.focus-toolbar" />
        <MenuSeparator />
        <MenuItem onSelect={() => void showAbout()}>About Qalam Studio</MenuItem>
      </SubMenu>
    </Menu>
  );
}

function FileItems() {
  const board = useProjectType() === "discovery";
  return (
    <>
      <MenuItem onSelect={() => void goHome()}>{board ? "Back home" : "Back to projects"}</MenuItem>
      <MenuItem onSelect={() => void askRename()}>{board ? "Rename the board…" : "Rename project…"}</MenuItem>
      {useProject.getState().project?.interview?.stage === "saved" && <MenuItem onSelect={() => void refineInterview()}>Refine with the interview…</MenuItem>}
      <MenuSeparator />
      {!board && <MenuItem onSelect={() => void loadDemo()}>Load demo screens</MenuItem>}
      <CommandItem id="file.open" />
      <CommandItem id="tool.place-image" />
      <MenuSeparator />
      <CommandItem id="edit.export" />
      <CommandItem id="edit.copy-png" />
      <CommandItem id="file.export-json" />
      <MenuSeparator />
      <MenuItem danger onSelect={() => void clearCanvas()}>
        Clear canvas…
      </MenuItem>
    </>
  );
}

async function refineInterview() {
  const ok = await confirmDialog({
    title: "Refine with the interview?",
    body: "You go back to the brand interview where you left it. Saving there again replaces token edits made here since.",
    confirmLabel: "Open the interview",
  });
  if (ok) await reopenInterview();
}

async function askRename() {
  const name = await promptDialog({
    title: useProject.getState().project?.type === "discovery" ? "Rename the board" : "Rename project",
    defaultValue: useProject.getState().project?.name ?? "",
    confirmLabel: "Rename",
    validate: (v) => (v.trim() ? null : "Name can't be empty"),
  });
  if (name) renameProject(name);
}

/** About the project; the status line carries the short version. */
async function showAbout() {
  await confirmDialog({
    title: "About Qalam Studio",
    body: "An open-source, Arabic-first AI design studio, in early preview. Licensed under Apache-2.0.",
    confirmLabel: "Done",
    cancelLabel: null,
  });
}

async function clearCanvas() {
  // With pages, only the page showing is cleared.
  const paged = (studio().doc.pages?.length ?? 0) > 1;
  const ok = await confirmDialog({
    title: paged ? `Clear ${pageName(studio().doc, activePage(studio().doc))}?` : "Clear the whole canvas?",
    body: paged ? "Every screen and layer on this page is removed. Other pages stay. You can undo this, and the Knowledge hub is kept." : "Every screen and layer is removed. You can undo this, and the Knowledge hub is kept.",
    confirmLabel: paged ? "Clear page" : "Clear canvas",
    danger: true,
  });
  if (!ok) return;
  if (studio().doc.pages?.length) {
    const s = studio();
    s.mutate(() => clearPage(s.doc));
    s.select([]);
  } else studio().replaceDoc(emptyDoc());
}

function EditItems() {
  return (
    <>
      <CommandItem id="edit.undo" />
      <CommandItem id="edit.redo" />
      <MenuSeparator />
      <CommandItem id="edit.copy" />
      <CommandItem id="edit.cut" />
      <CommandItem id="edit.paste" />
      <CommandItem id="edit.paste-over" />
      <CommandItem id="edit.paste-replace" />
      <CommandItem id="edit.duplicate" />
      <CommandItem id="edit.delete" />
      <MenuSeparator />
      <CommandItem id="edit.copy-properties" />
      <CommandItem id="edit.paste-properties" />
      <CommandItem id="tool.eyedropper" />
      <MenuSeparator />
      <CommandItem id="select.all" />
      <CommandItem id="select.inverse" />
      <CommandItem id="select.matching" />
      <CommandItem id="edit.rename" />
      <CommandItem id="edit.find" />
    </>
  );
}

function ViewItems() {
  return (
    <>
      <CommandItem id="view.rulers" />
      <CommandItem id="view.outlines" />
      <CommandItem id="view.layout-grids" />
      <CommandItem id="view.pixel-grid" />
      <CommandItem id="view.pixel-preview" />
      <CommandItem id="view.snap-pixels" />
      <CommandItem id="view.agent-cursors" />
      <CommandItem id="view.route-parts" />
      <MenuSeparator />
      <CommandItem id="view.toggle-ui" />
      <CommandItem id="view.minimize-ui" />
      <CommandItem id="view.collapse-layers" />
      <MenuSeparator />
      <CommandItem id="panels.layers" />
      <CommandItem id="panels.assets" />
      <CommandItem id="panels.tokens" />
      <CommandItem id="panels.knowledge" />
      <CommandItem id="panels.design" />
      <CommandItem id="panels.prototype" />
      <MenuSeparator />
      <CommandItem id="zoom.in" />
      <CommandItem id="zoom.out" />
      <CommandItem id="zoom.100" />
      <CommandItem id="zoom.fit" />
      <CommandItem id="zoom.selection" />
      <CommandItem id="zoom.prev-frame" />
      <CommandItem id="zoom.next-frame" />
    </>
  );
}

function ObjectItems() {
  return (
    <>
      <CommandItem id="arrange.group" />
      <CommandItem id="arrange.ungroup" />
      <CommandItem id="arrange.frame-selection" />
      <MenuSeparator />
      <CommandItem id="autolayout.add" />
      <CommandItem id="autolayout.remove" />
      <CommandItem id="arrange.resize-to-fit" />
      <MenuSeparator />
      <CommandItem id="components.create" />
      <CommandItem id="components.detach" />
      <MenuSeparator />
      <CommandItem id="transform.flip-h" />
      <CommandItem id="transform.flip-v" />
      <CommandItem id="transform.rotate" />
      <MenuSeparator />
      <CommandItem id="shape.remove-fill" />
      <CommandItem id="shape.remove-stroke" />
      <CommandItem id="shape.swap-fill-stroke" />
      <MenuSeparator />
      <CommandItem id="arrange.hide" />
      <CommandItem id="arrange.lock" />
    </>
  );
}

function TextItems() {
  return (
    <>
      <CommandItem id="text.bold" />
      <CommandItem id="text.italic" />
      <CommandItem id="text.underline" />
      <CommandItem id="text.strikethrough" />
      <MenuSeparator />
      <CommandItem id="text.align-left" />
      <CommandItem id="text.align-center" />
      <CommandItem id="text.align-right" />
      <CommandItem id="text.align-justify" />
      <MenuSeparator />
      <CommandItem id="text.bulleted-list" />
      <CommandItem id="text.numbered-list" />
      <MenuSeparator />
      <CommandItem id="text.size-up" />
      <CommandItem id="text.size-down" />
      <CommandItem id="text.weight-up" />
      <CommandItem id="text.weight-down" />
      <CommandItem id="text.line-height-up" />
      <CommandItem id="text.line-height-down" />
      <CommandItem id="text.letter-spacing-up" />
      <CommandItem id="text.letter-spacing-down" />
    </>
  );
}

function ArrangeItems() {
  return (
    <>
      <CommandItem id="arrange.bring-front" />
      <CommandItem id="arrange.bring-forward" />
      <CommandItem id="arrange.send-backward" />
      <CommandItem id="arrange.send-back" />
      <MenuSeparator />
      <CommandItem id="arrange.align-left" />
      <CommandItem id="arrange.align-hcenter" />
      <CommandItem id="arrange.align-right" />
      <CommandItem id="arrange.align-top" />
      <CommandItem id="arrange.align-vcenter" />
      <CommandItem id="arrange.align-bottom" />
      <MenuSeparator />
      <CommandItem id="arrange.distribute-h" />
      <CommandItem id="arrange.distribute-v" />
      <CommandItem id="arrange.tidy-up" />
    </>
  );
}

function VectorItems() {
  return (
    <>
      <CommandItem id="vector.edit" />
      <CommandItem id="tool.pen" />
      <CommandItem id="tool.pencil" />
      <MenuSeparator />
      <CommandItem id="shape.union" />
      <CommandItem id="shape.subtract" />
      <CommandItem id="shape.intersect" />
      <CommandItem id="shape.exclude" />
      <CommandItem id="shape.flatten" />
      <CommandItem id="shape.outline-stroke" />
      <CommandItem id="shape.mask" />
    </>
  );
}

// ── Where you are ────────────────────────────────────────────────────────────

/** The active design system (opens Tokens) and the screen the selection is on (zooms to it). */
function Crumbs() {
  const system = useActiveSystem();
  const draft = usePreviewedDraft();
  const screens = useStudio((s) => s.doc.roots.length);
  const onComponents = useStudio((s) => onComponentsPage(s.doc));
  const screen = useStudio((s) => {
    const id = s.selection[0];
    let n = id ? s.doc.nodes[id] : undefined;
    while (n?.parentId) n = s.doc.nodes[n.parentId];
    return n ? `${n.id}\u0000${n.name}` : null;
  });
  const [screenId, screenName] = screen ? screen.split("\u0000") : [null, null];
  const tokens = useCommand("panels.tokens");
  const project = useProject((s) => s.project?.name);
  const board = useProjectType() === "discovery";
  const cards = useStudio((s) => (board ? allCards(s.doc).length : 0));
  const [org, setOrg] = useState<string | null>(null);
  useEffect(() => void currentOrg().then((o) => setOrg(o.name), () => {}), []);
  return (
    <nav aria-label="Location" className={clsx(r.crumbs, "max-[1180px]:hidden")}>
      <Tip label={org ? `Back to ${org}` : "Back to projects"} side="bottom">
        <button type="button" onClick={() => void goHome()} className="q-item inline-flex h-[28px] max-w-[160px] items-center rounded-md px-[6px] hover:bg-hover hover:text-fg-muted">
          <span className="truncate">{org ?? "Projects"}</span>
        </button>
      </Tip>
      <span aria-hidden className={clsx(r.crumbSep, "-mx-[2px]")}>
        /
      </span>
      {project && !board && (
        <>
          <Tip label="Rename project" side="bottom">
            <button type="button" onClick={() => void askRename()} className="q-item inline-flex h-[28px] max-w-[200px] items-center rounded-md px-[6px] hover:bg-hover hover:text-fg-muted">
              <span className="truncate">{project}</span>
            </button>
          </Tip>
          <span aria-hidden className={clsx(r.crumbSep, "-mx-[2px]")}>
            /
          </span>
        </>
      )}
      {board ? (
        <span className="px-[6px] font-medium text-fg tnum">
          {cards} {cards === 1 ? "card" : "cards"}
        </span>
      ) : (
        <>
          <Tip label={`Open ${draft ? "the draft" : system.name} in Tokens`} keys={tokens?.keys[0]} side="bottom">
            <button type="button" onClick={() => runCommand("panels.tokens", "toolbar")} className="q-item inline-flex h-[28px] items-center rounded-md px-[6px] hover:bg-hover hover:text-fg-muted">
              {draft ? draft.draft.name : system.name}
            </button>
          </Tip>
          <span aria-hidden className={clsx(r.crumbSep, "-mx-[2px]")}>
            /
          </span>
          {screenId ? (
            <Tip label="Zoom to this screen" side="bottom">
              <button type="button" onClick={() => getController()?.glideToFit([screenId])} className={clsx(r.crumbFile, "pr-[6px]")}>
                <span className="max-w-[240px] truncate">{screenName}</span>
              </button>
            </Tip>
          ) : (
            <span className="px-[6px] font-medium text-fg tnum">{onComponents ? "Components" : `${screens} ${screens === 1 ? "screen" : "screens"}`}</span>
          )}
          {draft && <span className={r.draftChip}>Draft</span>}
        </>
      )}
    </nav>
  );
}

// ── Zoom and export ──────────────────────────────────────────────────────────

function ZoomMenu() {
  const zoom = useStudio((s) => s.camera.zoom);
  return (
    <Menu
      label="Zoom"
      align="end"
      checks
      className="w-[232px]"
      trigger={
        <button type="button" aria-label={`Zoom ${Math.round(zoom * 100)}%`} className={clsx(r.zoomTrigger, "aria-expanded:bg-active")}>
          <span className="min-w-[30px] text-right">{Math.round(zoom * 100)}%</span>
          <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron text-fg-subtle" />
        </button>
      }
    >
      <CommandItem id="zoom.in" />
      <CommandItem id="zoom.out" />
      <CommandItem id="zoom.fit" />
      <CommandItem id="zoom.selection" />
      <MenuSeparator />
      {[0.5, 1, 2].map((z) => (
        <ZoomTo key={z} zoom={z} />
      ))}
      <MenuSeparator />
      <CommandItem id="view.pixel-preview" />
      <CommandItem id="view.pixel-grid" />
      <CommandItem id="view.snap-pixels" />
      <CommandItem id="view.layout-grids" />
      <CommandItem id="view.rulers" />
      <CommandItem id="view.outlines" />
    </Menu>
  );
}

/** Fixed zoom levels; 100% is the registered command (with its keys), the others have none. */
function ZoomTo({ zoom }: { zoom: number }) {
  if (zoom === 1) return <CommandItem id="zoom.100" />;
  return <MenuItem onSelect={() => getController()?.zoomKeyTo(zoom)}>Zoom to {zoom * 100}%</MenuItem>;
}

function ExportMenu() {
  return (
    <Menu
      label="Export"
      align="end"
      className="w-[248px]"
      trigger={
        <button type="button" className={clsx(r.button, r.buttonSecondary, "data-[state=open]:bg-elevated")}>
          Export
        </button>
      }
    >
      <CommandItem id="edit.export" />
      <CommandItem id="edit.copy-png" />
      <MenuSeparator />
      <CommandItem id="file.export-json" />
      <CommandItem id="prototype.present" label="Prototype as React + Motion…" />
    </Menu>
  );
}
