import { useEffect, useState } from "react";
import clsx from "clsx";
import type { SourceRecord } from "@/discovery/sources";
import { useGoals } from "@/goals/client";
import type { OrgRef } from "@/org/client";
import { useOrgContext } from "@/org/context";
import { browserProjectsToMove, moveBrowserProjects } from "@/org/import-browser";
import { goalHref, placeHref, setupHref, type Project } from "@/projects/model";
import { importLegacy } from "@/projects/library";
import { Button } from "../controls";
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
import { ProblemsList } from "../goals/ProblemsList";
import { useBearings } from "../goals/useBearings";
import { useJobs } from "../goals/useJobs";
import { inScope, withScope } from "./scope";
import { useScope } from "./useScope";
import { useNeeds } from "./useNeeds";
import { homeGoals, YourGoals } from "./YourGoals";
import { ContinueSetup, useFirstRunLeft } from "./ContinueSetup";

/**
 * An organization's home, for the product in view: picking up the first run while it isn't
 * finished here (./ContinueSetup.tsx), asking what it knows, then the goals this
 * person works on, each with the problems behind it; what needs a look, under the goal it bears
 * on; and what customers keep raising that no goal covers. Goals, problems, evidence and decisions
 * each have a place of their own in the sidebar. Everything is saved in the organization's folder.
 */

export default function Home() {
  const { projects, legacy, sources, refresh } = useOrgData();
  const goalTree = useGoals();
  const org = useCurrentOrg();
  const [scope, setScope] = useScope();
  const notices = useNotices();
  const needs = useNeeds();
  const topics = useTopics();
  const { products, about, loaded } = useOrgContext();
  const goalCount = goalTree.goals.length;
  const left = useFirstRunLeft(sources);

  const links = useBearings() ?? [];
  const jobs = useJobs() ?? [];
  const product = scope !== "all" && scope !== "org" ? products.find((p) => p.id === scope) : undefined;
  const yours = homeGoals(goalTree, (g) => inScope(g.product, scope) || g.id === goalTree.north);
  // Problems customers raise (from two sources up) that no goal is linked to.
  const uncovered = needs?.indexed ? needs.needs.filter((n) => inScope(n.products[0] ?? null, scope) && n.sources >= 2 && !links.some((l) => l.need === n.topic)) : [];

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

        {org && left ? (
          <ContinueSetup org={org} left={left} sources={sources} />
        ) : (
          left === null && <SetupNotice org={org} sources={sources} empty={loaded && !products.length && !about.audience.trim() && !about.context.trim() && !goalCount && !about.segments.length} />
        )}

        <AskBar product={product?.id ?? null} topics={topics} />

        <YourGoals tree={goalTree} shown={yours.goals} mine={yours.mine} needs={needs} links={links} jobs={jobs} />

        <NeedsALook
          now={notices}
          scope={(n) => scope === "all" || (scope === "org" ? !n.products.length : n.products.includes(scope))}
          projects={projects ?? []}
          topics={topics}
          groups={yours.goals.map((g) => ({ id: g.id, title: g.title, href: goalHref(g.id) }))}
        />

        {!!uncovered.length && (
          <section aria-labelledby="uncovered" className="flex flex-col gap-[8px]">
            <div className="flex items-end justify-between gap-[12px]">
              <div className="flex flex-col gap-[2px]">
                <h2 id="uncovered" className="text-title font-medium">
                  Problems no goal covers
                </h2>
                <p className="text-caption text-fg-subtle">What customers keep raising that no goal is linked to yet: link one from its page, or ask whether a goal is missing.</p>
              </div>
              <a href={placeHref("problems") + withScope("", scope)} className={clsx(r.buttonSm, r.buttonGhost)}>
                All problems
              </a>
            </div>
            <ProblemsList needs={uncovered} links={[]} goals={[]} projects={projects ?? []} limit={4} />
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

