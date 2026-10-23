import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { AppWindow, ArrowUp, Check, ChevronDown, Component, Crosshair, Frame, Hexagon, ImagePlus, LayoutDashboard, ListChecks, Monitor, Palette, Smartphone, X } from "lucide-react";
import { useStudio, studio, type AITab } from "@/doc/store";
import { BUILTIN_ID, dsIdForNode, getSystem, sourceLabel, systemFor, useActiveSystem, useSystems } from "@/design-system/registry";
import { FREEFORM_NAME, isListed } from "@/design-system/freeform";
import { SAMPLE_CSS } from "@/design-system/extract";
import { formatKeys, registerCommands, useCommand } from "@/commands/registry";
import { Checkbox, CommandKbd, Kbd } from "../controls";
import { r } from "../recipes";
import { Menu, MenuLabel, MenuSeparator } from "../menu";
import { menuRow, refocusAfterMenu } from "./menuRow";
import { MAX_SCREENS, startCritique } from "./critiqueSession";
import { PLATFORMS, PLATFORM_IDS, type Platform } from "@/design-system/platform";
import { autoPlatform, chatById, lookToContinue, parseSource, selectedScreens, send, stopTurn, useActiveChat, useChats } from "./chats";
import { TOOL_ICON } from "./turns";
import { TOOL_LABEL, type ChatTool } from "./chatTypes";
import { directionTargets, nextDir, scanCopy, type DirectionMode } from "./direction";
import { langForDir } from "@/design-system/translate";
import { DirectionComposerBody } from "./DirectionTool";
import { ConnectorsPicker } from "./ConnectorsPicker";
import { CHAT_KEYS } from "./chatKeys";
import { ShotsButtons, ShotsRow, useShots } from "./ExtractComposer";
import { selectedSection, type Section } from "@/design-system/section";
import { composerAttach, composerDraft } from "./composerBridge";
import { revisable } from "./componentImport";

/** The store keeps the composer's tool as the AI tab (the top bar's Generate button sets it). */
const TAB_TOOL: Record<AITab, ChatTool> = { generate: "generate", critique: "critique", import: "detective", audit: "audit", direction: "direction", tune: "tune", extract: "extract", component: "component" };
const TOOL_TAB: Record<ChatTool, AITab> = { generate: "generate", critique: "critique", detective: "import", audit: "audit", direction: "direction", tune: "tune", extract: "extract", discovery: "generate", component: "component" };

export const TOOLS: { tool: ChatTool; hint: string }[] = [
  { tool: "generate", hint: "Screens from a brief, or changes to earlier ones" },
  { tool: "critique", hint: "Heuristics review, then questions about the goal" },
  { tool: "extract", hint: "Turn screenshots of one product into a design system: tokens, components and docs" },
  { tool: "component", hint: "Turn a screenshot of one component into a component in the design system's library" },
  { tool: "detective", hint: "Name tokens in CSS, a token export or a screenshot" },
  { tool: "audit", hint: "Token, accessibility and RTL issues, explained" },
  { tool: "direction", hint: "Switch a screen between left-to-right and right-to-left, its copy translated to match, or mirror a copy" },
  { tool: "tune", hint: "Change the design system's tokens, components or rules, or show it a screen it got wrong" },
];

const PLACEHOLDER: Record<ChatTool, string> = {
  generate: "Describe a screen, or ask for changes to earlier ones…",
  critique: "",
  detective: "Paste CSS or a token JSON export, or attach a screenshot…",
  audit: "Optional: what should the review focus on?",
  direction: "",
  tune: "What's wrong with the selected screen, or what should change in the system?",
  extract: "Optional note: the product, which screen matters most…",
  discovery: "",
  component: "Attach a screenshot of one component. Optional: its name, what changes from one use to the next…",
};

const LANGS = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
  { value: "both", label: "EN + AR" },
] as const;

/** The chat's own keys (Esc, ↵, ⇧↵, ⌘↵) live in chatKeys.ts so tests can read them. */
export { CHAT_KEYS };

/** The running turn of the open chat, if any. */
function runningTurn() {
  const chat = chatById(useChats.getState().activeId);
  const t = chat?.turns.find((x) => x.status === "running");
  return chat && t ? { chatId: chat.id, turnId: t.id } : null;
}

