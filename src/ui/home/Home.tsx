import { useEffect, useMemo, useState } from "react";
import { PanelRight, X } from "lucide-react";
import { laneOf, type LaneItem } from "@/discovery/lane";
import type { Bearing } from "@/goals/bearings";
import { layoutMap, mapOf } from "@/goals/map";
import type { Notice } from "@/hub/checks";
import clsx from "clsx";
import type { SourceRecord } from "@/discovery/sources";
import { useGoals } from "@/goals/client";
import type { OrgRef } from "@/org/client";
import { useOrgContext } from "@/org/context";
import { browserProjectsToMove, moveBrowserProjects } from "@/org/import-browser";
import { goalHref, placeHref, setupHref, spaceHref, type Project } from "@/projects/model";
import { importLegacy } from "@/projects/library";
import { Button, IconBtn } from "../controls";
import { navigate } from "../nav";
import { MapCanvas, MapWaiting, useEngine } from "../map/MapCanvas";
import { hrefOf, PickedPanel } from "../map/MapPanel";
import { MapReader } from "../map/MapReader";
import { readerWidth } from "../sources/Reader";
import { useBoardCards } from "../map/useBoardCards";
import { r } from "../recipes";
import { NeedsALook } from "../org/NeedsALook";
import { AskBar } from "../org/AskBar";
import { useOrgData } from "../org/useOrgData";
import { useNotices } from "../notices/useNotices";
import { useTopics } from "../topics/list";
import { PageFrame } from "../frame/PageFrame";
import { useCurrentOrg } from "../frame/store";
import { useHealth } from "../frame/useHealth";
import { StatusDot } from "../viz";
import { useBearings } from "../goals/useBearings";
import { useJobs } from "../goals/useJobs";
import { inSpace } from "../frame/spaces";
import { useSpace } from "../frame/useSpace";
import { useNeeds } from "./useNeeds";
import { ProductsRow } from "./ProductsRow";
import { homeGoals } from "./YourGoals";
import { ContinueSetup, useFirstRunLeft } from "./ContinueSetup";

/**
 * A space's home (the organization's, or with `product` that product's): the map, every goal in
 * the space with its board's problems, solutions and tests under it (./map, src/goals/map.ts), as
 * the biggest thing on the page, and a panel beside it. With nothing picked the panel picks up
 * the first run while it isn't finished here (./ContinueSetup.tsx), asks what the space knows,
 * and says what needs a look, under the goal it bears on; the organization's ends with its
 * products, each opening its own space. A card picked on the map takes the panel over. Editing
 * happens on the boards; everything is saved in the organization's folder.
 */

const NONE: Bearing[] = [];
const LANES_KEY = "qalam.map.lanes";

