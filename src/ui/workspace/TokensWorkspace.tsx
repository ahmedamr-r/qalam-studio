import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { BookOpen, Check, ChevronRight, Copy, GitFork, Hexagon, Lock, MoreHorizontal, PenLine, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { tokenSetFor, useSystems, type DesignSystem } from "@/design-system/registry";
import { isListed } from "@/design-system/freeform";
import type { Token, TokenSet, Tree } from "@/design-system/resolve";
import { ROLE_SPECS } from "@/design-system/contract";
import {
  NEW_TYPES,
  TIERS,
  createToken,
  deleteToken,
  duplicateToken,
  groupsOf,
  isLocked,
  referencesTo,
  renameToken,
  setDescription,
  setValue,
  tierOf,
  tokensIn,
  type Group,
  type NewType,
  type Tier,
} from "@/design-system/edit";
import { feedback } from "@/commands/feedback";
import { useStudio } from "@/doc/store";
import { Button, IconBtn, MenuItem, MenuSeparator, Tag } from "../controls";
import { r } from "../recipes";
import { ContrastView, EffectsView, LanguageView, LayoutView, ShapeView, TypeView } from "../tokens/views";
import { SideHeading, SideItem, Twisty, WorkspaceHeader } from "./Workspace";
import { InlineInput, TIER_DOT, ValueCell } from "./TokenValue";
import { boundRoots, duplicateSystem, moveScreens, redoEdit, renameBindings, undoEdit, useEdits } from "./editing";
import { useEditor, useShownSystem, type Edit } from "./useEditor";
import { useWorkspace, type TokenScope } from "./store";

/**
 * The token editor (Figma's variables, full size): collections (design systems) and token groups
 * on the left, grouped by tier (primitives → semantic roles → component recipes); a table of
 * names, values and descriptions on the right, all editable in place.
 */

const DOCS: { doc: Extract<TokenScope, { kind: "doc" }>["doc"]; label: string }[] = [
  { doc: "type", label: "Type specimens" },
  { doc: "shape", label: "Shape & spacing" },
  { doc: "effects", label: "Effects & recipes" },
  { doc: "language", label: "Design language" },
  { doc: "layout", label: "Layout" },
  { doc: "contrast", label: "Contrast" },
];

/** Icon props for every lucide glyph here: 1.25px lines at any size. */
const ico = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** What each contract role is for, shown until the token has a description of its own (not the bare path). */
const ROLE_HELP = new Map(ROLE_SPECS.filter((r) => r.description !== r.path).map((r) => [r.path, r.description]));

export default function TokensWorkspace() {
  const { ds, activeId } = useShownSystem();
  const scope = useWorkspace((s) => s.scope);
  const ts = useMemo(() => tokenSetFor(ds.id), [ds]);
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const { edit, onError } = useEditor(ds);
  const canUndo = useEdits((s) => s.past.length > 0);
  const canRedo = useEdits((s) => s.future.length > 0);

  const setScope = (s: TokenScope) => {
    setQ("");
    useWorkspace.setState({ scope: s });
  };

  const create = (type: NewType) => {
    const tier: Tier = scope.kind === "tier" || scope.kind === "group" ? scope.tier : type === "color" || type === "dimension" || type === "fontFamily" ? "primitive" : "semantic";
    const group = scope.kind === "group" ? scope.group : undefined;
    let made = "";
    let madeTier: Tier = tier;
    const id = edit("Create token", (tree) => {
      const r = createToken(tree, { type, tier, group });
      made = r.path;
      madeTier = tierOf(r.tree, r.path);
      return { tree: r.tree };
    });
    if (!id) return;
    setQ("");
    // Show the new token's group if it landed outside the current view (a type style made under Primitives goes to type.*).
    const hidden = (scope.kind === "tier" && scope.tier !== madeTier) || (scope.kind === "group" && !made.startsWith(`${scope.group}.`)) || scope.kind === "doc";
    if (hidden) useWorkspace.setState({ scope: { kind: "group", tier: madeTier, group: made.split(".").slice(0, -1).join(".") } });
    setRenaming(made);
  };

  const rows = useMemo(() => {
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      return ts.tokens.filter((t) => t.path.toLowerCase().includes(n) || String(t.authored).toLowerCase().includes(n) || (t.description ?? "").toLowerCase().includes(n));
    }
    if (scope.kind === "tier") return tokensIn(ds.tree, ts, { tier: scope.tier });
    if (scope.kind === "group") return tokensIn(ds.tree, ts, { group: scope.group });
    return ts.tokens;
  }, [q, scope, ds.tree, ts]);

  return (
    <>
      <WorkspaceHeader
        icon={<Hexagon {...ico} />}
        title="Tokens"
        search={q}
        onSearch={setQ}
        placeholder="Search names, values, notes"
        actions={
          <div className="flex items-center gap-[2px]">
            {/* The keys are the canvas's undo/redo; inside the editor they undo token edits. */}
            <IconBtn label="Undo token edit" command="edit.undo" disabled={!canUndo} onClick={() => undoEdit()}>
              <Undo2 size={14} {...ico} />
            </IconBtn>
            <IconBtn label="Redo token edit" command="edit.redo" disabled={!canRedo} onClick={() => redoEdit()}>
              <Redo2 size={14} {...ico} />
            </IconBtn>
          </div>
        }
      >
        <span className={r.crumbSep} aria-hidden>
          /
        </span>
        <span className="truncate text-body text-fg-muted">{ds.name}</span>
        {ds.id === activeId && <Tag>Active</Tag>}
      </WorkspaceHeader>
      <div className="flex min-h-0 flex-1">
        <Sidebar ds={ds} ts={ts} scope={scope} setScope={setScope} activeId={activeId} />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <Notices ds={ds} activeId={activeId} />
          {scope.kind === "doc" && !q ? (
            <div key={scope.doc} className="q-rise min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[768px]">
                {scope.doc === "type" && <TypeView ts={ts} />}
                {scope.doc === "shape" && <ShapeView ts={ts} />}
                {scope.doc === "effects" && <EffectsView ts={ts} />}
                {scope.doc === "language" && <LanguageView docs={ds.docs} />}
                {scope.doc === "layout" && <LayoutView docs={ds.docs} />}
                {scope.doc === "contrast" && <ContrastView ts={ts} />}
              </div>
            </div>
          ) : (
            <>
              <ScopeTitle scope={q ? null : scope} count={rows.length} query={q} />
              <TokenTable ds={ds} ts={ts} tokens={rows} flat={!!q.trim()} renaming={renaming} setRenaming={setRenaming} edit={edit} onError={onError} onCreate={create} />
            </>
          )}
        </main>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sidebar

function Thumb({ ds }: { ds: DesignSystem }) {
  if (ds.thumbnail) return <img src={ds.thumbnail} alt="" className="size-[16px] shrink-0 rounded-xs object-cover object-top shadow-swatch" />;
  const ts = tokenSetFor(ds.id);
  return (
    <span className="grid size-[16px] shrink-0 grid-cols-2 overflow-hidden rounded-xs shadow-swatch" aria-hidden>
      {["bg.brand-strong", "bg.brand", "bg.surface", "text.primary"].map((p) => (
        <span key={p} style={{ background: ts.color(p) }} />
      ))}
    </span>
  );
}

function Sidebar({ ds, ts, scope, setScope, activeId }: { ds: DesignSystem; ts: TokenSet; scope: TokenScope; setScope: (s: TokenScope) => void; activeId: string }) {
  const all = useSystems((s) => s.systems);
  // A look Qalam AI picked (no design system) is listed while it's the one shown, or once saved.
  const systems = useMemo(() => all.filter((s) => isListed(s) || s.id === ds.id), [all, ds.id]);
  const tiers = useMemo(() => TIERS.map((t) => ({ ...t, groups: groupsOf(ds.tree, ts, t.tier), count: tokensIn(ds.tree, ts, { tier: t.tier }).length })), [ds.tree, ts]);
  const [open, setOpen] = useState<Record<string, boolean>>({ primitive: true, semantic: true, component: true });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !(o[k] ?? false) }));

  const groupRows = (groups: Group[], tier: Tier, depth: number): ReactNode =>
    groups.map((g) => {
      const key = `${tier}:${g.path}`;
      const selected = scope.kind === "group" && scope.group === g.path;
      const expandable = g.children.length > 0;
      return (
        <Fragment key={g.path}>
          <SideItem
            depth={depth}
            selected={selected}
            count={g.count}
            onClick={() => setScope({ kind: "group", tier, group: g.path })}
            title={g.path}
            lead={<Twisty show={expandable} open={!!open[key]} onClick={() => toggle(key)} />}
          >
            {g.name}
          </SideItem>
          {expandable && open[key] && groupRows(g.children, tier, depth + 1)}
        </Fragment>
      );
    });

  return (
    <nav aria-label="Collections and groups" className="flex w-[248px] shrink-0 flex-col overflow-y-auto border-r border-line-subtle bg-app pt-[4px] pb-[16px]">
      <SideHeading
        action={
          <IconBtn size="sm" label={`Duplicate ${ds.name} as a new collection`} onClick={() => useWorkspace.setState({ systemId: duplicateSystem(ds, `${ds.name} copy`).id })}>
            <Plus size={14} {...ico} />
          </IconBtn>
        }
      >
        Collections
      </SideHeading>
      {systems.map((s) => (
        <SideItem
          key={s.id}
          selected={s.id === ds.id}
          onClick={() => useWorkspace.setState({ systemId: s.id })}
          count={tokenSetFor(s.id).tokens.length}
          lead={<Thumb ds={s} />}
          title={s.source === "builtin" ? "Built-in, read-only: edits make a copy" : s.name}
          trail={
            s.id === activeId ? (
              <span className="mr-[6px] grid size-[16px] place-items-center text-fg-muted" title="Active: new screens use it">
                <Check size={12} {...ico} />
              </span>
            ) : (
              <button
                type="button"
                onClick={() => useSystems.getState().setActive(s.id)}
                title="Make it the active system: new screens use it"
                className="q-item q-press mr-[2px] hidden h-[20px] rounded-sm px-[6px] text-micro font-medium text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] group-hover/side:block group-focus-within/side:block hover:bg-active hover:text-fg"
              >
                Use
              </button>
            )
          }
        >
          <span className="flex min-w-0 items-center gap-[6px]">
            <span className="truncate">{s.name}</span>
            {s.source === "builtin" && <Lock size={12} {...ico} className="shrink-0 text-fg-subtle" aria-label="Built-in" />}
          </span>
        </SideItem>
      ))}

      <div className={clsx(r.divider, "mx-[16px] my-[8px]")} />
      <SideHeading>Tokens</SideHeading>
      <SideItem selected={scope.kind === "all"} onClick={() => setScope({ kind: "all" })} count={ts.tokens.length} lead={<Twisty show={false} />}>
        All tokens
      </SideItem>
      {tiers.map((t) => (
        <Fragment key={t.tier}>
          <SideItem
            selected={scope.kind === "tier" && scope.tier === t.tier}
            onClick={() => setScope({ kind: "tier", tier: t.tier })}
            count={t.count}
            title={t.hint}
            lead={<Twisty show open={!!open[t.tier]} onClick={() => toggle(t.tier)} />}
          >
            <span className="flex items-center gap-[8px]">
              <TierDot tier={t.tier} />
              {t.label}
            </span>
          </SideItem>
          {open[t.tier] && groupRows(t.groups, t.tier, 1)}
        </Fragment>
      ))}

      <div className={clsx(r.divider, "mx-[16px] my-[8px]")} />
      <SideHeading>Overview</SideHeading>
      {DOCS.map((d) => (
        <SideItem key={d.doc} selected={scope.kind === "doc" && scope.doc === d.doc} onClick={() => setScope({ kind: "doc", doc: d.doc })} lead={<Twisty show={false} />}>
          <span className="flex items-center gap-[8px]">
            <BookOpen size={14} {...ico} className="shrink-0 text-fg-subtle" />
            {d.label}
          </span>
        </SideItem>
      ))}
    </nav>
  );
}

