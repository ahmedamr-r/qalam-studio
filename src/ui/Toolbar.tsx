import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Circle, Frame, Hand, ImagePlus, MousePointer2, MoveUpRight, Network, Pencil, PenTool, Scaling, Slash, Square, Star, StickyNote, Triangle, Type, type LucideIcon } from "lucide-react";
import { useStudio, type Tool } from "@/doc/store";
import { onCommandRun, runCommand, useCommand } from "@/commands/registry";
import { useVectorEdit } from "@/engine/vector-state";
import { CommandKbd, Tip } from "./controls";
import { Menu, MenuItem } from "./menu";
import { r } from "./recipes";
import { useSlidingIndicator } from "./motion";
import { QalamAIGlyph } from "./brand";
import { useChats } from "./ai/chats";
import VectorToolbar from "./VectorToolbar";
import { useProjectType } from "@/projects/mode";
import { onComponentsPage } from "@/doc/pages";

/*
 * Figma UI3's floating tool bar: [Move ▾] [Frame] [Shapes ▾] [Pen ▾] [Text] | [Actions ⌘K] [Qalam AI /].
 * A split slot remembers its last-used tool and shows it; the chevron (or a long press) opens its
 * flyout, and a key that picks a member (L, ⇧P…) updates the face too. The active slot sits on the one
 * neutral "lit" key with a saffron icon: the key slides on the spring when a click switches tools and
 * jumps when the keyboard does. Keys come from the commands registry, never typed here. Vector edit
 * mode swaps in its own tools. Height = --toolbar-h (44px), 16px above the canvas bottom.
 */

export const TOOL_ICON: Record<Tool, LucideIcon> = {
  select: MousePointer2,
  hand: Hand,
  scale: Scaling,
  frame: Frame,
  rect: Square,
  line: Slash,
  arrow: MoveUpRight,
  ellipse: Circle,
  polygon: Triangle,
  star: Star,
  pen: PenTool,
  pencil: Pencil,
  text: Type,
  card: Network,
  sticky: StickyNote,
};

interface Group {
  id: string;
  /** Names the flyout ("Shape tools"). */
  label: string;
  tools: Tool[];
  /** Commands listed after the tools that are actions, not tools (Place image…). */
  actions?: { id: string; icon: LucideIcon }[];
}

const GROUPS: Group[] = [
  { id: "move", label: "Move tools", tools: ["select", "hand", "scale"] },
  { id: "frame", label: "Frame", tools: ["frame"] },
  { id: "shape", label: "Shape tools", tools: ["rect", "line", "arrow", "ellipse", "polygon", "star"], actions: [{ id: "tool.place-image", icon: ImagePlus }] },
  { id: "draw", label: "Drawing tools", tools: ["pen", "pencil"] },
  { id: "text", label: "Text", tools: ["text"] },
];

/** A Discovery board (FigJam's tools): tree cards, stickies, shapes and connectors, text. */
const BOARD_GROUPS: Group[] = [
  { id: "move", label: "Move tools", tools: ["select", "hand"] },
  { id: "card", label: "Card", tools: ["card"] },
  { id: "sticky", label: "Sticky note", tools: ["sticky"] },
  { id: "shape", label: "Shapes and lines", tools: ["rect", "ellipse", "line", "arrow"], actions: [{ id: "tool.place-image", icon: ImagePlus }] },
  { id: "text", label: "Text", tools: ["text"] },
];

/** The Components page: looking around only (it is drawn from the design system). */
const PAGE_GROUPS: Group[] = [{ id: "move", label: "Move tools", tools: ["select", "hand"] }];

const FACES_KEY = "qalam/toolbar-faces";
type Faces = Record<string, Tool>;
const defaultFaces = (groups: Group[]): Faces => Object.fromEntries(groups.map((g) => [g.id, g.tools[0]]));

/** Each kind of project remembers its own slot faces. */
const facesKey = (groups: Group[]) => (groups === BOARD_GROUPS ? `${FACES_KEY}/board` : groups === PAGE_GROUPS ? `${FACES_KEY}/components` : FACES_KEY);

function readFaces(groups: Group[]): Faces {
  try {
    const saved = JSON.parse(window.localStorage.getItem(facesKey(groups)) ?? "{}") as Faces;
    const ok = Object.entries(saved).filter(([g, t]) => groups.find((x) => x.id === g)?.tools.includes(t));
    return { ...defaultFaces(groups), ...Object.fromEntries(ok) };
  } catch {
    return defaultFaces(groups);
  }
}

function saveFaces(groups: Group[], f: Faces) {
  try {
    window.localStorage.setItem(facesKey(groups), JSON.stringify(f));
  } catch {
    /* storage unavailable: faces reset on reload */
  }
}

const LONG_PRESS_MS = 320;