/** Stop what Qalam AI is doing in the open chat. Returns false when nothing runs. */
export function stopActive(): boolean {
  const run = runningTurn();
  if (!run) return false;
  stopTurn(run.chatId, run.turnId);
  return true;
}

registerCommands([
  {
    id: "ai.stop",
    label: "Stop Qalam AI",
    category: "ai",
    gesture: formatKeys(CHAT_KEYS.stop),
    run: () => void stopActive(),
    enabled: () => (runningTurn() ? true : "Qalam AI isn't working in this chat"),
    keywords: ["cancel", "abort", "halt"],
  },
  { id: "ai.minimize", label: "Minimize the chat", category: "ai", gesture: formatKeys(CHAT_KEYS.minimize), run: () => studio().setChatOpen(false), keywords: ["close", "hide"] },
  { id: "ai.send", label: "Send to Qalam AI", category: "ai", gesture: formatKeys(CHAT_KEYS.send), run: () => {}, hidden: true },
  { id: "ai.send-code", label: "Send pasted code (Detective)", category: "ai", gesture: formatKeys(CHAT_KEYS.sendCode), run: () => {}, hidden: true },
  { id: "ai.new-line", label: "New line in the chat", category: "ai", gesture: formatKeys(CHAT_KEYS.newLine), run: () => {}, hidden: true },
]);

export function useComposerTool(): [ChatTool, (t: ChatTool) => void] {
  const tab = useStudio((s) => s.aiTab);
  return [TAB_TOOL[tab], (t) => studio().setAITab(TOOL_TAB[t])];
}

/** Tips the empty composer rotates through after the tool's own placeholder (keys from the registry). */
const TIPS: { command: string; text: string }[] = [
  { command: "ai.new-line", text: "New line" },
  { command: "ai.chat", text: "Jump to this chat from the canvas" },
  { command: "ai.minimize", text: "Minimize the chat" },
];

/** The placeholder index: 0 = the tool's own, then a tip every few seconds while the box is empty. */
function useRotatingTip(base: string, empty: boolean): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (!empty || !base) return;
    const t = setInterval(() => setI((n) => (n + 1) % (TIPS.length + 1)), 4000);
    return () => clearInterval(t);
  }, [base, empty]);
  return i;
}

/** A rotating placeholder line: crossfades between the tool's hint and the tips (with their keycaps). */
function Placeholder({ base, index, mono }: { base: string; index: number; mono: boolean }) {
  const tip = index > 0 ? TIPS[index - 1] : null;
  const keys = useCommand(tip?.command ?? "")?.keys[0];
  return (
    <span key={index} aria-hidden className={clsx("q-fade pointer-events-none absolute inset-x-0 top-0 flex items-center gap-[6px] truncate px-[12px] pt-[12px] text-body text-fg-subtle", mono && !tip && "font-mono text-caption")}>
      {tip ? (
        <>
          {keys && <Kbd keys={keys} size="sm" />}
          {tip.text}
        </>
      ) : (
        base
      )}
    </span>
  );
}

const PLAN_KEY = "qalam/plan-first/v1";

/** Plan first (Generate): on unless the designer turned it off in this browser. */
function usePlanFirst(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(PLAN_KEY) !== "off";
    } catch {
      return true;
    }
  });
  return [
    on,
    (next) => {
      setOn(next);
      try {
        localStorage.setItem(PLAN_KEY, next ? "on" : "off");
      } catch {
        /* storage unavailable */
      }
    },
  ];
}

export { composerDraft };

/** The composer's Send and Stop: invert primaries (recipe buttonPrimary at the composer's 26px). */
const invertBtn = "q-press inline-flex shrink-0 items-center rounded-md bg-inverse text-body font-medium whitespace-nowrap text-fg-inverse shadow-button-invert hover:bg-inverse/90 active:shadow-button-pressed disabled:pointer-events-none disabled:opacity-40";

/** A pill in the composer's bar (tool, language, connectors…): label + chevron, lit while its menu is open. */
export const pill = clsx(r.composerPill, "q-press shrink-0 whitespace-nowrap data-[state=open]:bg-active data-[state=open]:text-fg [&_svg]:shrink-0 [&_svg]:text-fg-subtle");

