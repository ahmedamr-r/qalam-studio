import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Cable, Files, House, Milestone, Moon, Network, NotebookText, PanelLeft, Search, type LucideIcon } from "lucide-react";
import { runCommand } from "@/commands/registry";
import { usePagePalette } from "@/commands/pages";
import { listProjects } from "@/projects/library";
import { placeHref, projectHref, topicHref, type Project } from "@/projects/model";
import { QalamAIGlyph } from "../brand";
import { r } from "../recipes";
import { highlightRuns, scoreItem } from "../surfaces/fuzzy";
import { useTopics } from "../topics/list";
import { askNext } from "../org/ask-next";
import { PLACES, type Place } from "./places";

/*
 * ⌘K on a page: one field that finds the organization's places, its boards and its topic pages by
 * name, a few actions, and hands anything else to Qalam AI (Ask the org, on the home). Studio's own
 * palette (src/ui/surfaces/CommandPalette.tsx) also searches the canvas; this one has no canvas.
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

const ICONS: Record<Place, LucideIcon> = { home: House, boards: Network, topics: NotebookText, sources: Files, decisions: Milestone, connections: Cable };
const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const MAX = 8;

export function PagePalette() {
  const open = usePagePalette((s) => s.open);
  return open ? <Palette /> : null;
}

const close = () => usePagePalette.setState({ open: false });

function Palette() {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [boards, setBoards] = useState<Project[]>([]);
  const topics = useTopics();
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
    for (const p of PLACES) {
      const Icon = ICONS[p.id];
      add("Go to", `place:${p.id}`, p.label, <Icon {...ICON} />, () => window.location.assign(placeHref(p.id)));
    }
    for (const b of boards.slice(0, q ? boards.length : 4)) add("Boards", `board:${b.id}`, b.name, <Network {...ICON} />, () => window.location.assign(projectHref(b)), "Board");
    if (q) for (const t of topics ?? []) add("Topic pages", `topic:${t.id}`, t.title, <NotebookText {...ICON} />, () => window.location.assign(topicHref(t.id)), "Topic page");
    add("Actions", "theme", "Toggle dark and light", <Moon {...ICON} />, () => runCommand("view.theme-toggle", "palette"), undefined, ["theme", "appearance"]);
    add("Actions", "sidebar", "Fold the sidebar", <PanelLeft {...ICON} />, () => runCommand("frame.sidebar", "palette"), undefined, ["rail", "collapse"]);
    // Grouped as listed; within a group, the best match first, and a few per group.
    const groups = [...new Set(out.map((x) => x.group))];
    const ranked = groups.flatMap((g) =>
      out
        .filter((x) => x.group === g)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX),
    );
    if (q.length >= 3)
      ranked.unshift({ key: "ask", group: "Qalam AI", label: `Ask: ${q}`, hits: [], icon: <QalamAIGlyph size={16} />, score: 0, run: () => askNext(q) });
    return ranked;
  }, [query, boards, topics]);

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
            placeholder="Go to a place, a board or a topic page, or ask Qalam AI"
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