export default function Toolbar() {
  const onComponents = useStudio((s) => onComponentsPage(s.doc));
  const groups = useProjectType() === "discovery" ? BOARD_GROUPS : onComponents ? PAGE_GROUPS : GROUPS;
  const groupOf = (t: Tool) => groups.find((g) => g.tools.includes(t));
  const tool = useStudio((s) => s.tool);
  const uiHidden = useStudio((s) => s.view.uiHidden);
  const chatOpen = useStudio((s) => s.chatOpen);
  const editingVector = useVectorEdit((s) => s.nodeId !== null);
  const busy = useChats((s) => s.chats.some((c) => c.turns.some((t) => t.status === "running")));
  const [faces, setFaces] = useState<Faces>(() => defaultFaces(groups));
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // Where the last tool switch came from: a click slides the key, the keyboard jumps it, and
  // programmatic resets (back to Move after drawing) jump without the icon pop.
  const source = useRef<"click" | "keyboard" | null>(null);
  // Bumped per user switch, for the slot switched to only: a slot that lights up some other way
  // (back to Move after drawing) must not see a changed count and pop.
  const [pop, setPop] = useState<{ n: number; group: string | null }>({ n: 0, group: null });
  // The tool as last rendered: a command that leaves the tool where it was is no switch.
  const shown = useRef(tool);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => setFaces(readFaces(groups)), [groups]);

  useEffect(
    () =>
      onCommandRun((id, src) => {
        // Only real tool switches (Place image… is an action in the tools category). The command has
        // already run: re-picking the current tool changes nothing, so it must not leave a "click"
        // behind for the next switch (the automatic return to Move after drawing would spring and pop).
        if (!(id.slice(5) in TOOL_ICON && id.startsWith("tool."))) return;
        source.current = useStudio.getState().tool === shown.current ? null : src === "keyboard" ? "keyboard" : "click";
      }),
    [],
  );

  // A tool picked by key or menu becomes its slot's face.
  useEffect(() => {
    shown.current = tool;
    const g = groupOf(tool);
    if (g) setFaces((f) => (f[g.id] === tool ? f : (saveFaces(groups, { ...f, [g.id]: tool }), { ...f, [g.id]: tool })));
    if (source.current) setPop((p) => ({ n: p.n + 1, group: g?.id ?? null }));
    source.current = null;
  }, [tool]);

  const activeGroup = groupOf(tool)?.id ?? null;
  // Decided once per switch: later re-renders must not flip it (that would cut the glide short).
  const instant = useMemo(() => source.current !== "click", [activeGroup]);
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLElement, HTMLSpanElement>(activeGroup, { instant });

  if (uiHidden) return null;
  if (editingVector) return <VectorToolbar />;

  // The run listener above records the source (and only when the tool really changes).
  const pick = (t: Tool) => runCommand(`tool.${t}`, "toolbar");

  return (
    <nav ref={containerRef} aria-label="Tools" data-region="toolbar" className={clsx(r.toolbar, "select-none")}>
      <span ref={indicatorRef} aria-hidden className={clsx(r.toolIndicator, "data-[hidden]:opacity-0")} />
      {groups.map((g) => (
        <Slot
          key={g.id}
          group={g}
          // The groups change with the page (the Components page has only Move tools): until its
          // faces are read for the new groups, a slot shows its first tool.
          face={g.tools.includes(faces[g.id]) ? faces[g.id] : g.tools[0]}
          active={activeGroup === g.id}
          tool={tool}
          pop={pop.group === g.id ? pop.n : 0}
          open={openGroup === g.id}
          onOpenChange={(o) => setOpenGroup(o ? g.id : null)}
          onPick={pick}
        />
      ))}
      <span aria-hidden className={r.toolSep} />
      <button
        type="button"
        onClick={() => runCommand("essential.actions", "toolbar")}
        className={clsx(r.toolKey, r.toolText, "pr-[6px] whitespace-nowrap")}
      >
        Actions <CommandKbd command="essential.actions" size="sm" />
      </button>
      <button
        type="button"
        aria-pressed={chatOpen}
        aria-label={busy ? "Qalam AI (working)" : "Qalam AI"}
        onClick={() => useStudio.getState().toggleChat()}
        // aria-pressed here is a toggle, not the active tool: neutral lit key, never saffron text.
        className={clsx(r.toolKey, r.toolText, "pr-[6px] pl-[8px] whitespace-nowrap aria-pressed:bg-active aria-pressed:text-fg")}
      >
        <QalamAIGlyph size={16} />
        Qalam AI
        <CommandKbd command="ai.chat" size="sm" />
        {busy && <span aria-hidden className={clsx(r.railBadge, "top-[6px] right-[4px] shadow-[0_0_0_2px_var(--color-raised)]")} />}
      </button>
    </nav>
  );
}

