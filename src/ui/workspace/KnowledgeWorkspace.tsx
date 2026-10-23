import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scan, Spline, Waypoints, Wand2 } from "lucide-react";
import { layoutDb } from "@/knowledge/db";
import { layoutGraph, type Positions } from "@/knowledge/layout";
import type { View } from "@/knowledge/lod";
import { useKnowledge } from "@/knowledge/store";
import { IconBtn, Segmented } from "../controls";
import DesignsList, { storyDecisions } from "../knowledge/DesignsList";
import GraphView, { type GraphApi } from "../knowledge/GraphView";
import Inspector from "../knowledge/Inspector";
import Legend from "../knowledge/Legend";
import Sidebar, { filterRefs, searchNodes, type Filter } from "../knowledge/Sidebar";
import Story from "../knowledge/Story";
import Timeline from "../knowledge/Timeline";
import { useKnowledgeGraph } from "../knowledge/useKnowledgeGraph";
import { WorkspaceHeader } from "./Workspace";
import { useWorkspace } from "./store";

/**
 * The Knowledge hub, full size. It opens on "Why": the designs Qalam AI made on the left, and for
 * the one picked, the story of why it looks the way it does and how to fix it. "Map" shows
 * everything Qalam AI knows as a network (groups left, details right, timeline below); positions
 * are saved per project, so the map looks the same every time it opens.
 */

const ico = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
/** Saved positions from an older layout (other node sizes) are laid out again. */
const LAYOUT_VERSION = 3;

type HubView = "why" | "map";

