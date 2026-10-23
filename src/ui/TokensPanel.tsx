import { useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Download, ImagePlus, Maximize2, Pencil, Square, Trash2 } from "lucide-react";
import { TokenSet } from "@/design-system/resolve";
import { BUILTIN_ID, sourceLabel, systemFor, tokenSetFor, useActiveSystem, useSystems, type DesignSystem } from "@/design-system/registry";
import { isListed } from "@/design-system/freeform";
import { docsMarkdown } from "@/design-system/docs";
import { applyDesignSystem, canRebuild, isEdited, rootsOf, type ApplyMode } from "@/design-system/apply";
import { useStudio } from "@/doc/store";
import { AIError } from "@/ai/client";
import { Button, CommandKbd, Hint, IconBtn, Segmented } from "./controls";
import { r } from "./recipes";
import { useSlidingIndicator } from "./motion";
import { QalamAIGlyph } from "./brand/ai-glyph";
import { confirmDialog } from "./surfaces/dialog";
import { download } from "./exporter";
import { restyleSelection, type RestyleOutcome } from "./systems";
import { MAX_EXTRACT_IMAGES } from "@/design-system/extract-options";
import { startExtractChat, usePreviewedDraft } from "./ai/extractChat";
import { DraftBanner } from "./tokens/DraftBanner";
import { ErrorNote, Progress } from "./ai/common";
import { ColorView, ContrastView, EffectsView, LanguageView, LayoutView, ShapeView, TypeView } from "./tokens/views";
import { openWorkspace } from "./workspace/store";
import { editSystem } from "./workspace/editing";
import { IconGlyph } from "./IconPicker";
import { createProject, goToProject } from "@/projects/session";
import { ICON_SETS, ICON_SET_EXTENSION, ICON_SET_IDS, resolveIconIn, type IconSet } from "@/design-system/icons";

/** A design-system project that starts with the brand interview (it opens in place of this one). */
async function newSystemProject() {
  await goToProject(await createProject("system", "Untitled system"));
}


type View = "color" | "type" | "shape" | "effects" | "language" | "layout" | "contrast";
const VIEWS: { value: View; label: string }[] = [
  { value: "color", label: "Colour" },
  { value: "type", label: "Type" },
  { value: "shape", label: "Shape" },
  { value: "effects", label: "Effects" },
  { value: "language", label: "Language" },
  { value: "layout", label: "Layout" },
  { value: "contrast", label: "Contrast" },
];

const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
/** A panel section: hairline below, text aligned with the panel title. */
const section = "flex flex-col gap-[8px] border-b border-line-subtle px-[16px] pt-[4px] pb-[14px]";

function SectionHeader({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className={clsx(r.sectionHeader, "-mb-[2px]")}>
      <h3 className={r.sectionTitle}>{title}</h3>
      {aside}
    </div>
  );
}

