import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Cable, Compass, Milestone, Moon, Network, NotebookText, PanelLeft, Search, Target, Workflow, type LucideIcon } from "lucide-react";
import { useGoals } from "@/goals/client";
import { runCommand } from "@/commands/registry";
import { usePagePalette } from "@/commands/pages";
import { listProjects } from "@/projects/library";
import { useOrgContext } from "@/org/context";
import { wordsFor } from "@/org/words";
import { goalHref, projectHref, spaceHref, topicHref, type Project } from "@/projects/model";
import { TOPIC_KIND_LABEL } from "@/hub/topics";
import { QalamAIGlyph } from "../brand";
import { r } from "../recipes";
import { highlightRuns, scoreItem } from "../surfaces/fuzzy";
import { useTopics } from "../topics/list";
import { askNext } from "../org/ask-next";
import { SpaceTile } from "./OrgPlaces";
import { withAsk } from "./palette";
import { PLACES, placeShown, type Place } from "./places";
import type { Space } from "./spaces";
import { useCurrentOrg, useFrame } from "./store";
import { navigate } from "../nav";
import { composeIn } from "../space/chat/compose";
import { startTour } from "../space/tour-state";

/*
 * ⌘K on a page: one field that finds the organization's canvases, Decisions and Connections, the
 * goals, the boards and the topic pages by name, a few actions, and hands anything else to Qalam AI (Ask the
 * org, on the home). Studio's own palette (src/ui/surfaces/CommandPalette.tsx) also searches the
 * canvas; this one has no canvas.
 */

interface Row {
  key: string;
  group: string;
  label: string;
  hits: number[];
  icon: ReactNode;
  sub?: string;
  score: number;
  run: () => void;
}

const ICONS: Record<Place, LucideIcon> = { home: Workflow, decisions: Milestone, connections: Cable };
const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const MAX = 8;

export function PagePalette({ space }: { space: Space }) {
  const open = usePagePalette((s) => s.open);
  return open ? <Palette space={space} /> : null;
}

const close = () => usePagePalette.setState({ open: false });