export default function KnowledgeWorkspace() {
  const projectId = useKnowledge((s) => s.projectId) ?? "local";
  const [view, setView] = useState<HubView>("why");
  const [asOf, setAsOf] = useState<number | null>(null);
  // Every decision (the Why list, the timeline), and the map as of the timeline's moment.
  const full = useKnowledgeGraph({ window: Infinity });
  const graph = useKnowledgeGraph({ asOf: asOf ?? undefined });
  const [story, setStory] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showGiven, setShowGiven] = useState(false);
  const [positions, setPositions] = useState<Positions | null>(null);
  const [saved, setSaved] = useState<{ positions: Positions; view: View | null } | null | undefined>(undefined);
  const api = useRef<GraphApi | null>(null);
  const posRef = useRef<Positions | null>(null);
  posRef.current = positions;
  const viewRef = useRef<View | null>(null);

  // The story on show: the one picked, else the latest design.
  const decisions = useMemo(() => storyDecisions(full), [full]);
  const storyRef = story && full.byRef.has(story) ? story : (decisions[0]?.ref ?? null);

  // Saved positions first (or none), then lay out what's new.
  useEffect(() => {
    let live = true;
    if (typeof indexedDB === "undefined") return setSaved(null);
    layoutDb
      .get(projectId)
      .then((l) => live && setSaved(l?.v === LAYOUT_VERSION ? l : null))
      .catch(() => live && setSaved(null));
    return () => {
      live = false;
    };
  }, [projectId]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (posRef.current && typeof indexedDB !== "undefined") layoutDb.put(projectId, { v: LAYOUT_VERSION, positions: posRef.current, view: viewRef.current }).catch(() => {});
    }, 500);
  }, [projectId]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  useEffect(() => {
    if (saved === undefined) return;
    const base = posRef.current ?? saved?.positions ?? null;
    const next = layoutGraph(graph, base, { seed: projectId });
    const fresh = Object.keys(next).filter((r) => !base?.[r]);
    if (!base || fresh.length) {
      // Keep the places of nodes the timeline hides now: they come back where they were.
      setPositions({ ...(base ?? {}), ...next });
      save();
    } else if (!posRef.current) setPositions(base);
  }, [graph, saved, projectId, save]);

  /** Show a node on the map, moving the timeline back when it's an older decision. */
  const showOnMap = useCallback(
    (ref: string, at?: number) => {
      setView("map");
      setQuery("");
      setFilter({ kind: "all" });
      if (!graph.byRef.has(ref) && at) setAsOf(at);
      setSelected(ref);
      requestAnimationFrame(() => requestAnimationFrame(() => api.current?.focus(ref)));
    },
    [graph],
  );

  // "Why?" and other ways in: a decision opens its story; a fact opens the map on it.
  const focus = useWorkspace((s) => s.knowledgeFocus);
  useEffect(() => {
    if (!focus) return;
    if (full.byRef.get(focus.ref)?.kind === "decision") {
      setView("why");
      setStory(focus.ref);
      useWorkspace.setState({ knowledgeFocus: null });
      return;
    }
    if (!positions) return;
    if (!graph.byRef.has(focus.ref) && !(focus.asOf && asOf !== focus.asOf)) return;
    showOnMap(focus.ref, focus.asOf);
    useWorkspace.setState({ knowledgeFocus: null });
  }, [focus, positions, graph, full, asOf, showOnMap]);

  // A selection the map no longer has (the timeline moved past it) clears.
  useEffect(() => {
    if (selected && !graph.byRef.has(selected)) setSelected(null);
  }, [graph, selected]);

  const highlight = useMemo(() => (query.trim() ? new Set(searchNodes(graph, query).map((n) => n.ref)) : filterRefs(graph, filter)), [graph, query, filter]);

  const tidy = () => {
    const next = layoutGraph(graph, null, { seed: projectId, reset: true });
    setPositions({ ...(posRef.current ?? {}), ...next });
    save();
    requestAnimationFrame(() => api.current?.fit());
  };

  const map = view === "map";
  return (
    <>
      <WorkspaceHeader
        icon={<Waypoints {...ico} />}
        title="Knowledge hub"
        search={map ? query : undefined}
        onSearch={map ? setQuery : undefined}
        placeholder="Search what Qalam AI knows"
        actions={
          map ? (
            <div className="flex items-center gap-[2px]">
              <IconBtn label={showGiven ? "Hide every given link" : "Show every given link"} active={showGiven} onClick={() => setShowGiven((v) => !v)}>
                <Spline size={14} {...ico} />
              </IconBtn>
              <IconBtn label="Tidy layout" onClick={tidy}>
                <Wand2 size={14} {...ico} />
              </IconBtn>
              <IconBtn label="Zoom to fit" keys={["0"]} onClick={() => api.current?.fit()}>
                <Scan size={14} {...ico} />
              </IconBtn>
            </div>
          ) : undefined
        }
      >
        <Segmented<HubView>
          label="View"
          value={view}
          onChange={setView}
          className="ml-[8px] w-[176px]"
          options={[
            { value: "why", label: "Why", title: "Why each design looks the way it does" },
            { value: "map", label: "Map", title: "Everything Qalam AI knows, as a network" },
          ]}
        />
      </WorkspaceHeader>
      {map ? (
        <div className="flex min-h-0 flex-1">
          <Sidebar
            graph={graph}
            filter={filter}
            setFilter={(f) => {
              setFilter(f);
              setQuery("");
            }}
            query={query}
            selected={selected}
            onPick={(r) => {
              setSelected(r);
              api.current?.focus(r);
            }}
          />
          <main className="relative flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              {positions ? (
                <GraphView
                  api={api}
                  graph={graph}
                  positions={positions}
                  selected={selected}
                  onSelect={setSelected}
                  highlight={highlight}
                  showGiven={showGiven}
                  initialView={saved?.view ?? null}
                  onView={(v) => {
                    viewRef.current = v;
                    save();
                  }}
                  onMove={(r, p) => setPositions((cur) => ({ ...(cur ?? {}), [r]: [Math.round(p[0]), Math.round(p[1])] }))}
                  onMoveEnd={save}
                  onOpen={() => document.getElementById("knowledge-inspector")?.focus()}
                />
              ) : (
                <div className="grid h-full place-items-center bg-canvas text-caption text-fg-subtle">Laying out what Qalam AI knows…</div>
              )}
              <Legend />
            </div>
            <Timeline
              full={full}
              asOf={asOf}
              setAsOf={setAsOf}
              earlier={graph.earlier}
              onPick={(r) => {
                setSelected(r);
                requestAnimationFrame(() => api.current?.focus(r));
              }}
            />
          </main>
          <Inspector
            graph={graph}
            selected={selected}
            onSelect={(r) => {
              setSelected(r);
              if (r) api.current?.focus(r);
            }}
            onFilter={(g) => setFilter({ kind: "group", group: g })}
            onStory={(r) => {
              setStory(r);
              setView("why");
            }}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <DesignsList graph={full} selected={storyRef} onSelect={setStory} />
          <main className="flex min-w-0 flex-1 flex-col bg-panel">
            {storyRef ? (
              <Story graph={full} decisionRef={storyRef} onShowOnMap={(r) => showOnMap(r, full.byRef.get(r)?.at)} />
            ) : (
              <div className="grid flex-1 place-items-center p-[24px] text-center">
                <div className="flex max-w-[360px] flex-col items-center gap-[8px]">
                  <p className="text-body font-medium text-fg">Nothing to explain yet</p>
                  <p className="text-caption text-fg-muted">Generate or critique a screen. Its story shows here: what you asked, what Qalam AI followed, what it didn&apos;t know, and how to fix it.</p>
                  <button type="button" className="text-caption text-fg underline underline-offset-2" onClick={() => setView("map")}>
                    See everything it knows on the map
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </>
  );
}
