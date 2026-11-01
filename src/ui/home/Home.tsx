import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PanelRight, X } from "lucide-react";
import type { Bearing } from "@/goals/bearings";
import type { Notice } from "@/hub/checks";
import clsx from "clsx";
import type { SourceRecord } from "@/discovery/sources";
import { studio, useStudio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { useGoals } from "@/goals/client";
import type { OrgRef } from "@/org/client";
import { useOrgContext } from "@/org/context";
import { browserProjectsToMove, moveBrowserProjects } from "@/org/import-browser";
import { goalHref, placeHref, setupHref, spaceHref, type Project } from "@/projects/model";
import { importLegacy } from "@/projects/library";
import type { SpaceInputs } from "@/space/session";
import { useSpaceView } from "@/space/view";
import { cardForPage } from "@/space/pages";
import { Button, IconBtn } from "../controls";
import LaneReader, { useReaderWidth } from "../discovery/LaneReader";
import CordPicker from "../discovery/CordPicker";
import QuotePicker from "../discovery/QuotePicker";
import { useDiscovery } from "../discovery/store";
import { useReview } from "../discovery/review";
import { SpaceCardPanel } from "../space/SpacePanel";
import { show as showCard } from "../space/links";
import { closePage, usePanelPage } from "../space/page";
import { useMoves } from "../nav";
import { SpaceConflictBanner } from "../space/ConflictBanner";
import { r } from "../recipes";
import { NeedsALook } from "../org/NeedsALook";
import { LabSections, SpacePages, SpaceProblems, UnplacedGoals } from "./SpaceSections";
import { addMaterial, writeCard } from "../space/new";
import { CanvasChat, ChatPill } from "../space/chat/CanvasChat";
import { findWith } from "../space/chat/store";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { useOrgData } from "../org/useOrgData";
import { useNotices } from "../notices/useNotices";
import { useTopics } from "../topics/list";
import { PageFrame } from "../frame/PageFrame";
import { useCurrentOrg, useFrame } from "../frame/store";
import { useHealth } from "../frame/useHealth";
import { StatusDot } from "../viz";
import { useBearings } from "../goals/useBearings";
import { useJobs } from "../goals/useJobs";
import { inSpace } from "../frame/spaces";
import { useSpace } from "../frame/useSpace";
import { glideToLayer, onCanvasReady } from "../discovery/canvas";
import { SpaceCanvas } from "../space/SpaceCanvas";
import { useWide, WIDE } from "../chat/Panels";
import { useNeeds } from "./useNeeds";
import { lab } from "@/lab";
import { homeGoals } from "./goals";
import { ContinueSetup, useFirstRunLeft } from "./ContinueSetup";

/**
 * A space's home (the organization's, or with `product` that product's): its canvas, every goal
 * in the space with its board's problems, solutions and tests under it (src/space), as the biggest
 * thing on the page, where the trees are worked on in place; Qalam AI's chat on its left
 * (../space/chat/), and a panel on its right. With nothing picked the panel picks up the first run
 * while it isn't finished here (./ContinueSetup.tsx) and shows what the space holds: its problems,
 * what needs a look under the goal it bears on, its pages. A card picked on the canvas takes the
 * panel over, and a goal's or a problem's page opens in it (?goal=, ?page=; picking a card lies
 * over it, and letting the card go shows it again). Everything is saved in the organization's
 * folder, each card on its own board.
 */

const NONE: Bearing[] = [];

// A goal's or a topic page's page, open in the panel (../space/page.tsx).
const GoalView = lazy(() => import("../goals/GoalPage"));
const TopicView = lazy(() => import("../topics/TopicPage"));
/** How wide the panel is for a page. */
const PAGE_W = 480;
/** Below this the chat lies over the canvas instead of beside it. */
const CHAT_DOCKS = 900;

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
  // A goal's next job is hidden in v0.1 (src/lab.ts) with the rest of its jobs.
  const allJobs = useJobs() ?? [];
  const jobs = lab("goals") ? allJobs : [];
  const yours = homeGoals(goalTree, space);

  const scoped = useMemo(() => (notices?.notices ?? []).filter((n) => inSpace(n.products, space)), [notices, space]);
  // What the canvas is composed from (besides the boards): waits for the goals and the problems.
  const inputs = useMemo<SpaceInputs | null>(() => (goalTree.loaded && needs !== undefined ? { tree: goalTree, links, needs: needs?.needs ?? null, notices: scoped, products } : null), [goalTree, links, needs, scoped, products]);

  const things = useSpaceView((s) => s.things);
  const selection = useStudio((s) => s.selection);
  const empty = useStudio((s) => !s.doc.roots.length);
  // Qalam AI's proposals drawn on an empty canvas: the start card steps aside until they're settled.
  const proposing = useReview((s) => s.proposals.length > 0);
  // Cards picked on the canvas (all of them cards on it) take the panel over; a source read, or a cord's quotes picked, take it over too.
  const allCards = useStudio((s) => s.selection.length > 0 && s.selection.every((id) => isOstCard(s.doc.nodes[id])));
  const picked = allCards ? selection : null;
  const reading = useDiscovery((s) => s.reading);
  const cordPick = useDiscovery((s) => !!s.cordPick);
  const quotePick = useDiscovery((s) => !!s.quotePick);
  const readerW = useReaderWidth();
  const [drawer, setDrawer] = useState(false);
  const aside = useRef<HTMLElement>(null);

  // A page opened (or asked for again): it takes the panel, its card comes into view without being picked.
  const open = usePanelPage();
  const openKey = open ? ("goal" in open.ref ? `goal:${open.ref.goal}` : `page:${open.ref.page}`) : null;
  const moves = useMoves();
  useEffect(() => {
    if (!open) return;
    studio().select([]);
    setDrawer(true);
    const card = cardForPage(open.ref, useSpaceView.getState().things);
    if (card) showCard(card, { select: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per page opened, and per move to it
  }, [openKey, moves]);
  useEffect(() => {
    if (aside.current) aside.current.scrollTop = 0;
  }, [openKey]);
  const showsPage = !!open && !cordPick && !quotePick && !reading && !picked;

  useEffect(() => {
    if (picked || reading || cordPick || quotePick) setDrawer(true);
  }, [picked, reading, cordPick, quotePick]);
  // A narrow window's panel lies over the canvas: what's drawn beside a card keeps out of it.
  const wide = useWide(WIDE);
  const chatOpen = useFrame((s) => s.chat);
  const chatDocks = useWide(CHAT_DOCKS);
  const panelW = reading && readerW ? readerW : showsPage ? PAGE_W : 380;
  const over = !wide && (drawer || !!reading) ? panelW : 0;
  useEffect(() => useDiscovery.setState({ inset: over }), [over]);
  useEffect(() => () => useDiscovery.setState({ inset: 0 }), []);

  const show = (id: string | undefined) => {
    if (!id || !studio().doc.nodes[id]) return;
    studio().select([id]);
    onCanvasReady((c) => glideToLayer(c, id));
  };
  const showNotice = (n: Notice) => {
    const v = useSpaceView.getState();
    const card = (b?: string, c?: string) => (b && c && v.boardOf.get(c) === b ? c : undefined);
    const goal = n.goal ? [...v.things].find(([, t]) => t.type === "goal" && t.goal === n.goal)?.[0] : undefined;
    const topic = n.topic ? [...v.things].find(([, t]) => t.type === "problem" && t.topic === n.topic)?.[0] : undefined;
    show(card(n.board, n.card) ?? card(n.other?.board, n.other?.card) ?? goal ?? topic);
  };
  return (
    <PageFrame place="home" space={space} fill>
      <div className="relative flex h-full min-h-0">
        {chatOpen && <CanvasChat space={space} over={!chatDocks} />}
        <div className="relative min-w-0 flex-1">
          <SpaceCanvas org={org?.id ?? null} space={space} inputs={inputs} sources={sources} />
          {inputs && empty && !proposing && <EmptyMap space={space} />}
          {!chatOpen && <ChatPill />}
          <SpaceConflictBanner />
          {!drawer && (
            <button type="button" onClick={() => setDrawer(true)} className={clsx(r.buttonSm, r.buttonSecondary, "absolute top-[12px] right-[12px] shadow-floating min-[1180px]:hidden")}>
              <PanelRight size={14} absoluteStrokeWidth strokeWidth={1.25} className="mr-[6px]" />
              {notices?.notices.length ? `Needs a look · ${notices.notices.filter((n) => inSpace(n.products, space)).length}` : "More"}
            </button>
          )}
        </div>

        <aside
          ref={aside}
          aria-label={reading ? "Reading a source" : picked ? "The picked card" : showsPage ? "A page" : "This space"}
          // Esc closes a page (not while a field or a menu takes it).
          onKeyDown={(e) => {
            if (!showsPage || e.key !== "Escape" || e.defaultPrevented || (e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
            e.stopPropagation();
            closePage();
          }}
          className={clsx(
            "flex shrink-0 flex-col overflow-y-auto border-l border-line-subtle bg-app",
            "max-[1179px]:absolute max-[1179px]:inset-y-0 max-[1179px]:right-0 max-[1179px]:z-30 max-[1179px]:max-w-full max-[1179px]:shadow-floating",
            !drawer && !reading && "max-[1179px]:hidden",
          )}
          // A source being read takes the panel over, wider for a document than a conversation.
          style={{ width: panelW }}
        >
          {cordPick ? (
            <CordPicker />
          ) : quotePick ? (
            <QuotePicker />
          ) : reading ? (
            <LaneReader />
          ) : picked ? (
            <SpaceCardPanel ids={picked} things={things} tree={goalTree} jobs={jobs} needs={needs?.needs ?? null} />
          ) : open ? (
            <Suspense fallback={<div className={clsx(r.skeleton, "m-[16px] h-[120px] rounded-lg")} aria-hidden />}>
              {"goal" in open.ref ? <GoalView key={open.ref.goal} id={open.ref.goal} space={space} at={open.at} /> : <TopicView key={open.ref.page} id={open.ref.page} space={space} />}
            </Suspense>
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

              <UnplacedGoals tree={goalTree} space={space} />

              <SpaceProblems space={space} needs={needs} links={links} tree={goalTree} sources={sources} onFiled={refresh} />

              <NeedsALook
                now={notices}
                scope={(n) => inSpace(n.products, space)}
                projects={projects ?? []}
                topics={topics}
                groups={yours.goals.map((g) => ({ id: g.id, title: g.title, href: goalHref(g.id) }))}
                onShow={showNotice}
              />

              <SpacePages space={space} topics={topics} sources={sources} products={products} onFiled={refresh} />

              <LabSections space={space} products={products} projects={projects ?? []} onChanged={refresh} />

              <p className="text-caption text-fg-subtle">{org ? `Saved in ${org.name}, at ${org.dir}.` : "Saved in your organization's folder."}</p>
            </div>
          )}
        </aside>
      </div>
    </PageFrame>
  );
}

/** Nothing on the canvas yet: a goal or a problem, written on the canvas or found with Qalam AI in the chat. */
function EmptyMap({ space }: { space: string | null }) {
  const rows = [
    { what: "goal", kind: "outcome", title: "A goal", body: "What the team is trying to move." },
    { what: "problem", kind: "opportunity", title: "A problem", body: "What customers need, struggle with or wish for." },
  ] as const;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-[24px]">
      <div className="pointer-events-auto flex w-[min(420px,100%)] flex-col gap-[12px] rounded-xl bg-raised px-[18px] py-[16px] shadow-floating">
        <div className="flex flex-col gap-[4px] text-center">
          <p className="text-body font-medium text-fg">Start with a goal or a problem</p>
          <p className="text-caption text-fg-muted">{space ? "This product's goals and problems show here, with their solutions and tests under them." : "Each goal shows here with the problems behind it, and their solutions and tests under them."}</p>
        </div>
        {rows.map((x) => (
          <div key={x.what} className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[8px] rounded-lg bg-panel px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            <span className="flex min-w-0 flex-col">
              <span className="text-body font-medium text-fg">{x.title}</span>
              <span className="text-caption text-fg-muted">{x.body}</span>
            </span>
            <span className="flex shrink-0 gap-[6px]">
              <button type="button" onClick={() => writeCard(x.kind, { under: null })} className={clsx(r.buttonSm, r.buttonSecondary)}>
                Write it
              </button>
              <button type="button" onClick={() => findWith(x.what, space)} className={clsx(r.buttonSm, r.buttonSecondary, "gap-[6px]")}>
                <QalamAIGlyph size={12} /> Help me find one
              </button>
            </span>
          </div>
        ))}
        <p className="text-center text-caption text-fg-subtle">
          Or paste your thinking in the chat, or{" "}
          <button type="button" onClick={addMaterial} className="text-fg-muted underline decoration-fg/20 underline-offset-2 hover:text-fg">
            add what customers said
          </button>
          .
        </p>
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
  // Starting from a brain dump is one of the doors v0.1 hides (src/lab.ts); one half done still picks up.
  if (!org || (!pending && (!empty || !lab("doors")))) return null;
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