function Palette({ space }: { space: Space }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [boards, setBoards] = useState<Project[]>([]);
  const topics = useTopics();
  const goals = useGoals((s) => s.goals);
  const products = useOrgContext((s) => s.products);
  const org = useCurrentOrg();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    void listProjects().then((list) => setBoards(list.filter((p) => p.type === "discovery")), () => {});
  }, []);

  const rows = useMemo(() => {
    const q = query.trim();
    const out: Row[] = [];
    const add = (group: string, key: string, label: string, icon: ReactNode, run: () => void, sub?: string, keywords?: string[]) => {
      if (!q) return void out.push({ key, group, label, hits: [], icon, sub, score: 0, run });
      const m = scoreItem(q, { label, keywords, extra: sub });
      if (m) out.push({ key, group, label, hits: m.hits, icon, sub, score: m.score, run });
    };
    // The organization's canvases, then the pages of their own.
    for (const s of [{ id: null, name: org?.name ?? "Organization" }, ...products]) add("Go to", `space:${s.id ?? ""}`, s.name, <SpaceTile name={s.name || "·"} size="sm" />, () => navigate(spaceHref(s.id)), s.id ? "Product" : wordsFor(org?.shape).whole);
    for (const p of PLACES.filter((p) => (p.id === "decisions" || p.id === "connections") && placeShown(p.id))) {
      const Icon = ICONS[p.id];
      add("Go to", `place:${p.id}`, p.label, <Icon {...ICON} />, () => navigate(spaceHref(space, p.id)));
    }
    if (q) for (const g of goals) add("Goals", `goal:${g.id}`, g.title, <Target {...ICON} />, () => navigate(goalHref(g.id)), "Goal");
    for (const b of boards.slice(0, q ? boards.length : 4)) add("Boards", `board:${b.id}`, b.name, <Network {...ICON} />, () => navigate(projectHref(b)), "Board");
    if (q) for (const t of topics ?? []) add("Problems and pages", `topic:${t.id}`, t.title, <NotebookText {...ICON} />, () => navigate(topicHref(t.id)), TOPIC_KIND_LABEL[t.kind]);
    add("Actions", "theme", "Toggle dark and light", <Moon {...ICON} />, () => runCommand("view.theme-toggle", "palette"), undefined, ["theme", "appearance"]);
    add("Actions", "chat", useFrame.getState().chat ? "Hide Qalam AI" : "Show Qalam AI", <PanelLeft {...ICON} />, () => runCommand("frame.chat", "palette"), undefined, ["chat", "sidebar", "fold", "panel"]);
    // Qalam AI's chat on the canvas: finding a goal or a problem with its questions, or reading a brain dump.
    const onCanvas = (then: () => void) => () => {
      navigate(spaceHref(space));
      then();
    };
    // The chat's store comes with the canvas: loaded only when it's asked for.
    const find = (what: "goal" | "problem") => () => void import("../space/chat/store").then((m) => m.findWith(what, space));
    add("Actions", "find-goal", "Find a goal with Qalam AI", <QalamAIGlyph size={14} />, onCanvas(find("goal")), undefined, ["help", "suggest", "goal", "questions"]);
    add("Actions", "find-problem", "Find a problem with Qalam AI", <QalamAIGlyph size={14} />, onCanvas(find("problem")), undefined, ["help", "suggest", "problem", "questions"]);
    add("Actions", "dump", "Brain dump", <QalamAIGlyph size={14} />, onCanvas(() => composeIn({ mode: "dump" })), undefined, ["paste", "thinking", "notes", "place"]);
    add("Actions", "tour", "Show the walkthrough", <Compass {...ICON} />, onCanvas(startTour), undefined, ["tour", "help", "guide", "intro", "onboarding"]);
    // Grouped as listed; within a group, the best match first, and a few per group.
    const groups = [...new Set(out.map((x) => x.group))];
    const ranked = groups.flatMap((g) =>
      out
        .filter((x) => x.group === g)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX),
    );
    if (q.length < 3) return ranked;
    return withAsk(ranked, { key: "ask", group: "Qalam AI", label: `Ask: ${q}`, hits: [], icon: <QalamAIGlyph size={16} />, score: 0, run: () => askNext(q) }, q);
  }, [query, boards, topics, goals, space, products, org]);

  useEffect(() => setAt(0), [query]);
  const run = (row: Row | undefined) => {
    if (!row) return;
    close();
    row.run();
  };

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-40" onPointerDown={close} />
      <div role="dialog" aria-label="Search and go to" data-state="open" className={r.palette}>
        <div className={r.paletteInputRow}>
          <Search size={16} absoluteStrokeWidth strokeWidth={1.25} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to a canvas, a goal or a problem, or ask Qalam AI"
            aria-label="Search"
            aria-activedescendant={rows[at] ? `palette-${rows[at].key}` : undefined}
            className={r.paletteInput}
            onKeyDown={(e) => {
              if (e.key === "Escape") return close();
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = rows.length;
                if (n) setAt((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
              }
              if (e.key === "Enter") {
                e.preventDefault();
                run(rows[at]);
              }
            }}
          />
        </div>
        <div role="listbox" aria-label="Results" className={clsx(r.paletteList, "max-h-[min(420px,60vh)]")}>
          {rows.map((row, i) => (
            <div key={row.key}>
              {(i === 0 || rows[i - 1].group !== row.group) && <div className={r.paletteGroup}>{row.group}</div>}
              <div
                id={`palette-${row.key}`}
                role="option"
                aria-selected={i === at}
                onPointerMove={() => setAt(i)}
                onClick={() => run(row)}
                className={clsx(r.paletteRow, "cursor-default", i === at && "bg-active")}
              >
                {row.icon}
                <span className="min-w-0 truncate">
                  {highlightRuns(row.label, row.hits).map((run, k) => (run.hit ? <mark key={k} className="bg-transparent font-semibold text-fg">{run.text}</mark> : <span key={k}>{run.text}</span>))}
                </span>
                {row.sub && <span className={r.paletteSub}>{row.sub}</span>}
              </div>
            </div>
          ))}
          {!rows.length && <p className="px-[10px] py-[12px] text-caption text-fg-subtle">Nothing by that name. Type three letters or more to ask Qalam AI.</p>}
        </div>
      </div>
    </>
  );
}

