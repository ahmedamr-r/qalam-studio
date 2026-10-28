import { useEffect, useState } from "react";
import clsx from "clsx";
import type { SourceRecord } from "@/discovery/sources";
import type { OrgRef } from "@/org/client";
import { useOrgContext } from "@/org/context";
import { browserProjectsToMove, moveBrowserProjects } from "@/org/import-browser";
import { placeHref, setupHref, type Project } from "@/projects/model";
import { importLegacy } from "@/projects/library";
import { Button } from "../controls";
import { r } from "../recipes";
import { ContextCard, editContext } from "../org/ContextEditor";
import { GoalsList } from "../org/Goals";
import { NeedsALook } from "../org/NeedsALook";
import { AskBar } from "../org/AskBar";
import { useOrgData } from "../org/useOrgData";
import { useNotices } from "../notices/useNotices";
import type { NoticesNow } from "@/org/notices";
import { useTopics } from "../topics/list";
import { PageFrame } from "../frame/PageFrame";
import { useCurrentOrg } from "../frame/store";
import { useHealth } from "../frame/useHealth";
import { StatusDot } from "../viz";
import { ProjectCard } from "../places/ProjectCard";
import { inScope, withScope } from "./scope";
import { useScope } from "./useScope";
import { useNeeds } from "./useNeeds";
import { NextUp } from "./NextUp";

/**
 * An organization's home, for the product in view: asking what it knows, what needs a look (since
 * the last visit), what it and its products are, every board's goals and the boards opened last.
 * The boards, topic pages, sources and decisions each have a place of their own in the sidebar.
 * Everything is saved in the organization's folder on disk.
 */

export default function Home() {
  const { projects, legacy, goals, sources, refresh } = useOrgData();
  const org = useCurrentOrg();
  const [scope, setScope] = useScope();
  const notices = useNotices();
  const needs = useNeeds();
  const topics = useTopics();
  const { products, about, loaded } = useOrgContext();

  const product = scope !== "all" && scope !== "org" ? products.find((p) => p.id === scope) : undefined;
  const boards = (projects ?? []).filter((p) => p.type === "discovery" && inScope(p.product, scope));
  const scopedGoals = goals.filter((g) => inScope(g.product, scope));
  const orgName = org?.name ?? "Organization";

  return (
    <PageFrame place="home" scope={scope} onScope={setScope}>
      <div className={clsx(r.pageMain, "max-w-[1080px]")}>
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

        <SetupNotice org={org} sources={sources} empty={loaded && !products.length && !about.audience.trim() && !about.context.trim() && !about.goals.length && !about.segments.length} />

        <AskBar product={product?.id ?? null} topics={topics} />

        <NextUp now={needs} scope={scope} projects={projects ?? []} />

        <NeedsALook now={withoutRanked(notices)} scope={(n) => scope === "all" || (scope === "org" ? !n.products.length : n.products.includes(scope))} projects={projects ?? []} topics={topics} />

        {product ? (
          <ContextCard title={product.name} context={product} onEdit={() => editContext({ kind: "product", product })} empty={`Tell Qalam AI what ${product.name} is: who it's for and what you're trying to move. Every board for it starts from this.`} />
        ) : (
          <ContextCard title={`About ${orgName}`} context={about} onEdit={() => editContext({ kind: "org", name: orgName, about })} empty={`Tell Qalam AI what ${orgName} does and who it serves. Every board starts from this.`} />
        )}

        <section aria-labelledby="goals" className="flex flex-col gap-[8px]">
          <h2 id="goals" className="text-title font-medium">
            Goals
          </h2>
          {scopedGoals.length ? <GoalsList goals={scopedGoals} /> : <p className="text-body text-fg-muted">No outcomes yet. Every outcome on a board shows here, with the board it's on.</p>}
        </section>

        {!!boards.length && (
          <section aria-labelledby="recent-boards" className="flex flex-col gap-[12px]">
            <div className="flex items-center justify-between gap-[12px]">
              <h2 id="recent-boards" className="text-title font-medium">
                Boards
              </h2>
              <a href={placeHref("boards") + withScope("", scope)} className={clsx(r.buttonSm, r.buttonGhost)}>
                All {boards.length}
              </a>
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]">
              {boards.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <ProjectCard p={p} products={products} onChanged={refresh} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-caption text-fg-subtle">{org ? `Saved in ${org.name}, at ${org.dir}.` : "Saved in your organization's folder."}</p>
      </div>
    </PageFrame>
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

/** Needs on no board are What to work on next's ○ rows: Needs a look leaves them out. */
const withoutRanked = (n: NoticesNow | null): NoticesNow | null => n && { ...n, notices: n.notices.filter((x) => x.kind !== "pattern") };