export default function Composer() {
  const [tool, setTool] = useComposerTool();
  const [text, setText] = useState("");
  const [lang, setLang] = useState<"en" | "ar" | "both">("en");
  const [platform, setPlatform] = useState<Platform | "auto">("auto");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  // Add component: the system it joins when started from the library (else the active one).
  const [targetId, setTargetId] = useState<string | null>(null);
  const [rebuild, setRebuild] = useState(true);
  const [dirMode, setDirMode] = useState<DirectionMode>("switch");
  const [translate, setTranslate] = useState(true);
  const [planOn, setPlanOn] = usePlanFirst();
  const shots = useShots();
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const chat = useActiveChat();
  const running = chat?.turns.find((t) => t.status === "running");
  const system = useActiveSystem();
  const doc = useStudio((s) => s.doc);
  const selection = useStudio((s) => s.selection);
  const screens = useMemo(() => selectedScreens(doc, selection), [doc, selection]);
  // Part of a generated screen selected: Generate changes just that part.
  const section = useMemo(() => (tool === "generate" ? selectedSection(doc, selection) : null), [tool, doc, selection]);
  // Plan first applies to new screens (nothing selected to revise).
  const canPlan = tool === "generate" && !section && !screens.length;
  const loaded = useChats((s) => s.loaded);
  // Tune works on the system the selected screen was built with, else the active one.
  const systems = useSystems((s) => s.systems);
  const tuneSystem = useMemo(() => (screens.length ? systemFor(dsIdForNode(doc, screens[0].id)) : system), [screens, doc, system, systems]);
  // Add component: words alone change the component this chat added last.
  const revising = useMemo(() => (tool === "component" && !image ? revisable(chat?.turns ?? []) : null), [tool, image, chat, systems]);
  const componentSystem = useMemo(() => (revising ? systemFor(revising.systemId) : ((targetId && getSystem(targetId)) || system)), [revising, targetId, system, systems]);

  useEffect(() => {
    composerDraft.bind((s) => {
      setText(s);
      area.current?.focus();
    });
    return () => void composerDraft.bind(null);
  }, []);

  useEffect(() => {
    composerAttach.bind((f, systemId) => {
      studio().setAITab("component");
      attach(f);
      setTargetId(systemId ?? null);
      area.current?.focus();
    });
    return () => void composerAttach.bind(null);
    // attach only swaps the image state; binding once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The top bar's Generate button (and the empty state) pick a tool, or the chat opens: put the cursor in the box.
  const tab = useStudio((s) => s.aiTab);
  const chatOpen = useStudio((s) => s.chatOpen);
  // Bumped by the "/" shortcut (ai.chat) so it refocuses the box even when the chat is already open.
  const chatFocus = useStudio((s) => s.chatFocus);
  useEffect(() => {
    if (chatOpen) area.current?.focus();
  }, [tab, chatOpen, chatFocus]);
  const base =
    tool === "generate" && section
      ? `What should change in the selected ${section.names.length > 1 ? "parts" : section.names[0]}?`
      : revising
        ? `What should change in ${revising.name}? Or attach a screenshot of another component…`
        : PLACEHOLDER[tool];
  const tip = useRotatingTip(base, !text);
  // A pick in one of the bar's menus puts the cursor back in the box.
  const refocus = () => refocusAfterMenu(() => area.current);

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text, tool]);

  const parsed = useMemo(() => (tool === "detective" && !image ? parseSource(text) : null), [tool, text, image]);
  const critiqueCount = Math.min(screens.length, MAX_SCREENS);
  // What Auto would pick right now: the selected screens' platform, else what the brief asks for.
  const autoPick = useMemo(() => (tool === "generate" ? autoPlatform(text, screens.slice(0, 3)) : "mobile"), [tool, text, screens]);
  const targets = useMemo(() => (tool === "direction" ? directionTargets(doc, selection) : []), [tool, doc, selection]);
  const dirLabel = `${dirMode === "switch" ? "Switch to" : "Mirror as"} ${nextDir(targets).toUpperCase()}`;
  // The copy written in the other language, which would be translated along with the switch.
  const toTranslate = useMemo(() => (targets.length ? scanCopy(doc, targets.map((f) => f.id), langForDir(nextDir(targets))).length : 0), [targets, doc]);

  const blocked =
    tool === "generate" || tool === "tune"
      ? text.trim().length < 3
      : tool === "detective"
        ? !image && (!parsed || !!parsed.error || !parsed.raw.length)
        : tool === "critique"
          ? !critiqueCount
          : tool === "direction"
            ? !targets.length
            : tool === "extract"
              ? !shots.items.length
              : tool === "component"
                ? !image && !(revising && text.trim().length >= 3)
                : false;

  const submit = () => {
    if (running || blocked) return;
    if (tool === "critique") {
      // From the chat: the critique continues this chat (from the canvas it opens its own).
      startCritique(studio().selection, { origin: "chat" });
      return;
    }
    if (tool === "direction") {
      void send({ tool, text: dirLabel, frames: targets.map((f) => ({ id: f.id, name: f.name })), direction: { mode: dirMode, to: nextDir(targets), translate: translate && toTranslate > 0 } });
      return;
    }
    if (tool === "extract") {
      void send({ tool, text, images: shots.toInput(), sample: shots.sample });
      shots.clear();
      setText("");
      return;
    }
    void send({ tool, text, lang, platform, image: image?.blob, rebuild, plan: canPlan && planOn, ...(tool === "component" ? { systemId: componentSystem.id } : {}) });
    setText("");
    if (image) URL.revokeObjectURL(image.url);
    setImage(null);
    if (tool === "component") setTargetId(null);
  };

  const attach = (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    setImage((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { blob: f, url: URL.createObjectURL(f) };
    });
  };

  const sendKeys = useCommand(tool === "detective" ? "ai.send-code" : "ai.send")?.keys[0];

  return (
    <div className="@container shrink-0">
      <div
        // One ring per region: while Qalam AI works the composer carries the illumination (and its
        // glow replaces the focus halo); the window itself never gets a ring.
        data-busy={running ? "" : undefined}
        className={clsx(r.composer, "data-[busy]:focus-within:shadow-[var(--ai-glow)]")}
        onDragOver={(e) => (tool === "detective" || tool === "extract" || tool === "component") && e.preventDefault()}
        onDrop={(e) => {
          if (tool !== "detective" && tool !== "extract" && tool !== "component") return;
          e.preventDefault();
          if (tool === "extract") shots.addFiles([...(e.dataTransfer.files ?? [])]);
          else attach(e.dataTransfer.files?.[0]);
        }}
      >
        {tool === "extract" && <ShotsRow shots={shots} />}
        <ContextRow tool={tool} screens={tool === "direction" ? targets.map((f) => ({ id: f.id, name: f.name })) : tool === "tune" ? screens.slice(0, 2) : screens} systemName={tool === "tune" ? tuneSystem.name : tool === "component" ? componentSystem.name : system.name} component={tool === "component" ? { builtin: componentSystem.id === BUILTIN_ID, revising: revising?.name } : undefined} platform={<PlatformPicker key="platform" platform={platform} auto={autoPick} onPick={setPlatform} refocus={refocus} />} systemPicker={<SystemPicker key="ds" screens={screens} chatId={chat?.id} refocus={refocus} />} critiqueCount={critiqueCount} parsed={parsed} image={image} onClearImage={() => setImage(null)} rebuild={rebuild} setRebuild={setRebuild} section={section} />
        {tool === "critique" ? (
          <p className="px-[12px] pt-[12px] pb-[6px] text-body text-fg-muted">
            {critiqueCount
              ? `Qalam AI reviews ${critiqueCount > 1 ? `these ${critiqueCount} screens` : "this screen"}, then asks about its goal in a card on the canvas. The verdict lands in this chat.`
              : `Select up to ${MAX_SCREENS} screens on the canvas to critique them.`}
          </p>
        ) : tool === "direction" ? (
          <DirectionComposerBody targets={targets} mode={dirMode} onMode={setDirMode} toTranslate={toTranslate} translate={translate} onTranslate={setTranslate} />
        ) : (
          <div className="relative">
            {!text && base && <Placeholder base={base} index={tip} mono={tool === "detective"} />}
            <textarea
              ref={area}
              rows={1}
              value={text}
              dir="auto"
              spellCheck={tool !== "detective"}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                if (tool === "extract") {
                  const files = [...e.clipboardData.files].filter((x) => x.type.startsWith("image/"));
                  if (files.length) {
                    e.preventDefault();
                    shots.addFiles(files);
                  }
                  return;
                }
                if (tool !== "detective" && tool !== "component") return;
                const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
                if (f) {
                  e.preventDefault();
                  attach(f);
                }
              }}
              onKeyDown={(e) => {
                // Detective input is pasted code, so Enter adds a line there; ⌘/Ctrl+Enter always sends.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (!e.shiftKey && tool !== "detective"))) {
                  e.preventDefault();
                  submit();
                }
              }}
              aria-label={`${TOOL_LABEL[tool]} request`}
              aria-placeholder={base || undefined}
              className={clsx(r.composerInput, "relative block max-h-[220px] min-h-[38px]", tool === "detective" && "font-mono text-caption")}
            />
          </div>
        )}
        <div className={r.composerBar}>
          <ToolPicker tool={tool} onPick={setTool} refocus={refocus} />
          {tool === "generate" && <LangPicker lang={lang} onPick={setLang} refocus={refocus} />}
          {canPlan && (
            <button
              type="button"
              aria-pressed={planOn}
              onClick={() => setPlanOn(!planOn)}
              title={planOn ? "Plan first is on: Qalam AI says what it understood and asks a few questions before it designs. Click to generate straight from the brief." : "Plan first is off: screens are generated straight from the brief. Click to have Qalam AI ask a few questions first."}
              className={clsx(pill, "aria-pressed:bg-active aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--color-line)] aria-pressed:[&_svg]:text-fg")}
            >
              <ListChecks size={12} absoluteStrokeWidth strokeWidth={1.25} /> Plan
            </button>
          )}
          {(tool === "generate" || tool === "tune" || tool === "critique") && <ConnectorsPicker />}
          {tool === "extract" && <ShotsButtons shots={shots} />}
          {(tool === "detective" || tool === "component") && (
            <>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => (attach(e.target.files?.[0]), (e.target.value = ""))} />
              <button type="button" onClick={() => file.current?.click()} className={pill} title={tool === "component" ? "Attach a screenshot of one component (or paste or drop it here)" : "Attach a screenshot"}>
                <ImagePlus size={12} absoluteStrokeWidth strokeWidth={1.25} /> Screenshot
              </button>
              {tool === "detective" && !text && !image && (
                <button type="button" onClick={() => setText(SAMPLE_CSS)} className={clsx(r.buttonSm, r.buttonGhost)}>
                  Messy sample
                </button>
              )}
            </>
          )}
          <div className="flex-1" />
          {tool !== "critique" && tool !== "direction" && !running && !!text && (
            <span className="mr-[6px] hidden items-center gap-[6px] text-micro text-fg-subtle @[520px]:inline-flex">
              <CommandKbd command="ai.new-line" size="sm" /> New line
            </span>
          )}
          {running ? (
            <button type="button" onClick={() => chat && stopTurn(chat.id, running.id)} className={clsx(invertBtn, "q-fade h-[26px] gap-[6px] pr-[4px] pl-[8px]")}>
              <span aria-hidden className="size-[8px] rounded-[2px] bg-current" />
              Stop
              <CommandKbd command="ai.stop" size="sm" onInverse />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={blocked || !loaded}
              aria-label={tool === "critique" ? "Start critique" : tool === "direction" ? dirLabel : "Send"}
              title={sendKeys ? `Send (${sendKeys.join("")})` : "Send"}
              className={clsx(invertBtn, "h-[26px]", tool === "critique" || tool === "direction" ? "px-[10px]" : "w-[26px] justify-center")}
            >
              {tool === "critique" ? "Critique" : tool === "direction" ? dirLabel : <ArrowUp size={14} strokeWidth={2} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ContextRow({
  tool,
  screens,
  systemName,
  platform,
  systemPicker,
  critiqueCount,
  parsed,
  image,
  onClearImage,
  rebuild,
  setRebuild,
  section,
  component,
}: {
  tool: ChatTool;
  screens: { id: string; name: string }[];
  systemName: string;
  /** Generate: the platform picker, shown as a chip. */
  platform: ReactNode;
  /** Generate: the design system (or none) new screens use, shown as a chip. */
  systemPicker: ReactNode;
  critiqueCount: number;
  parsed: ReturnType<typeof parseSource> | null;
  image: { blob: Blob; url: string } | null;
  onClearImage: () => void;
  rebuild: boolean;
  setRebuild: (v: boolean) => void;
  section: Section | null;
  /** Add component: whether the system is the built-in one (it goes into a copy), and the component a follow-up changes. */
  component?: { builtin: boolean; revising?: string };
}) {
  const chips: ReactNode[] = [];
  if (tool === "component" && component) {
    chips.push(
      component.revising ? (
        <Chip key="ds" icon={<Component />} title={`Your words change ${component.revising} in ${systemName}; screens that place it follow. Attach a screenshot to add another component instead.`}>
          {component.revising} · {systemName}
        </Chip>
      ) : (
        <Chip key="ds" icon={<Hexagon />} title={component.builtin ? `${systemName} is read-only, so the component goes into an editable copy of it` : `The component joins ${systemName}'s library (change the active system in Tokens)`} onClick={() => studio().setLeftTab("tokens")}>
          {component.builtin ? `Adds to a copy of ${systemName}` : `Adds to ${systemName}`}
        </Chip>
      ),
    );
    if (image)
      chips.push(
        <div key="img" className="flex w-full items-center gap-[8px]">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt="Attached screenshot" className="h-[56px] max-w-[160px] rounded-md bg-stage object-contain shadow-swatch" />
            <button type="button" aria-label="Remove screenshot" onClick={onClearImage} className="q-press q-press-icon absolute -top-[6px] -right-[6px] grid size-[16px] place-items-center rounded-full bg-inverse text-fg-inverse shadow-raised">
              <X size={10} strokeWidth={2} />
            </button>
          </div>
          <span className="text-caption text-fg-subtle">Qalam AI builds it from catalog parts in the system&apos;s tokens, checks it against this screenshot, then adds it to the library.</span>
        </div>,
      );
  }
  if (tool === "generate") {
    chips.push(systemPicker, platform);
    if (section)
      chips.push(
        <Chip key="sel" icon={<Crosshair />} title={`Only the selected part of “${section.name}” changes; the rest of the screen stays as it is. Select the whole screen to change all of it.`}>
          {section.names.length > 2 ? `${section.names.length} parts` : section.names.join(", ")} · {section.name}
        </Chip>,
      );
    else if (screens.length) chips.push(<Chip key="sel" icon={<Frame />} title="Selected screens are sent as context, so you can ask for changes to them">{screens.length > 1 ? `${screens.length} screens` : screens[0].name}</Chip>);
  }
  if (tool === "audit") chips.push(<Chip key="scope" icon={<Frame />}>{screens.length ? (screens.length > 1 ? `${screens.length} screens` : screens[0].name) : "All screens"}</Chip>);
  if (tool === "tune") {
    chips.push(
      <Chip key="ds" icon={<Hexagon />} title="The design system to change: the selected screen's, else the active one">
        {systemName}
      </Chip>,
    );
    chips.push(
      screens.length ? (
        <Chip key="sel" icon={<Frame />} title="Qalam AI sees the render and structure of the selected screens">
          {screens.length > 1 ? `${screens.length} screens` : screens[0].name}
        </Chip>
      ) : (
        <span key="hint" className="text-micro text-fg-subtle">
          Select a screen to show what went wrong
        </span>
      ),
    );
  }
  if (tool === "direction" && screens.length) chips.push(<Chip key="scope" icon={<Frame />}>{screens.length > 1 ? `${screens.length} frames` : screens[0].name}</Chip>);
  if (tool === "critique" && critiqueCount) chips.push(<Chip key="scope" icon={<Frame />}>{critiqueCount > 1 ? `${critiqueCount} screens` : screens[0].name}</Chip>);
  if (tool === "detective" && parsed && (parsed.raw.length || parsed.error))
    chips.push(
      <span key="parse" className={clsx("text-micro tnum", parsed.error ? "text-danger" : "text-fg-subtle")}>
        {parsed.error ? `Couldn't parse: ${parsed.error.slice(0, 60)}` : `${parsed.mode === "json" ? "Token JSON" : "CSS"} · ${parsed.raw.length} raw values`}
      </span>,
    );
  if (tool === "detective" && image)
    chips.push(
      <div key="img" className="flex w-full items-center gap-[8px]">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt="Attached screenshot" className="h-[56px] w-[40px] rounded-md bg-stage object-cover object-top shadow-swatch" />
          <button type="button" aria-label="Remove screenshot" onClick={onClearImage} className="q-press q-press-icon absolute -top-[6px] -right-[6px] grid size-[16px] place-items-center rounded-full bg-inverse text-fg-inverse shadow-raised">
            <X size={10} strokeWidth={2} />
          </button>
        </div>
        <Checkbox checked={rebuild} onChange={setRebuild} label={<span className="text-caption">Rebuild as editable frames</span>} />
      </div>,
    );
  if (!chips.length) return null;
  return <div className="flex flex-wrap items-center gap-[4px] px-[10px] pt-[10px]">{chips}</div>;
}

const chipBox = "inline-flex h-[22px] max-w-full items-center gap-[5px] rounded-md bg-hover px-[7px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)] [&_svg]:size-[12px] [&_svg]:shrink-0 [&_svg]:text-fg-subtle";

function Chip({ children, icon, title, onClick }: { children: ReactNode; icon?: ReactNode; title?: string; onClick?: () => void }) {
  const inner = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className={clsx(chipBox, "q-item hover:bg-active hover:text-fg")}>
      {inner}
    </button>
  ) : (
    <span title={title} className={chipBox}>
      {inner}
    </span>
  );
}

/** A two-line menu row (label + hint) with a check for the current pick. */
function PickRow({ icon, label, hint, picked, onPick }: { icon?: ReactNode; label: string; hint?: ReactNode; picked: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={picked}
      {...menuRow(label)}
      onClick={onPick}
      className="q-item flex w-full items-start gap-[8px] rounded-md px-[8px] py-[6px] text-left outline-none focus-visible:outline-none data-[highlighted]:bg-active [&>svg]:mt-[2px]"
    >
      {icon && <span className="mt-[2px] grid size-[14px] shrink-0 place-items-center text-fg-subtle [&_svg]:size-[14px]">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-fg">{label}</span>
        {hint && <span className="block text-caption text-fg-subtle">{hint}</span>}
      </span>
      <span className="mt-[2px] grid size-[14px] shrink-0 place-items-center text-fg">{picked && <Check size={12} strokeWidth={2} />}</span>
    </button>
  );
}

function ToolPicker({ tool, onPick, refocus }: { tool: ChatTool; onPick: (t: ChatTool) => void; refocus: () => void }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[tool];
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      side="top"
      label="Qalam AI tools"
      className="w-[296px]"
      trigger={
        <button type="button" aria-haspopup="menu" className={clsx(pill, "text-fg")} aria-label={`Tool: ${TOOL_LABEL[tool]}`}>
          <Icon size={12} /> {TOOL_LABEL[tool]} <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
        </button>
      }
    >
      <div className={r.menuLabel}>Qalam AI tools</div>
      {TOOLS.map((t) => {
        const I = TOOL_ICON[t.tool];
        return (
          <PickRow
            key={t.tool}
            icon={<I size={14} />}
            label={TOOL_LABEL[t.tool]}
            hint={t.hint}
            picked={tool === t.tool}
            onPick={() => {
              onPick(t.tool);
              setOpen(false);
              refocus();
            }}
          />
        );
      })}
    </Menu>
  );
}

const PLATFORM_ICON = { mobile: Smartphone, web: Monitor, dashboard: LayoutDashboard, app: AppWindow } as const;
const PLATFORM_HINT: Record<Platform, string> = {
  mobile: "390 × 844 · 16px side margins",
  web: "1440 wide · 1200px content column",
  dashboard: "1440 wide · side navigation",
  app: "1440 × 900 · editor or tool: panels, stage, timeline",
};

/**
 * Generate: which design system new screens use, or none. Without one, Qalam AI picks the look
 * (and keeps it for screens that continue earlier ones, which the chip names).
 */
function SystemPicker({ screens, chatId, refocus }: { screens: { id: string }[]; chatId?: string; refocus: () => void }) {
  const [open, setOpen] = useState(false);
  const all = useSystems((s) => s.systems);
  const freeform = useSystems((s) => s.freeform);
  const active = useActiveSystem();
  const systems = useMemo(() => all.filter(isListed), [all]);
  // Chats and the canvas both decide which look a follow-up keeps.
  const turns = useChats((s) => (chatId ? s.chats.find((c) => c.id === chatId)?.turns : undefined));
  const doc = useStudio((s) => s.doc);
  const keep = useMemo(() => (freeform ? lookToContinue(chatId, screens.map((x) => x.id)) : undefined), [freeform, chatId, screens, turns, doc, all]);
  const pick = (id: string | null) => {
    const reg = useSystems.getState();
    if (id) reg.setActive(id);
    reg.setFreeform(!id);
    setOpen(false);
    refocus();
  };
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      side="top"
      label="Design system"
      className="w-[280px]"
      trigger={
        <button
          type="button"
          aria-haspopup="menu"
          className={clsx(chipBox, "q-item hover:bg-active hover:text-fg data-[state=open]:bg-active data-[state=open]:text-fg")}
          aria-label="Design system"
          title={
            !freeform
              ? `New screens use ${active.name}`
              : keep
                ? `No design system: new screens keep the look “${keep.name}” Qalam AI picked for these screens, unless you ask for another`
                : "No design system: Qalam AI picks how the screens look for your brief"
          }
        >
          {freeform ? <Palette absoluteStrokeWidth strokeWidth={1.25} /> : <Hexagon absoluteStrokeWidth strokeWidth={1.25} />}
          <span className="truncate">{!freeform ? active.name : keep ? `${keep.name} · no system` : FREEFORM_NAME}</span>
          <ChevronDown absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
        </button>
      }
    >
      <PickRow icon={<Palette />} label={FREEFORM_NAME} hint="Qalam AI picks the look for your brief: colour, type, corners and depth" picked={freeform} onPick={() => pick(null)} />
      <MenuSeparator />
      <MenuLabel>Design systems</MenuLabel>
      {systems.map((s) => (
        <PickRow key={s.id} icon={<Hexagon />} label={s.name} hint={sourceLabel(s)} picked={!freeform && s.id === active.id} onPick={() => pick(s.id)} />
      ))}
    </Menu>
  );
}

function PlatformPicker({ platform, auto, onPick, refocus }: { platform: Platform | "auto"; auto: Platform; onPick: (p: Platform | "auto") => void; refocus: () => void }) {
  const [open, setOpen] = useState(false);
  const current = platform === "auto" ? auto : platform;
  const Icon = PLATFORM_ICON[current];
  const row = (value: Platform | "auto", label: string, hint: string) => (
    <PickRow
      key={value}
      label={label}
      hint={<span className="tnum">{hint}</span>}
      picked={platform === value}
      onPick={() => {
        onPick(value);
        setOpen(false);
        refocus();
      }}
    />
  );
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      side="top"
      label="Platform"
      className="w-[256px]"
      trigger={
        <button type="button" aria-haspopup="menu" className={clsx(chipBox, "q-item hover:bg-active hover:text-fg data-[state=open]:bg-active data-[state=open]:text-fg")} aria-label="Platform" title="What the screens are for: phone, web page, dashboard or desktop app">
          <Icon absoluteStrokeWidth strokeWidth={1.25} />
          {platform === "auto" ? `Auto · ${PLATFORMS[auto].label}` : PLATFORMS[platform].label}
          <ChevronDown absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
        </button>
      }
    >
      {row("auto", `Auto (${PLATFORMS[auto].label})`, "From the brief or the selected screens")}
      {PLATFORM_IDS.map((p) => (
        <Fragment key={p}>{row(p, PLATFORMS[p].label, PLATFORM_HINT[p])}</Fragment>
      ))}
    </Menu>
  );
}

function LangPicker({ lang, onPick, refocus }: { lang: "en" | "ar" | "both"; onPick: (l: "en" | "ar" | "both") => void; refocus: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      side="top"
      label="Language"
      className="w-[168px]"
      trigger={
        <button type="button" aria-haspopup="menu" className={pill} aria-label="Language">
          {LANGS.find((l) => l.value === lang)!.label} <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
        </button>
      }
    >
      {LANGS.map((l) => (
        <button
          key={l.value}
          type="button"
          role="menuitemradio"
          aria-checked={lang === l.value}
          {...menuRow(l.label)}
          onClick={() => {
            onPick(l.value);
            setOpen(false);
            refocus();
          }}
          className={clsx(r.menuItem, "w-full text-left focus-visible:outline-none")}
        >
          <span className={r.menuCheckSlot}>{lang === l.value && <Check size={12} strokeWidth={2} />}</span>
          {l.label}
        </button>
      ))}
    </Menu>
  );
}
