import { useCallback, useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChevronRight, Frame, MoreHorizontal, Network, Palette, Plus } from "lucide-react";
import { nanoid } from "nanoid";
import type { AIStatus } from "@/ai/client";
import type { SourceRecord } from "@/discovery/sources";
import type { Topic } from "@/hub/topics";
import { topicsDb } from "@/org/topics";
import { currentOrg, orgJson, type OrgRef } from "@/org/client";
import { newProduct, saveProduct, useOrgContext } from "@/org/context";
import { contextEmpty, type Product } from "@/org/context-md";
import { statedGoals } from "@/org/goals";
import { projectsDb } from "@/projects/db";
import { browserProjectsToMove, moveBrowserProjects } from "@/org/import-browser";
import { onOrgChange } from "@/org/live";
import { getSystem } from "@/design-system/registry";
import { projectHref, setupHref, statusOf, topicHref, type Project, type ProjectType } from "@/projects/model";
import { createProject } from "@/projects/session";
import { deleteProject, hasLegacyChanges, importLegacy, listProjects, renameProjectById } from "@/projects/library";
import { QalamMark, Wordmark } from "../brand";
import { Button, Segmented } from "../controls";
import { Menu, MenuItem, MenuSeparator, SubMenu } from "../menu";
import { r } from "../recipes";
import { confirmDialog, DialogHost, promptDialog } from "../surfaces/dialog";
import { ContextCard, ContextEditorHost, editContext } from "../org/ContextEditor";
import { editPerson, PersonEditorHost } from "../org/PersonEditor";
import { PeopleList } from "../org/PeopleList";
import { LearnNext } from "../org/LearnNext";
import { Feeds } from "../org/Feeds";
import { usePeople } from "@/org/people";
import { GoalsList, type Goal } from "../org/Goals";
import { OrgSwitcher } from "../org/OrgSwitcher";
import { SourcesList } from "../org/SourcesList";
import { DecisionsList } from "../org/DecisionsList";
import { TopicsList } from "../org/TopicsList";
import { NeedsALook } from "../org/NeedsALook";
import { AskBar } from "../org/AskBar";
import { useNotices } from "../notices/useNotices";
import { useTopics } from "../topics/list";
import { useDecisions } from "../decisions/list";
import { ago } from "../time";

/**
 * An organization's home: asking what it knows, what needs a look (since the last visit), what it and its products are,
 * every board's goals, the boards, the topic pages (what the organization knows about each need,
 * segment and product), the sources, the decisions made on the boards and the people it hears
 * from, by product. Design work
 * (screens, design systems) waits below, on hold. Everything is saved in the organization's folder
 * on disk.
 */

const TYPE_LABEL: Record<ProjectType, string> = { system: "Design system", screens: "Screens", discovery: "Discovery" };
const TYPE_ICON: Record<ProjectType, typeof Frame> = { system: Palette, screens: Frame, discovery: Network };