export default function TokensPanel() {
  const active = useActiveSystem();
  const draft = usePreviewedDraft()?.draft ?? null;
  const shown = draft ?? active;
  const ts = useMemo(() => (draft ? new TokenSet(draft.tree) : tokenSetFor(active.id)), [draft, active]);
  const [view, setView] = useState<View>("color");

  return (
    <div className="flex flex-col">
      <SystemHeader active={active} editable={!draft} />
      <DraftBanner />
      {!draft && <ApplyCard ds={active} />}
      {!draft && <IconSetCard ds={active} set={ts.iconSet} />}
      <ViewTabs view={view} onChange={setView} />
      {/* A view switch: the new view rises in, the old one is gone at once. */}
      <div key={view} className="q-rise">
        {view === "color" && <ColorView ts={ts} />}
        {view === "type" && <TypeView ts={ts} />}
        {view === "shape" && <ShapeView ts={ts} />}
        {view === "effects" && <EffectsView ts={ts} />}
        {view === "language" && <LanguageView docs={shown.docs} />}
        {view === "layout" && <LayoutView docs={shown.docs} />}
        {view === "contrast" && <ContrastView ts={ts} />}
      </div>
      <div className="mt-auto flex flex-col gap-[8px] border-t border-line-subtle px-[16px] pt-[4px] pb-[16px]">
        <SectionHeader title="Export" aside={<span className="text-micro text-fg-subtle">{shown.name}</span>} />
        <div className="flex flex-wrap gap-[6px]">
          <Button size="sm" variant="secondary" onClick={() => download(`${slug(shown.name)}.tokens.json`, JSON.stringify(dtcg(shown), null, 2), "application/json")}>
            <Download size={14} {...icon} /> DTCG JSON
          </Button>
          <Button size="sm" variant="secondary" onClick={() => download(`${slug(shown.name)}.css`, toCSS(ts), "text/css")}>
            <Download size={14} {...icon} /> CSS vars
          </Button>
          <Button size="sm" variant="secondary" onClick={() => download(`${slug(shown.name)}.design.md`, docsMarkdown(shown.name, shown.docs), "text/markdown")}>
            <Download size={14} {...icon} /> design.md
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The view switcher: text tabs with one neutral pill that glides to the picked view (two rows when narrow). */
function ViewTabs({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement, HTMLSpanElement>(view);
  return (
    <div className="sticky top-0 z-[2] border-b border-line-subtle bg-panel px-[12px] py-[8px]">
      <div ref={containerRef} className="relative flex flex-wrap gap-[2px]" role="tablist" aria-label="Token views">
        <span ref={indicatorRef} aria-hidden className="q-indicator rounded-md bg-active data-[hidden]:opacity-0" />
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            data-indicator-active={view === v.value || undefined}
            onClick={() => onChange(v.value)}
            className="q-press q-item relative z-[1] h-[26px] rounded-md px-[8px] text-caption font-medium text-fg-subtle hover:text-fg-muted aria-selected:text-fg"
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design-system";

/** DTCG export; the written system rides along in $extensions (next to the tree's own, such as its icon set). */
function dtcg(ds: DesignSystem) {
  const own = (ds.tree.$extensions as Record<string, unknown> | undefined) ?? {};
  return { ...ds.tree, $extensions: { ...own, "qalam.design-system": { name: ds.name, source: ds.source, fonts: ds.fonts, docs: ds.docs } } };
}

const ICON_PREVIEW = ["house", "search", "bell", "user", "settings", "heart", "map-pin", "calendar", "trash", "x"];

/** The system's icon set: every icon a screen built with it names is drawn from this library. */
function IconSetCard({ ds, set }: { ds: DesignSystem; set: IconSet }) {
  const [error, setError] = useState<string | null>(null);
  const pick = (next: IconSet) => {
    if (next === set) return;
    setError(null);
    const r = editSystem(ds.id, `Icon set: ${ICON_SETS[next].label}`, (tree) => ({ tree: { ...tree, $extensions: { ...((tree.$extensions as Record<string, unknown> | undefined) ?? {}), [ICON_SET_EXTENSION]: next } } }));
    if ("error" in r) setError(r.error);
  };
  return (
    <div className={section}>
      <SectionHeader
        title="Icons"
        aside={
          <a href={`https://${ICON_SETS[set].site}`} target="_blank" rel="noreferrer" className={clsx(r.link, "text-micro text-fg-subtle decoration-fg-subtle/40 hover:text-fg")}>
            {ICON_SETS[set].site}
          </a>
        }
      />
      <Segmented label="Icon set" value={set} onChange={pick} options={ICON_SET_IDS.map((s) => ({ value: s, label: ICON_SETS[s].label, title: `${ICON_SETS[s].label}: ${ICON_SETS[s].blurb}` }))} />
      <div key={set} className="q-fade flex h-[36px] items-center justify-between rounded-md bg-muted px-[10px] text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" aria-label={`${ICON_SETS[set].label} preview`}>
        {ICON_PREVIEW.map((n) => {
          const name = resolveIconIn(n, set);
          return name ? <IconGlyph key={n} name={name} size={16} /> : null;
        })}
      </div>
      <p className="text-caption text-fg-subtle">
        {ICON_SETS[set].blurb}. Screens built with {ds.name} draw every icon from this set; Qalam AI keeps naming icons as usual and each name gets its {ICON_SETS[set].label} counterpart.
        {ds.source === "builtin" ? " Changing it makes an editable copy of the built-in system." : ""}
      </p>
      {error && <Hint>{error}</Hint>}
    </div>
  );
}

function toCSS(ts: TokenSet) {
  const lines = ts.tokens
    .filter((t) => t.type === "color" || t.type === "dimension")
    .map((t) => `  --${t.path.replace(/\./g, "-")}: ${t.aliasOf ? `var(--${t.aliasOf.replace(/\./g, "-")})` : t.value};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

// ---------------------------------------------------------------------------

/** The system at a glance: its screenshot, or four of its colours (content: ringed so dark systems stay visible). */
function Thumb({ ds, size = 28 }: { ds: DesignSystem; size?: number }) {
  if (ds.thumbnail) return <img src={ds.thumbnail} alt="" className="shrink-0 rounded-md bg-stage object-cover object-top shadow-swatch" style={{ width: size, height: size }} />;
  const ts = tokenSetFor(ds.id);
  return (
    <span className="relative grid shrink-0 grid-cols-2 overflow-hidden rounded-md after:absolute after:inset-0 after:rounded-[inherit] after:shadow-swatch" style={{ width: size, height: size }} aria-hidden>
      {["bg.brand-strong", "bg.brand", "bg.surface", "text.primary"].map((p) => (
        <span key={p} style={{ background: ts.color(p) }} />
      ))}
    </span>
  );
}

function SystemHeader({ active, editable }: { active: DesignSystem; editable: boolean }) {
  const all = useSystems((s) => s.systems);
  // Looks Qalam AI picked for screens without a design system stay out of the list until saved.
  const systems = useMemo(() => all.filter(isListed), [all]);
  const { setActive, remove, update } = useSystems.getState();
  // Up to MAX_EXTRACT_IMAGES screenshots selected on the canvas: screens of one product, extracted together.
  const selectedImages = useStudio((s) => s.selection.filter((id) => s.doc.nodes[id]?.type === "image").slice(0, MAX_EXTRACT_IMAGES).join(","));
  const imageIds = selectedImages ? selectedImages.split(",") : [];
  const selectedImage = imageIds[0] ?? null;
  const [renaming, setRenaming] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  // Extraction happens in the AI chat: Qalam AI looks at the screenshots, then asks what to extract.
  const fromImage = () => (selectedImage ? void startExtractChat({ nodeIds: imageIds }) : file.current?.click());
  const trySample = () => void startExtractChat({ sample: true });

  return (
    <div className={clsx(section, "pt-[2px]")}>
      <div className="flex items-center gap-[4px]">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="q-item group/sys flex h-[44px] min-w-0 flex-1 items-center gap-[10px] rounded-lg bg-field pr-[8px] pl-[6px] text-left hover:shadow-[inset_0_0_0_1px_var(--color-line)] data-[state=open]:shadow-focus-field"
              aria-label="Switch design system"
            >
              <Thumb ds={active} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-fg">{active.name}</span>
                <span className="block truncate text-micro text-fg-subtle">{sourceLabel(active)} · active</span>
              </span>
              <ChevronDown size={12} {...icon} className="q-chevron shrink-0 text-fg-subtle" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={8} className={clsx(r.menu, "w-[304px]")}>
              <div className={r.menuLabel}>Design systems</div>
              {systems.map((s) => (
                <div key={s.id} className="q-item group/row flex items-center gap-[4px] rounded-md pr-[4px] hover:bg-active has-[>button:focus-visible]:bg-active">
                  <Popover.Close asChild>
                    <button type="button" className="flex h-[40px] min-w-0 flex-1 items-center gap-[10px] rounded-md pl-[6px] text-left focus-visible:outline-none" onClick={() => setActive(s.id)}>
                      <Thumb ds={s} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className={clsx("block truncate text-body text-fg", s.id === active.id && "font-medium")}>{s.name}</span>
                        <span className="block truncate text-micro text-fg-subtle">{s.source === "builtin" || s.source === "imported" ? sourceLabel(s) : `${sourceLabel(s)} ${new Date(s.createdAt).toLocaleDateString()}`}</span>
                      </span>
                      {s.id === active.id && <Check size={14} {...icon} className="shrink-0 text-fg" />}
                    </button>
                  </Popover.Close>
                  {s.id !== BUILTIN_ID && (
                    <IconBtn
                      size="sm"
                      label={`Delete ${s.name}`}
                      className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: `Delete “${s.name}”?`,
                          body: "Screens bound to it keep their look and fall back to the built-in system when re-applied.",
                          confirmLabel: "Delete",
                          danger: true,
                        });
                        if (ok) remove(s.id);
                      }}
                    >
                      <Trash2 size={14} {...icon} />
                    </IconBtn>
                  )}
                </div>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {active.id !== BUILTIN_ID && (
          <IconBtn label="Rename" active={renaming} onClick={() => setRenaming((v) => !v)}>
            <Pencil size={14} {...icon} />
          </IconBtn>
        )}
      </div>
      {renaming && (
        <input
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          className="ds-input q-fade h-[28px]"
          defaultValue={active.name}
          aria-label="System name"
          onBlur={(e) => {
            update(active.id, { name: e.target.value.trim() || active.name });
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      )}
      <p className="line-clamp-3 text-caption text-fg-muted" title={active.docs.language.summary}>
        {active.source === "builtin"
          ? "Qalam's built-in ink library in W3C DTCG format: a deep-ink super-app system with a periwinkle accent."
          : active.docs.language.summary || "Extracted from a screenshot."}
      </p>
      <div className="flex flex-wrap gap-[6px]">
        <Button size="sm" onClick={fromImage}>
          <ImagePlus size={14} {...icon} /> {imageIds.length > 1 ? <span className="tnum">Extract from {imageIds.length} selected images</span> : selectedImage ? "Extract from selected image" : "New from screenshots"}
        </Button>
        {!selectedImage && (
          <Button size="sm" variant="ghost" onClick={trySample}>
            Try a sample
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void newSystemProject()}>
          New from a brief
        </Button>
      </div>
      {editable && (
        <Button variant="secondary" size="sm" className="w-full" onClick={() => openWorkspace("tokens", { systemId: active.id })}>
          <Maximize2 size={14} {...icon} /> Edit tokens
        </Button>
      )}
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].slice(0, MAX_EXTRACT_IMAGES);
          e.target.value = "";
          if (files.length) void startExtractChat({ files });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ApplyCard({ ds }: { ds: DesignSystem }) {
  const doc = useStudio((s) => s.doc);
  const selection = useStudio((s) => s.selection);
  const roots = useMemo(() => rootsOf(doc, selection).filter((id) => doc.nodes[id]?.type === "frame"), [doc, selection]);
  const allFrames = doc.roots.filter((id) => doc.nodes[id]?.type === "frame");
  const [mode, setMode] = useState<ApplyMode>("rebuild");
  const [busy, setBusy] = useState<{ started: number; tokens: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RestyleOutcome | null>(null);
  const abort = useRef<AbortController | null>(null);

  if (!allFrames.length) return null;
  const edited = roots.filter((id) => isEdited(doc, id));
  const noSpec = roots.filter((id) => !canRebuild(doc, id));
  const bound = [...new Set(roots.map((id) => systemFor(doc.nodes[id].meta.designSystem).name))];
  const partial = selection.length > 0 && !selection.every((id) => roots.includes(id));

  const restyle = async () => {
    setError(null);
    setOutcome(null);
    abort.current = new AbortController();
    setBusy({ started: Date.now(), tokens: 0 });
    try {
      setOutcome(await restyleSelection(ds.id, (tokens) => setBusy((b) => (b ? { ...b, tokens } : b)), abort.current.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof AIError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={section}>
      <SectionHeader title="Screens" aside={<span className="min-w-0 truncate pl-[8px] text-micro text-fg-subtle tnum">{roots.length ? `${roots.length} selected · ${bound.join(", ")}` : `${allFrames.length} on canvas`}</span>} />
      <Segmented
        label="Apply mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "rebuild", label: "Rebuild layout" },
          { value: "reskin", label: "Reskin only" },
        ]}
      />
      <p className="text-caption text-fg-subtle">
        {mode === "rebuild"
          ? "Lays screens out again with the system's spacing, sizes and component recipes. Screens drawn by hand are reskinned."
          : "Swaps colours, radii, borders, shadows and type in place; positions stay."}
      </p>
      {mode === "rebuild" && edited.length > 0 && <Hint>{edited.length === 1 ? "This screen was" : `${edited.length} screens were`} edited by hand; rebuilding discards those edits (undo brings them back).</Hint>}
      {mode === "rebuild" && noSpec.length > 0 && roots.length > 0 && <Hint tone="info">{noSpec.length} selected screen{noSpec.length > 1 ? "s have" : " has"} no catalog spec and will be reskinned.</Hint>}
      <div className="flex flex-wrap gap-[6px]">
        <Button size="sm" disabled={!roots.length || !!busy} onClick={() => void applyDesignSystem(roots, ds.id, mode)}>
          Apply to selection
        </Button>
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void applyDesignSystem(allFrames, ds.id, mode)}>
          All screens
        </Button>
      </div>
      <div className="mt-[4px] flex flex-col gap-[8px] rounded-lg bg-muted p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        <div className="flex items-start gap-[8px] text-caption text-fg-muted">
          <QalamAIGlyph size={14} className="mt-[1px] shrink-0" />
          <p>
            <b className="font-medium text-fg">Restyle with Qalam AI.</b> It revamps {partial ? "the selected parts" : "the selected screen"} in {ds.name}&apos;s design language: component choices, variants and structure, not just tokens.
          </p>
        </div>
        {busy ? (
          <>
            <Progress tokens={busy.tokens} started={busy.started} label="Restyling…" />
            <Button size="sm" variant="secondary" className="self-start" onClick={() => abort.current?.abort()}>
              <Square size={12} {...icon} /> Stop
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" className="self-start" disabled={!roots.length} onClick={() => void restyle()}>
            {partial ? "Restyle selected parts" : "Restyle screen"}
          </Button>
        )}
        {error && <ErrorNote message={error} />}
        {outcome && (
          <div className="q-rise flex flex-col gap-[4px] text-caption">
            <div className="flex items-center gap-[6px] font-medium text-fg">
              <Check size={14} {...icon} className="shrink-0 text-success" />
              Restyled{outcome.model ? ` · ${outcome.model}` : ""}
              <span className="ml-auto flex items-center gap-[4px] font-normal text-fg-subtle">
                Undo <CommandKbd command="edit.undo" size="sm" />
              </span>
            </div>
            {outcome.changes.length ? (
              <ul className="flex list-disc flex-col gap-[2px] pl-[16px] text-fg-muted marker:text-fg-faint">
                {outcome.changes.map((c, i) => (
                  <li key={i}>
                    <span className="font-mono text-micro text-fg-subtle">{c.path}</span> {c.summary}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-fg-subtle">No changes reported.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