/** One toolbar slot: the face tool's button, plus a chevron + flyout when the slot holds several tools. */
function Slot({
  group,
  face,
  active,
  tool,
  pop,
  open,
  onOpenChange,
  onPick,
}: {
  group: Group;
  face: Tool;
  active: boolean;
  tool: Tool;
  pop: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (t: Tool) => void;
}) {
  const multi = group.tools.length > 1 || !!group.actions?.length;
  const cmd = useCommand(`tool.${face}`);
  const press = useRef(0);
  const longPressed = useRef(false);
  const iconRef = useRef<HTMLSpanElement>(null);

  // The newly active tool's icon pops on the bouncy spring (user switches only).
  useEffect(() => {
    const el = iconRef.current;
    if (!pop || !el) return;
    el.classList.remove("q-icon-pop");
    void el.offsetWidth;
    el.classList.add("q-icon-pop");
  }, [pop]);

  const keyButton = (
    <Tip label={cmd?.label ?? face} command={`tool.${face}`} side="top">
      <button
        type="button"
        aria-label={cmd?.label ?? face}
        aria-pressed={active}
        onPointerDown={(e) => {
          if (!multi || e.button !== 0) return;
          longPressed.current = false;
          clearTimeout(press.current);
          press.current = window.setTimeout(() => {
            longPressed.current = true;
            onOpenChange(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={() => clearTimeout(press.current)}
        onPointerLeave={() => clearTimeout(press.current)}
        onClick={() => {
          if (longPressed.current) return void (longPressed.current = false);
          onPick(face);
        }}
        className={clsx(
          "q-press q-press-icon grid h-full place-items-center rounded-lg outline-offset-0",
          multi ? "pr-[2px] pl-[8px]" : "w-[36px]",
        )}
      >
        <span ref={iconRef} className="grid">
          <SwapIcon tool={face} />
        </span>
      </button>
    </Tip>
  );

  return (
    <div
      data-indicator-active={active || undefined}
      data-active={active || undefined}
      data-state={open ? "open" : "closed"}
      className={clsx(
        "q-item relative z-[1] flex h-[36px] items-center rounded-lg",
        active ? "text-fg-accent" : "text-fg-muted hover:bg-hover hover:text-fg",
        !active && open && "bg-hover text-fg",
      )}
    >
      {multi ? (
        <Menu
          flyout
          side="top"
          align="center"
          sideOffset={10}
          checks
          label={group.label}
          open={open}
          onOpenChange={onOpenChange}
          anchor={(trigger) => (
            <span className="flex h-full items-center">
              {keyButton}
              {trigger}
            </span>
          )}
          trigger={
            <button
              type="button"
              aria-label={group.label}
              aria-haspopup="menu"
              aria-expanded={open}
              className={clsx("q-press grid h-full w-[16px] place-items-center rounded-r-lg pr-[2px] outline-offset-0", active ? "text-fg-muted" : open ? "text-fg" : "text-fg-subtle hover:text-fg-muted")}
            >
              <ChevronDown size={10} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
            </button>
          }
        >
          {group.tools.map((t) => (
            <FlyoutTool key={t} tool={t} face={t === face} current={t === tool} onPick={onPick} />
          ))}
          {group.actions?.map((a) => (
            <FlyoutAction key={a.id} id={a.id} icon={a.icon} />
          ))}
        </Menu>
      ) : (
        keyButton
      )}
    </div>
  );
}

function FlyoutTool({ tool, face, current, onPick }: { tool: Tool; face: boolean; current: boolean; onPick: (t: Tool) => void }) {
  const c = useCommand(`tool.${tool}`);
  const Icon = TOOL_ICON[tool];
  if (!c || c.unavailable) return null;
  return (
    <MenuItem
      checked={face}
      onSelect={() => onPick(tool)}
      icon={<Icon absoluteStrokeWidth strokeWidth={1.25} className={clsx(current && r.flyoutPickedIcon)} />}
      shortcut={c.keys[0]}
    >
      {c.label}
    </MenuItem>
  );
}

function FlyoutAction({ id, icon: Icon }: { id: string; icon: LucideIcon }) {
  const c = useCommand(id);
  if (!c || c.unavailable) return null;
  return (
    <MenuItem onSelect={() => runCommand(id, "toolbar")} icon={<Icon absoluteStrokeWidth strokeWidth={1.25} />} shortcut={c.keys[0]} disabled={c.enabled === true ? false : c.enabled}>
      {c.label}
    </MenuItem>
  );
}

/** The slot icon: a new face crossfades in over the old one (120ms, q-swap). */
function SwapIcon({ tool }: { tool: Tool }) {
  const [state, setState] = useState<{ shown: Tool; leaving: Tool | null; entering: boolean }>({ shown: tool, leaving: null, entering: false });
  const prev = useRef(tool);

  useLayoutEffect(() => {
    if (tool === prev.current) return;
    const old = prev.current;
    prev.current = tool;
    setState({ shown: tool, leaving: old, entering: true });
    // Mount the new icon faded out, then let it transition in on the next frame.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setState((s) => ({ ...s, entering: false }))));
    const t = window.setTimeout(() => setState((s) => ({ ...s, leaving: null })), 160);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [tool]);

  const icon = (t: Tool, out: boolean) => {
    const Icon = TOOL_ICON[t];
    return <Icon key={t} size={16} absoluteStrokeWidth strokeWidth={1.25} data-out={out || undefined} />;
  };
  return (
    <span className="q-swap place-items-center">
      {state.leaving && state.leaving !== state.shown && icon(state.leaving, true)}
      {icon(state.shown, state.entering)}
    </span>
  );
}
