import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import type { AIStatus } from "@/ai/client";
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
import { useTopics } from "../topics/list";
import { PageFrame } from "../frame/PageFrame";
import { useCurrentOrg } from "../frame/store";
import { ProjectCard } from "../places/ProjectCard";
import { inScope, withScope } from "./scope";
import { useScope } from "./useScope";

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
  const topics = useTopics();
  const { products, about, loaded } = useOrgContext();

  const product = scope !== "all" && scope !== "org" ? products.find((p) => p.id === scope) : undefined;
  const boards = (projects ?? []).filter((p) => p.type === "discovery" && inScope(p.product, scope));
  const scopedGoals = goals.filter((g) => inScope(g.product, scope));
  const orgName = org?.name ?? "Organization";

  return (
    <PageFrame place="home" scope={scope} onScope={setScope}>
      <div className={clsx(r.pageMain, "max-w-[1080px]")}>
        <ClaudeNotice />
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

        <NeedsALook now={notices} scope={(n) => scope === "all" || (scope === "org" ? !n.products.length : n.products.includes(scope))} projects={projects ?? []} topics={topics} />

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

type ClaudeCheck = NonNullable<AIStatus["claude"]>;

/** Qalam AI runs on the user's own Claude Code: say what to do first when it's missing or signed out. */
function ClaudeNotice() {
  const [claude, setClaude] = useState<ClaudeCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(() => {
    setChecking(true);
    void fetch("/api/status")
      .then((r) => r.json() as Promise<AIStatus>)
      .then((s) => setClaude(s.backend === "cli" ? (s.claude ?? null) : null))
      .catch(() => setClaude(null))
      .finally(() => setChecking(false));
  }, []);
  useEffect(check, [check]);
  if (!claude || (claude.found && claude.signedIn !== false)) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-body text-fg-muted">
        {claude.found ? (
          <>
            Qalam AI runs on your own Claude Code, which isn't signed in. Run <code className="font-mono text-fg">claude auth login</code> in a terminal, then check again.
          </>
        ) : (
          <>
            Qalam AI runs on your own Claude Code, which isn't installed.{" "}
            <a className="text-fg underline" href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noreferrer">
              Install it
            </a>
            , run <code className="font-mono text-fg">claude auth login</code>, then check again.
          </>
        )}
      </p>
      <Button variant="secondary" size="sm" disabled={checking} onClick={check}>
        {checking ? "Checking…" : "Check again"}
      </Button>
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
        {pending
          ? `You were setting ${org.name} up from a brain dump: Qalam AI is waiting on you.`
          : `Tell Qalam AI about ${org.name}: write what the company does, its products and its goals, and it sets up the About and the products for you to accept.`}
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