export default function Home({ product: productId = null }: { product?: string | null }) {
  const { projects, legacy, sources, refresh } = useOrgData();
  const goalTree = useGoals();
  const org = useCurrentOrg();
  const { space } = useSpace(productId, "home");
  const notices = useNotices();
  const needs = useNeeds();
  const topics = useTopics();
  const { products, about, loaded } = useOrgContext();
  const goalCount = goalTree.goals.length;
  const left = useFirstRunLeft(sources, org?.shape);

  const links = useBearings() ?? NONE;
  const jobs = useJobs() ?? [];
  const yours = homeGoals(goalTree, space);
  const boards = useBoardCards();
  const engine = useEngine();

  const [picked, setPicked] = useState<string | null>(null);
  const [folds, setFolds] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [lanes, setLanes] = useState(() => {
    try {
      return sessionStorage.getItem(LANES_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [reading, setReading] = useState<LaneItem | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [drawer, setDrawer] = useState(false);

  const map = useMemo(
    () => (boards && goalTree.loaded ? mapOf({ tree: goalTree, boards, space, links, needs: needs?.needs ?? null, notices: (notices?.notices ?? []).filter((n) => inSpace(n.products, space)), products, folds }) : null),
    [boards, goalTree, space, links, needs, notices, products, folds],
  );
  // Laid out once the engine measures text as the painter does; each goal's lane is worked out on the map as laid.
  const laid = useMemo(() => {
    if (!map || engine !== true) return null;
    const rows = new Map<string, number>();
    if (lanes) for (const it of laneOf(map.doc, sources, map.groups).items) rows.set(it.root, (rows.get(it.root) ?? 0) + 1);
    const { doc, slots } = layoutMap(map, rows);
    const lane = laneOf(
      doc,
      sources,
      map.groups.map((g) => {
        const s = slots.get(g.head);
        return s ? { ...g, x: s.x, top: s.y } : g;
      }),
    );
    return { doc, lane };
  }, [map, engine, lanes, sources]);
  const view = useMemo(() => (map && laid ? { doc: laid.doc, faint: map.faint, tags: map.tags, noticed: map.noticed, lane: lanes ? laid.lane : null } : null), [map, laid, lanes]);
  const thing = picked ? map?.things.get(picked) : undefined;

  // What was picked went (a board changed elsewhere, another space): let go of it.
  useEffect(() => {
    if (picked && laid && !laid.doc.nodes[picked]) setPicked(null);
  }, [picked, laid]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable=true], [role=dialog]")) return;
      if (reading) setReading(null);
      else if (picked) setPicked(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [reading, picked]);

  const show = (id: string | undefined) => {
    if (!id) return;
    setPicked(id);
    setFocus({ id, n: Date.now() });
  };
  const showNotice = (n: Notice) => {
    if (!map) return;
    const topic = n.topic ? [...map.things].find(([, t]) => t.type === "problem" && t.topic === n.topic)?.[0] : undefined;
    show((n.board && n.card ? map.byCard.get(`${n.board}:${n.card}`) : undefined) ?? (n.goal && map.things.has(`goal:${n.goal}`) ? `goal:${n.goal}` : undefined) ?? topic);
  };
  const boardName = (id: string) => projects?.find((p) => p.id === id)?.name ?? boards?.find((b) => b.id === id)?.name;

  return (
    <PageFrame place="home" space={space} fill>
      <div className="relative flex h-full min-h-0">
        <div className="relative min-w-0 flex-1">
          {view && engine === true ? (
            <MapCanvas
              view={view}
              picked={picked}
              onPick={(id) => {
                setPicked(id);
                if (id) setDrawer(true);
              }}
              onOpen={(id) => {
                const t = map?.things.get(id);
                if (t) navigate(hrefOf(t));
              }}
              onFold={(id) => setFolds((m) => new Map(m).set(id, !view.doc.nodes[id]?.meta.ost?.collapsed))}
              onSource={setReading}
              focus={focus}
              viewKey={`${org?.id ?? ""}:${space ?? "org"}`}
              lanes={lanes}
              onLanes={(on) => {
                setLanes(on);
                try {
                  sessionStorage.setItem(LANES_KEY, on ? "1" : "0");
                } catch {
                  // Only this tab's view.
                }
              }}
            />
          ) : (
            <MapWaiting failed={engine === "failed"} />
          )}
          {view && !view.doc.roots.length && <EmptyMap space={space} />}
          {!drawer && (
            <button type="button" onClick={() => setDrawer(true)} className={clsx(r.buttonSm, r.buttonSecondary, "absolute top-[12px] right-[12px] shadow-floating min-[1180px]:hidden")}>
              <PanelRight size={14} absoluteStrokeWidth strokeWidth={1.25} className="mr-[6px]" />
              {notices?.notices.length ? `Needs a look · ${notices.notices.filter((n) => inSpace(n.products, space)).length}` : "Ask and more"}
            </button>
          )}
        </div>

        <aside
          aria-label={reading ? `Reading ${reading.title}` : thing ? "The picked card" : "This space"}
          className={clsx(
            "flex shrink-0 flex-col overflow-y-auto border-l border-line-subtle bg-app",
            "max-[1179px]:absolute max-[1179px]:inset-y-0 max-[1179px]:right-0 max-[1179px]:z-30 max-[1179px]:max-w-full max-[1179px]:shadow-floating",
            !drawer && !reading && "max-[1179px]:hidden",
          )}
          // A source being read takes the panel over, wider for a document than a conversation.
          style={{ width: reading ? readerWidth(reading.part?.from ?? reading.mark) : 380 }}
        >
          {reading && laid ? (
            <MapReader
              item={reading}
              lane={laid.lane}
              doc={laid.doc}
              sources={sources}
              onClose={() => setReading(null)}
              onPick={(id) => {
                setReading(null);
                show(id);
              }}
            />
          ) : thing && picked && map && laid ? (
            <PickedPanel id={picked} thing={thing} doc={laid.doc} tree={goalTree} jobs={jobs} needs={needs?.needs ?? null} lane={laid.lane} boardName={boardName} onClose={() => setPicked(null)} onRead={setReading} />
          ) : (
            <div className="flex flex-col gap-[20px] px-[16px] py-[14px]">
              <div className="flex items-center justify-end min-[1180px]:hidden">
                <IconBtn size="sm" label="Close the panel" onClick={() => setDrawer(false)}>
                  <X size={14} absoluteStrokeWidth strokeWidth={1.5} />
                </IconBtn>
              </div>
              <EngineNotice />
              <MoveFromBrowser org={org} onMoved={refresh} />

              {legacy && (
                <div role="status" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
                  <p className="text-body text-fg-muted">An older tab saved changes to your first project after it moved here.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void importLegacy().then((p) => {
                        if (p) refresh();
                      })
                    }
                  >
                    Import as a new project
                  </Button>
                </div>
              )}

              {org && left ? (
                <ContinueSetup org={org} left={left} sources={sources} stacked />
              ) : (
                left === null && <SetupNotice org={org} sources={sources} empty={loaded && !products.length && !about.audience.trim() && !about.context.trim() && !goalCount && !about.segments.length} />
              )}

              <AskBar product={space} topics={topics} />

              <NeedsALook
                now={notices}
                scope={(n) => inSpace(n.products, space)}
                projects={projects ?? []}
                topics={topics}
                groups={yours.goals.map((g) => ({ id: g.id, title: g.title, href: goalHref(g.id) }))}
                onShow={showNotice}
              />

              {space === null && !!products.length && <ProductsRow products={products} tree={goalTree} topics={topics} sources={sources} />}

              <p className="text-caption text-fg-subtle">{org ? `Saved in ${org.name}, at ${org.dir}.` : "Saved in your organization's folder."}</p>
            </div>
          )}
        </aside>
      </div>
    </PageFrame>
  );
}

/** Nothing on the map yet: where to begin. */
function EmptyMap({ space }: { space: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-[24px]">
      <div className="pointer-events-auto flex max-w-[360px] flex-col items-center gap-[10px] rounded-xl bg-raised px-[20px] py-[18px] text-center shadow-floating">
        <p className="text-body font-medium text-fg">Nothing on the map yet</p>
        <p className="text-caption text-fg-muted">{space ? "Give this product a goal, and its problems, solutions and tests show here as its board grows." : "Start with what you're trying to move: each goal shows here, with its problems, solutions and tests under it."}</p>
        <div className="flex flex-wrap justify-center gap-[6px]">
          <a href={spaceHref(space, "goals")} className={clsx(r.buttonSm, r.buttonPrimary)}>
            Set the goals
          </a>
          {!space && (
            <a href={setupHref()} className={clsx(r.buttonSm, r.buttonSecondary)}>
              Start from a brain dump
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Qalam AI can't run here: one line saying why, and where to fix it (Connections). */
function EngineNotice() {
  const { rows } = useHealth();
  const engine = rows?.find((x) => x.id === "engine");
  if (!engine) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-[12px] rounded-lg bg-raised px-[12px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="flex items-center gap-[8px] text-body text-fg">
        <StatusDot tone="bad" />
        Qalam AI <span className="text-fg-muted">· {engine.word}</span>
      </p>
      <a href={placeHref("connections")} className={clsx(r.buttonSm, r.buttonSecondary)}>
        Fix in Connections
      </a>
    </div>
  );
}

/**
 * Projects saved in this browser before Qalam saved to disk: offered once, at the address they
 * were made at, and moved into the organization (the browser keeps its copy).
 */
/** An organization with nothing about it yet can start from a brain dump about the company; one half set up picks up where it was. */
function SetupNotice({ org, sources, empty }: { org: OrgRef | null; sources: SourceRecord[]; empty: boolean }) {
  const pending = sources.filter((s) => s.setup && s.setup.phase !== "done").sort((a, b) => b.addedAt - a.addedAt)[0];
  if (!org || (!pending && !empty)) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-body text-fg-muted">
        {pending ? `Setting up ${org.name}: Qalam AI is waiting on you.` : `Tell Qalam AI about ${org.name}, and it sets up the About and the products.`}
      </p>
      <a href={pending ? `${setupHref()}?source=${pending.id}` : setupHref()} className={clsx(r.buttonSm, r.buttonSecondary)}>
        {pending ? "Pick up where you left off" : "Start from a brain dump"}
      </a>
    </div>
  );
}

function MoveFromBrowser({ org, onMoved }: { org: OrgRef | null; onMoved: () => void }) {
  const [waiting, setWaiting] = useState<Project[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => void browserProjectsToMove().then(setWaiting, () => {}), []);
  if (!org || (!waiting.length && !done)) return null;
  const move = async () => {
    setStep("Starting");
    try {
      const r = await moveBrowserProjects(setStep);
      setDone(`Moved ${r.projects} ${r.projects === 1 ? "project" : "projects"} into ${org.name}${r.systems ? `, with ${r.systems} design ${r.systems === 1 ? "system" : "systems"}` : ""}.`);
      setWaiting([]);
      onMoved();
    } catch (e) {
      setDone(`Couldn't move them: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStep(null);
    }
  };
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-body text-fg-muted">
        {done ??
          (step
            ? `Moving… ${step}`
            : `${waiting.length} ${waiting.length === 1 ? "project is" : "projects are"} saved in this browser at ${window.location.host}. Move ${waiting.length === 1 ? "it" : "them"} into ${org.name}, so ${waiting.length === 1 ? "it's" : "they're"} saved on disk and open anywhere? The browser keeps its copy.`)}
      </p>
      {!done && (
        <Button variant="secondary" size="sm" disabled={!!step} onClick={() => void move()}>
          {step ? "Moving…" : `Move into ${org.name}`}
        </Button>
      )}
    </div>
  );
}