/** The tier's nuqta: primitives neutral, semantic roles blue, component recipes violet (the alias chips match). */
export function TierDot({ tier }: { tier: Tier }) {
  return <span className={clsx("size-[6px] shrink-0 rotate-45 rounded-[1px]", TIER_DOT[tier])} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Notices and titles

function Notices({ ds, activeId }: { ds: DesignSystem; activeId: string }) {
  const forked = useEdits((s) => s.forked);
  // Re-count when the canvas changes (screens moved, deleted, added).
  const doc = useStudio((s) => s.doc);
  const [moving, setMoving] = useState(false);
  const stillOnSource = useMemo(() => (forked && forked.to === ds.id ? boundRoots(forked.from).length : 0), [forked, ds.id, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ds.source === "builtin") {
    return (
      <div className="flex min-h-[36px] shrink-0 items-center gap-[8px] border-b border-line-subtle bg-muted px-[16px] py-[8px] text-caption text-fg-muted">
        <Lock size={12} {...ico} className="shrink-0 text-fg-subtle" />
        <span>
          <b className="font-medium text-fg">{ds.name}</b> is the built-in system and stays as it is. Your first edit makes an editable copy{ds.id === activeId ? ", which becomes the active system" : ""}.
        </span>
      </div>
    );
  }
  if (stillOnSource > 0 && forked) {
    const from = useSystems.getState().systems.find((s) => s.id === forked.from);
    return (
      <div className="flex min-h-[40px] shrink-0 items-center gap-[8px] border-b border-line-subtle bg-muted px-[16px] py-[6px] text-caption text-fg-muted">
        <GitFork size={12} {...ico} className="shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1">
          You&apos;re editing <b className="font-medium text-fg">{ds.name}</b>, a copy of {from?.name ?? "the built-in system"}. {stillOnSource} {stillOnSource === 1 ? "screen" : "screens"} on the canvas still{" "}
          {stillOnSource === 1 ? "uses" : "use"} the original.
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={moving}
          onClick={async () => {
            setMoving(true);
            await moveScreens(forked.from, ds.id);
            setMoving(false);
          }}
        >
          Move {stillOnSource === 1 ? "it" : "them"} to this copy
        </Button>
      </div>
    );
  }
  return null;
}

function ScopeTitle({ scope, count, query }: { scope: TokenScope | null; count: number; query: string }) {
  let title: ReactNode = `Results for “${query}”`;
  let hint = "";
  if (scope?.kind === "all") {
    title = "All tokens";
    hint = "Primitives feed semantic roles, and roles feed component recipes. Screens bind to roles and recipes.";
  } else if (scope?.kind === "tier" || scope?.kind === "group") {
    const tier = TIERS.find((t) => t.tier === scope.tier)!;
    hint = tier.hint;
    title =
      scope.kind === "tier" ? (
        tier.label
      ) : (
        <span className="flex items-center gap-[6px]">
          <span className="text-fg-subtle">{tier.label}</span>
          {scope.group
            .replace(/^component\./, "")
            .split(".")
            .map((s, i) => (
              <Fragment key={i}>
                <ChevronRight size={14} {...ico} className="text-fg-faint" />
                <span>{s}</span>
              </Fragment>
            ))}
        </span>
      );
  }
  return (
    <div className="flex shrink-0 items-baseline gap-[12px] px-[16px] pt-[16px] pb-[12px]">
      <h3 className="text-heading font-semibold text-fg">{title}</h3>
      <span className="text-caption text-fg-subtle tnum">
        {count} {count === 1 ? "token" : "tokens"}
      </span>
      {hint && <span className="ml-auto hidden max-w-[50%] truncate text-caption text-fg-subtle lg:block">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table

const COLS = "grid grid-cols-[minmax(200px,1fr)_minmax(280px,1.35fr)_minmax(180px,1fr)_32px]";

const parentOf = (p: string) => p.split(".").slice(0, -1).join(".");
const leafOf = (p: string) => p.split(".").pop()!;

export function TokenTable({
  ds,
  ts,
  tokens,
  flat,
  renaming,
  setRenaming,
  edit,
  onError,
  onCreate,
}: {
  ds: DesignSystem;
  ts: TokenSet;
  tokens: Token[];
  flat: boolean;
  renaming: string | null;
  setRenaming: (p: string | null) => void;
  edit: Edit;
  onError: (msg: string) => void;
  /** Offered at the bottom of the table when set. */
  onCreate?: (type: NewType) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  // The row a rename just landed on flashes once (it remounts under its new name).
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 400);
    return () => clearTimeout(t);
  }, [flash]);
  // Section headers: one per group, in tree order.
  const sections = useMemo(() => {
    const out: { group: string; tokens: Token[] }[] = [];
    for (const t of tokens) {
      const g = flat ? "" : parentOf(t.path);
      const last = out[out.length - 1];
      if (last && last.group === g) last.tokens.push(t);
      else out.push({ group: g, tokens: [t] });
    }
    return out;
  }, [tokens, flat]);

  useEffect(() => {
    if (!renaming) return;
    scroller.current?.querySelector(`[data-path="${CSS.escape(renaming)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [renaming, tokens]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className={clsx(COLS, "sticky top-0 z-10 h-[32px] min-w-[760px] items-center border-y border-line-subtle bg-panel px-[16px] text-micro font-medium text-fg-subtle")}>
          <span className="pl-[6px]">Name</span>
          <span className="pl-[6px]">Value</span>
          <span className="pl-[6px]">Description</span>
          <span />
        </div>
        {tokens.length === 0 && <p className="px-[16px] py-[40px] text-center text-body text-fg-subtle">No tokens match.</p>}
        {sections.map((s, i) => (
          <div key={`${s.group}-${i}`} className="min-w-[760px]">
            {!flat && s.group && (
              <div className="flex h-[36px] items-center gap-[8px] border-b border-line-subtle px-[22px] pt-[4px] text-caption font-semibold text-fg">
                <TierDot tier={tierOf(ds.tree, s.tokens[0].path)} />
                <span className="truncate">{s.group.replace(/^component\./, "").replace(/\./g, " / ")}</span>
                <span className="font-normal text-fg-subtle tnum">{s.tokens.length}</span>
              </div>
            )}
            {s.tokens.map((t) => (
              <TokenRow
                key={t.path}
                ds={ds}
                ts={ts}
                t={t}
                showPath={flat}
                renaming={renaming === t.path}
                flash={flash === t.path}
                setRenaming={setRenaming}
                onRenamed={setFlash}
                edit={edit}
                onError={onError}
              />
            ))}
          </div>
        ))}
      </div>
      {onCreate && (
        <div className="flex h-[44px] shrink-0 items-center gap-[12px] border-t border-line-subtle px-[12px]">
          <Popover.Root open={creating} onOpenChange={setCreating}>
            <Popover.Trigger asChild>
              <button type="button" className={clsx(r.button, r.buttonGhost, "data-[state=open]:bg-active data-[state=open]:text-fg")}>
                <Plus size={14} {...ico} /> Create token
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content side="top" align="start" sideOffset={6} collisionPadding={8} className={clsx(r.menu, "w-[200px]")} role="menu" aria-label="Token type">
                <div className={r.menuLabel}>Type</div>
                {NEW_TYPES.map((n) => (
                  <MenuItem
                    key={n.type}
                    onSelect={() => {
                      setCreating(false);
                      onCreate(n.type);
                    }}
                  >
                    {n.label}
                  </MenuItem>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <span className="min-w-0 truncate text-caption text-fg-subtle">
            Double-click a name to rename it. Dots make groups: <span className="font-mono text-micro">color.brand.500</span>
          </span>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  ds: DesignSystem;
  ts: TokenSet;
  t: Token;
  showPath: boolean;
  renaming: boolean;
  flash: boolean;
  setRenaming: (p: string | null) => void;
  onRenamed: (to: string) => void;
  edit: Edit;
  onError: (msg: string) => void;
}

/**
 * A row only re-renders when its own token (or how it is shown) changes: an edit elsewhere leaves
 * the other rows alone. Their callbacks act on the system by id, so they never go stale; popovers
 * read the live system when they open.
 */
const rowKey = (p: RowProps) =>
  JSON.stringify([p.t.path, p.t.type, p.t.authored, p.t.value, p.t.description ?? "", p.showPath, p.renaming, p.flash, p.ds.id, p.t.aliasOf ? tierOf(p.ds.tree, p.t.aliasOf) : ""]);
const TokenRow = memo(TokenRowImpl, (a, b) => rowKey(a) === rowKey(b));

function TokenRowImpl({ ds, ts, t, showPath, renaming, flash, setRenaming, onRenamed, edit, onError }: RowProps) {
  const locked = isLocked(t.path);
  const setVal = (value: unknown) => !!edit(`Edit ${t.path}`, (tree: Tree) => setValue(tree, t.path, value));
  const rename = (to: string) => {
    const id = edit(`Rename ${t.path}`, (tree: Tree) => renameToken(tree, t.path, to.trim()));
    if (id) {
      renameBindings(id, t.path, to.trim());
      onRenamed(to.trim());
    }
    return !!id;
  };
  return (
    <div
      data-path={t.path}
      className={clsx(COLS, "q-item group/row min-h-[40px] items-center border-b border-line-subtle px-[16px] hover:bg-hover", renaming && "bg-hover", flash && "q-flash-row")}
    >
      <div className="flex min-w-0 items-center gap-[8px] pr-[12px]">
        {renaming ? (
          <InlineInput
            autoFocus
            look="field"
            ariaLabel="Token name"
            value={t.path}
            text="font-mono text-caption text-fg"
            className="w-full"
            onCommit={(v) => {
              rename(v);
            }}
            onDone={() => setRenaming(null)}
          />
        ) : (
          <button
            type="button"
            className="flex h-[28px] min-w-0 items-center gap-[6px] rounded-sm px-[6px] text-left"
            title={locked ? `${t.path}: part of the role contract, so it keeps its name` : `${t.path}: double-click to rename`}
            onDoubleClick={() => (locked ? onError(`${t.path} is part of the role contract: screens are built with it, so it keeps its name.`) : setRenaming(t.path))}
          >
            <span className={clsx("truncate text-fg", showPath ? "font-mono text-caption" : "text-body font-medium")}>{showPath ? t.path : leafOf(t.path)}</span>
            {locked && <Lock size={12} {...ico} className="shrink-0 text-fg-subtle" aria-label="Contract token" />}
          </button>
        )}
      </div>
      <div className="flex min-w-0 items-center pr-[12px]">
        <ValueCell dsId={ds.id} ts={ts} tree={ds.tree} t={t} onSet={setVal} />
      </div>
      <div className="min-w-0 pr-[8px]">
        <InlineInput
          ariaLabel={`Description of ${t.path}`}
          value={t.description ?? ""}
          placeholder={ROLE_HELP.get(t.path) ?? "Add a description"}
          text="text-caption text-fg-muted"
          quiet={!ROLE_HELP.has(t.path)}
          className="w-full"
          onCommit={(v) => !!edit(`Describe ${t.path}`, (tree: Tree) => setDescription(tree, t.path, v))}
        />
      </div>
      <RowMenu dsId={ds.id} t={t} locked={locked} onRename={() => setRenaming(t.path)} edit={edit} onError={onError} />
    </div>
  );
}

type MenuProps = { dsId: string; t: Token; locked: boolean; onRename: () => void; edit: Edit; onError: (m: string) => void };

function RowMenu(props: MenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`More actions for ${props.t.path}`}
          className={clsx(r.iconButtonSm, "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100")}
        >
          <MoreHorizontal size={14} {...ico} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" sideOffset={4} collisionPadding={8} className={clsx(r.menu, "w-[232px]")} role="menu" aria-label={props.t.path}>
          {open && <RowMenuItems {...props} close={() => setOpen(false)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RowMenuItems({ dsId, t, locked, onRename, edit, onError, close }: MenuProps & { close: () => void }) {
  // Read when the menu opens, from the live system: other rows may have changed since this one rendered.
  useSystems((s) => s.systems);
  const refs = referencesTo(tokenSetFor(dsId), t.path);
  const cssVar = `var(--${t.path.replace(/\./g, "-")})`;
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <>
      <MenuItem icon={<PenLine {...ico} />} disabled={locked} onSelect={run(onRename)}>
        Rename
      </MenuItem>
      <MenuItem
        icon={<Copy {...ico} />}
        onSelect={run(() =>
          edit(`Duplicate ${t.path}`, (tree: Tree) => {
            const r = duplicateToken(tree, t.path);
            return "error" in r ? r : { tree: r.tree };
          }),
        )}
      >
        Duplicate
      </MenuItem>
      <MenuItem
        icon={<Hexagon {...ico} />}
        onSelect={run(() => {
          void navigator.clipboard
            ?.writeText(cssVar)
            .then(() => feedback(`Copied ${cssVar}`, { kind: "success" }))
            .catch(() => onError("Couldn't copy to the clipboard."));
        })}
      >
        Copy CSS variable
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 {...ico} />} danger disabled={locked || refs.length > 0} onSelect={run(() => edit(`Delete ${t.path}`, (tree: Tree) => deleteToken(tree, t.path)))}>
        Delete
      </MenuItem>
      {(locked || refs.length > 0) && (
        <p className="px-[8px] pt-[2px] pb-[6px] text-micro text-fg-subtle">
          {locked ? "Part of the role contract: screens are built with it." : `Used by ${refs.slice(0, 3).join(", ")}${refs.length > 3 ? ` and ${refs.length - 3} more` : ""}.`}
        </p>
      )}
    </>
  );
}