const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [org, setOrg] = useState<OrgRef | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [scope, setScopeState] = useState<Scope>(readScope);
  const [tab, setTabState] = useState<Tab>(readTab);
  const decisions = useDecisions({ limit: 300 });
  const topics = useTopics();
  const notices = useNotices();
  const { products, about, loaded } = useOrgContext();
  const people = usePeople((s) => s.people);

  const refresh = useCallback(() => {
    void listProjects()
      .then((list) => {
        setProjects(list);
        setLegacy(hasLegacyChanges());
      })
      .catch(() => setProjects([]));
    void orgJson<Goal[]>("/goals").then(setGoals, () => {});
    void orgJson<SourceRecord[]>("/sources").then(setSources, () => {});
  }, []);

  useEffect(() => {
    refresh();
    void currentOrg().then(setOrg, () => {});
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", refresh);
    // Projects, sources and the organization changed in another window, or in the folder itself.
    const off = onOrgChange((c) => {
      if (c.kind === "project" || c.kind === "source") refresh();
      if (c.kind === "org") void currentOrg().then(setOrg, () => {});
    });
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", refresh);
    };
  }, [refresh]);

  const setTab = (t: Tab) => {
    setTabState(t);
    const u = new URL(window.location.href);
    if (t === "boards") u.searchParams.delete("tab");
    else u.searchParams.set("tab", t);
    history.replaceState(null, "", u);
  };

  const setScope = (s: Scope) => {
    setScopeState(s);
    const u = new URL(window.location.href);
    if (s === "all") u.searchParams.delete("product");
    else u.searchParams.set("product", s);
    history.replaceState(null, "", u);
  };
  const product = scope !== "all" && scope !== "org" ? products.find((p) => p.id === scope) : undefined;
  // A product deleted meanwhile (or a stale link): back to everything.
  useEffect(() => {
    if (loaded && scope !== "all" && scope !== "org" && !products.some((p) => p.id === scope)) setScope("all");
  }, [loaded, products, scope]);

  const start = async (type: ProjectType) => {
    const extra = type === "discovery" && product ? { product: product.id } : {};
    const p = await createProject(type, type === "system" ? "Untitled system" : type === "discovery" ? "Untitled board" : "Untitled", extra);
    window.location.assign(projectHref(p));
  };

  /** A page started by hand: a need or a kind of customer, for the product in view. */
  const newPage = async (kind: "need" | "segment") => {
    const title = await promptDialog({
      title: kind === "need" ? "New need" : "New segment",
      body: kind === "need" ? "A need in the customer's words: what they need, struggle with or wish for. Qalam AI files what customers say about it here." : "A kind of customer the team tells apart. Qalam AI files what's true of them here.",
      label: "Title",
      placeholder: kind === "need" ? "I can't plan my day around the delivery window" : "Parents of young children",
      confirmLabel: "Add page",
      validate: (v) => (v.trim() ? null : "Name it"),
    });
    if (!title) return;
    const now = Date.now();
    const t: Topic = { id: nanoid(10), kind, title: title.trim().replace(/\s+/g, " ").slice(0, 100), products: product ? [product.id] : [], createdAt: now, updatedAt: now, lines: [], history: [] };
    await topicsDb.put(t, null);
    window.location.assign(topicHref(t.id));
  };

  const addProduct = async () => {
    const name = await promptDialog({ title: "New product", body: "Boards and sources can be for one product, or for the whole organization.", label: "Name", placeholder: "Grocery app", confirmLabel: "Add product", validate: (v) => (v.trim() ? null : "Name it") });
    if (!name) return;
    const p = newProduct(name);
    await saveProduct(p);
    setScope(p.id);
    editContext({ kind: "product", product: p });
  };

  const boards = (projects ?? []).filter((p) => p.type === "discovery" && inScope(p.product, scope));
  const design = (projects ?? []).filter((p) => p.type !== "discovery");
  const scopedGoals = goals.filter((g) => inScope(g.product, scope));
  const stated = statedGoals(about, products).filter((g) => inScope(g.product, scope));
  const scopedSources = sources.filter((s) => inScope(s.product, scope));
  const scopedTopics = topics?.filter((t) => (scope === "all" ? true : scope === "org" ? !t.products.length : t.products.includes(scope))) ?? null;
  // A decision is for its board's product as it is now (it records the one it had then, for a board since deleted).
  const scopedDecisions = (decisions ?? []).filter((d) => inScope((projects ?? []).find((p) => p.id === d.board)?.product ?? d.product, scope));
  const orgName = org?.name ?? "Organization";

  return (
    <Tooltip.Provider delayDuration={500}>
      <div className="min-h-screen bg-app text-fg">
        <header className="flex h-[48px] items-center gap-[10px] border-b border-line-subtle px-[16px]">
          <QalamMark size={20} />
          <Wordmark />
          <span aria-hidden className="text-fg-faint">
            /
          </span>
          {org && <OrgSwitcher org={org} onRenamed={setOrg} />}
        </header>
        <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-[28px] px-[16px] py-[28px]">
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

          <nav aria-label="Products" className="flex flex-wrap items-center gap-[6px]">
            <ScopeChip on={scope === "all"} onClick={() => setScope("all")}>
              Everything
            </ScopeChip>
            <ScopeChip on={scope === "org"} onClick={() => setScope("org")} title="Boards and sources that aren't for one product">
              Whole organization
            </ScopeChip>
            {products.map((p) => (
              <ScopeChip key={p.id} on={scope === p.id} onClick={() => setScope(p.id)}>
                {p.name}
              </ScopeChip>
            ))}
            <button type="button" onClick={() => void addProduct()} className={clsx(r.button, r.buttonGhost, "h-[28px] gap-[4px] px-[8px] text-caption")}>
              <Plus size={12} absoluteStrokeWidth strokeWidth={1.25} />
              Product
            </button>
          </nav>

          <SetupNotice org={org} sources={sources} empty={loaded && !products.length && contextEmpty(about)} />

          <AskBar product={product?.id ?? null} topics={topics} />

          <NeedsALook now={notices} scope={(n) => scope === "all" || (scope === "org" ? !n.products.length : n.products.includes(scope))} projects={projects ?? []} topics={topics} />

          <LearnNext product={product?.id ?? null} />

          {product ? (
            <ContextCard title={product.name} context={product} onEdit={() => editContext({ kind: "product", product })} empty={`Tell Qalam AI what ${product.name} is: who it's for and what you're trying to move. Every board for it starts from this.`} />
          ) : (
            <ContextCard title={`About ${orgName}`} context={about} onEdit={() => editContext({ kind: "org", name: orgName, about })} empty={`Tell Qalam AI what ${orgName} does and who it serves. Every board starts from this.`} />
          )}

          <section aria-labelledby="goals" className="flex flex-col gap-[8px]">
            <h2 id="goals" className="text-title font-medium">
              Goals
            </h2>
            <GoalsList goals={scopedGoals} stated={stated} products={products} />
          </section>

          <section aria-label="Boards, topics, sources and decisions" className="flex flex-col gap-[12px]">
            <div className="flex items-center justify-between gap-[12px]">
              <Segmented
                label="Show"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "boards", label: <span className="whitespace-nowrap px-[4px]">Boards{boards.length ? ` · ${boards.length}` : ""}</span> },
                  { value: "topics", label: <span className="whitespace-nowrap px-[4px]">Topics{scopedTopics?.length ? ` · ${scopedTopics.length}` : ""}</span> },
                  { value: "sources", label: <span className="whitespace-nowrap px-[4px]">Sources{scopedSources.length ? ` · ${scopedSources.length}` : ""}</span> },
                  { value: "decisions", label: <span className="whitespace-nowrap px-[4px]">Decisions{scopedDecisions.length ? ` · ${scopedDecisions.length}` : ""}</span> },
                  { value: "people", label: <span className="whitespace-nowrap px-[4px]">People{people.length ? ` · ${people.length}` : ""}</span> },
                ]}
              />
              {tab === "boards" && (
                <Button size="sm" onClick={() => void start("discovery")}>
                  New board
                </Button>
              )}
              {tab === "people" && (
                <Button size="sm" variant="secondary" onClick={() => void editPerson(null, { product: product?.id ?? null })}>
                  New person
                </Button>
              )}
              {tab === "topics" && (
                <Menu
                  label="New page"
                  align="end"
                  className="w-[180px]"
                  trigger={
                    <button type="button" className={clsx(r.buttonSm, r.buttonSecondary)}>
                      New page
                    </button>
                  }
                >
                  <MenuItem onSelect={() => void newPage("need")}>A need…</MenuItem>
                  <MenuItem onSelect={() => void newPage("segment")}>A kind of customer…</MenuItem>
                </Menu>
              )}
            </div>
            {tab === "topics" ? (
              <TopicsList topics={scopedTopics} sources={scopedSources} products={products} onFiled={refresh} />
            ) : tab === "people" ? (
              <PeopleList people={people} sources={sources} product={product?.id ?? null} />
            ) : tab === "decisions" ? (
              <DecisionsList decisions={scopedDecisions} projects={projects ?? []} />
            ) : tab === "sources" ? (
              <div className="flex flex-col gap-[16px]">
                <Feeds products={products} product={product?.id ?? null} />
                <SourcesList sources={scopedSources} projects={projects ?? []} products={products} onChanged={refresh} />
              </div>
            ) : projects === null ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className={clsx(r.skeleton, "aspect-[4/3] rounded-lg")} />
                ))}
              </div>
            ) : boards.length === 0 ? (
              <StartTile
                icon={<Network {...ICON} />}
                title="Start a board"
                body="Map the outcome you're after, your customers' needs and the solutions to try, as a tree. Start from six questions, your research or a brain dump."
                onClick={() => void start("discovery")}
              />
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]">
                {boards.map((p) => (
                  <li key={p.id}>
                    <ProjectCard p={p} products={products} onChanged={refresh} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="group flex flex-col gap-[12px]">
            <summary className="cursor-pointer list-none text-title font-medium text-fg-muted marker:hidden hover:text-fg">
              <span className="inline-flex items-center gap-[6px]">
                <ChevronRight size={14} absoluteStrokeWidth strokeWidth={1.25} className="transition-transform group-open:rotate-90" />
                Design <span className="text-caption font-normal text-fg-subtle">· screens and design systems{design.length ? ` · ${design.length}` : ""}</span>
              </span>
            </summary>
            <div className="mt-[12px] flex flex-col gap-[16px]">
              <div className="grid gap-[12px] sm:grid-cols-2">
                <StartTile
                  icon={<Palette {...ICON} />}
                  title="Design system"
                  body="Tell Qalam AI about your brand. It proposes three directions you can shape on real screens, then saves your tokens."
                  onClick={() => void start("system")}
                />
                <StartTile icon={<Frame {...ICON} />} title="Screens" body="A blank canvas for screens and flows, with Qalam AI and your systems." onClick={() => void start("screens")} />
              </div>
              {!!design.length && (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]">
                  {design.map((p) => (
                    <li key={p.id}>
                      <ProjectCard p={p} products={products} onChanged={refresh} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>

          <p className="text-caption text-fg-subtle">{org ? `Saved in ${org.name}, at ${org.dir}.` : "Saved in your organization's folder."}</p>
        </main>
      </div>
      <ContextEditorHost />
      <PersonEditorHost />
      <DialogHost />
    </Tooltip.Provider>
  );
}

type Tab = "boards" | "topics" | "sources" | "decisions" | "people";
const TABS: Tab[] = ["boards", "topics", "sources", "decisions", "people"];
const readTab = (): Tab => {
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.includes(t as Tab) ? (t as Tab) : "boards";
};

/** Which part of the organization the home shows: everything, what's for the whole organization, or one product. */
type Scope = "all" | "org" | (string & {});
const readScope = (): Scope => new URLSearchParams(window.location.search).get("product") ?? "all";
const inScope = (product: string | null | undefined, scope: Scope) => scope === "all" || (scope === "org" ? !product : product === scope);

function ScopeChip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={clsx("q-item h-[28px] rounded-md px-[10px] text-caption font-medium", on ? "bg-raised text-fg shadow-button" : "text-fg-muted hover:bg-hover hover:text-fg")}
    >
      {children}
    </button>
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

function StartTile({ icon, title, body, onClick }: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="q-item q-press flex items-start gap-[12px] rounded-lg bg-panel p-[16px] text-left shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover"
    >
      <span className="grid size-[32px] shrink-0 place-items-center rounded-md bg-raised text-fg">{icon}</span>
      <span className="flex flex-col gap-[4px]">
        <span className="text-body font-medium text-fg">{title}</span>
        <span className="text-caption text-fg-muted">{body}</span>
      </span>
    </button>
  );
}

function ProjectCard({ p, products, onChanged }: { p: Project; products: Product[]; onChanged: () => void }) {
  const moveTo = async (product: string | null) => {
    await projectsDb.patch(p.id, { product: product ?? undefined });
    onChanged();
  };
  const href = projectHref(p);
  const TypeIcon = TYPE_ICON[p.type];
  const rename = async () => {
    const name = await promptDialog({ title: "Rename project", defaultValue: p.name, confirmLabel: "Rename", validate: (v) => (v.trim() ? null : "Name can't be empty") });
    if (name) await renameProjectById(p.id, name);
    onChanged();
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${p.name}”?`,
      body: p.type === "discovery" ? "The board and its chats are removed from the organization's folder. Its sources stay in the organization. This can't be undone." : "Its canvas and chats are removed from the organization's folder. This can't be undone.",
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    const system = p.type === "system" && p.systemId ? getSystem(p.systemId) : undefined;
    const removeSystem = system
      ? await confirmDialog({
          title: `Also remove “${system.name}” from your systems?`,
          body: "Screens in other projects that use it switch to the built-in system.",
          confirmLabel: "Remove system",
          cancelLabel: "Keep system",
          danger: true,
        })
      : false;
    await deleteProject(p, { removeSystem });
    onChanged();
  };
  return (
    <div className="flex flex-col gap-[8px]">
      <a
        href={href}
        aria-label={`Open ${p.name}`}
        className="q-item grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-stage shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
      >
        {p.thumbnail ? (
          <img src={p.thumbnail} alt="" className="max-h-[86%] max-w-[86%] rounded-sm object-contain" />
        ) : (
          <span className="text-fg-faint">
            <TypeIcon size={24} absoluteStrokeWidth strokeWidth={1.25} />
          </span>
        )}
      </a>
      <div className="flex items-start justify-between gap-[8px] px-[2px]">
        <div className="min-w-0">
          <a href={href} className="block truncate text-body font-medium text-fg hover:underline">
            {p.name}
          </a>
          <p className="flex items-center gap-[6px] text-caption text-fg-muted">
            <span>{TYPE_LABEL[p.type]}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{p.type === "system" ? statusOf(p) : `${statusOf(p)} · ${ago(p.updatedAt)}`}</span>
          </p>
        </div>
        <Menu
          label="Project actions"
          align="end"
          className="w-[180px]"
          trigger={
            <button type="button" aria-label={`Actions for ${p.name}`} className={clsx(r.iconButton, "shrink-0")}>
              <MoreHorizontal {...ICON} />
            </button>
          }
        >
          <MenuItem onSelect={() => window.location.assign(href)}>Open</MenuItem>
          <MenuItem onSelect={() => void rename()}>Rename…</MenuItem>
          {p.type === "discovery" && (
            <SubMenu label="For" checks>
              <MenuItem checked={!p.product} onSelect={() => void moveTo(null)}>
                The whole organization
              </MenuItem>
              {products.map((x) => (
                <MenuItem key={x.id} checked={p.product === x.id} onSelect={() => void moveTo(x.id)}>
                  {x.name}
                </MenuItem>
              ))}
            </SubMenu>
          )}
          <MenuSeparator />
          <MenuItem danger onSelect={() => void remove()}>
            Delete…
          </MenuItem>
        </Menu>
      </div>
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
