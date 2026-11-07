import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, Copy, Database as DatabaseIcon, RotateCcw, X } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { parseConnection, readerSql } from "@/database/connection";
import type { Draft, DraftAnswer, DraftQuestion } from "@/database/draft";
import { formatValue, shortColumn } from "@/database/format";
import { KIND_LABEL } from "@/database/local";
import type { KnownAnswer } from "@/memory/known";
import type { Checked } from "@/database/view";
import type { MetricView } from "@/database/view";
import { connectorsDb } from "@/org/connectors";
import { databaseDb, loadDatabase, useDatabase, type ConnectAnswer } from "@/org/database";
import { rememberRound, withKnownAnswers } from "@/org/memory";
import { loadGoals, useGoals } from "@/goals/client";
import { KnownStrip } from "../ai/KnownStrip";
import { Button, IconBtn, Segmented, Spinner } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";

/**
 * The team's database on Connections, read-only. Connect it with a read-only user's string (kept in
 * the Keychain); Qalam reads how it's laid out with no tokens, Qalam AI drafts the numbers it could
 * track, each with its exact query, and each is checked here beside a sample before anything uses it.
 * The numbers kept show where each stands on this computer.
 */

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const MEMORY = { flow: "metrics" as const, key: "database", about: { product: null } };

/** Sign out of Supabase on this computer: Supabase is asked to drop the tokens, then the Keychain forgets them. */
const signOutOfSupabase = async () => {
  await connectorsDb.forget("supabase");
  await loadDatabase();
};

function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (label: string, fn: (say: (l: string) => void) => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn((l) => setBusy(l));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run, setError };
}

export function DatabaseCard() {
  const { view, loaded, error } = useDatabase();
  useEffect(() => {
    void loadDatabase();
    // Each draft names the goal it's for.
    if (!useGoals.getState().loaded) void loadGoals();
  }, []);
  if (!loaded) return <div className={clsx(r.skeleton, "h-[120px] rounded-lg")} aria-hidden />;
  const c = view?.connection ?? null;
  return (
    <section aria-label="Database" className="flex flex-col gap-[12px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-caption text-fg-muted">
        Read-only. Qalam reads how your database is laid out, Qalam AI drafts the business numbers it could track (revenue, orders, refunds, margin) with the exact query for each, and a query runs only once someone on this computer checks it beside a sample. No row goes to Qalam AI.
      </p>
      {error && <p className="text-caption text-danger">{error}</p>}
      {c ? <Connected /> : <ConnectForm />}
      {c && <Layout />}
      {c && view?.layout && <Drafts />}
      {!!view?.metrics.length && <Metrics />}
    </section>
  );
}

function ConnectForm() {
  const [how, setHow] = useState<"string" | "supabase">("string");
  return (
    <div className="flex flex-col gap-[8px]">
      <Segmented
        label="Connect with"
        value={how}
        onChange={setHow}
        options={[
          { value: "string", label: "A connection string" },
          { value: "supabase", label: "Supabase" },
        ]}
      />
      {how === "string" ? <StringForm /> : <SupabaseForm />}
    </div>
  );
}

/** Supabase: Qalam's own sign-in to Supabase's server, then one project picked; its queries go only there, read-only. */
function SupabaseForm() {
  const signedIn = useDatabase((s) => s.view?.supabase.signedIn ?? false);
  const [page, setPage] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ ref: string; name: string; region?: string }[] | null>(null);
  const [writes, setWrites] = useState<Extract<ConnectAnswer, { state: "writes" }> | null>(null);
  const [picked, setPicked] = useState<{ ref: string; name: string } | null>(null);
  const { busy, error, run } = useRun();
  const signIn = () =>
    run("Waiting for you to sign in with Supabase in your browser", async () => {
      await connectorsDb.signIn("supabase", (url) => setPage(url));
      setPage(null);
      await loadDatabase();
    });
  const list = () => run("Asking Supabase for your projects", async () => setProjects(await databaseDb.supabaseProjects()));
  const signOut = () => run("Signing out of Supabase", () => signOutOfSupabase().then(() => setProjects(null)));
  useEffect(() => {
    if (signedIn && !projects) void list();
  }, [signedIn]);
  const pick = (p: { ref: string; name: string }, anyway = false) =>
    run(`Connecting ${p.name}`, async () => {
      setPicked(p);
      const r = await databaseDb.connectSupabase(p.ref, p.name, anyway);
      if (r.state === "writes") return setWrites(r);
      feedback(`Connected ${p.name}. Qalam only reads it.`, { kind: "success", id: "database.connect" });
    });
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-caption text-fg-muted">
        Supabase's sign-in reaches the organization you pick on its page, with read-only scopes. Qalam keeps it in this computer's Keychain and sends only read-only queries, to the one project you pick, where they run as Supabase's read-only role and count every row.
      </p>
      {!signedIn ? (
        <Button size="sm" className="self-start" disabled={!!busy} onClick={() => void signIn()}>
          Sign in with Supabase
        </Button>
      ) : (
        <div className="flex flex-col gap-[2px]">
          <span className="text-micro text-fg-subtle">Which project?</span>
          {projects?.map((p) => (
            <button key={p.ref} type="button" disabled={!!busy} onClick={() => void pick(p)} className="q-item flex items-center gap-[8px] rounded-md px-[6px] py-[4px] text-left hover:bg-hover">
              <DatabaseIcon {...ICON} className="shrink-0 text-fg-subtle" />
              <span className="min-w-0 flex-1 truncate text-caption text-fg">{p.name}</span>
              <span className="shrink-0 font-mono text-micro text-fg-subtle">{p.region ?? p.ref}</span>
            </button>
          ))}
          {projects && !projects.length && <p className="text-caption text-fg-muted">Your Supabase sign-in reaches no project.</p>}
          <button type="button" disabled={!!busy} onClick={() => void signOut()} className={clsx(r.buttonSm, r.buttonGhost, "self-start")}>
            Sign out of Supabase
          </button>
        </div>
      )}
      {page && (
        <p className="text-caption text-fg-muted">
          Supabase's page opened in your browser.{" "}
          <a href={page} target="_blank" rel="noreferrer" className="text-fg underline">
            Open it again
          </a>
        </p>
      )}
      {writes && (
        <div role="alert" className="flex flex-col gap-[6px] rounded-lg bg-warning-subtle px-[10px] py-[8px]">
          <p className="text-caption text-fg">{writes.user} can change {plural(writes.writesCount, "table")} in this project. Qalam only reads, but it expected Supabase's read-only role.</p>
          <span className="flex gap-[6px]">
            <Button size="sm" variant="secondary" disabled={!!busy || !picked} onClick={() => picked && void pick(picked, true)}>
              Use it anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWrites(null)}>
              Cancel
            </Button>
          </span>
        </div>
      )}
      <Status busy={busy} error={error} />
    </div>
  );
}

function StringForm() {
  const [url, setUrl] = useState("");
  const [ca, setCa] = useState("");
  const [showCa, setShowCa] = useState(false);
  const [writes, setWrites] = useState<Extract<ConnectAnswer, { state: "writes" }> | null>(null);
  const { busy, error, run } = useRun();
  const parsed = url.trim() ? parseConnection(url) : null;
  const kind = parsed && !("why" in parsed) ? parsed.kind : url.trim().startsWith("mysql") ? "mysql" : "postgres";
  const supabase = /supabase\.(co|com)/.test(url);
  const connect = (anyway = false) =>
    run(anyway ? "Connecting it" : "Checking it", async () => {
      const r = await databaseDb.connect({ url, ...(ca.trim() ? { ca } : {}), anyway });
      if (r.state === "writes") return setWrites(r);
      setWrites(null);
      setUrl("");
      feedback("Connected. Qalam only reads it.", { kind: "success", id: "database.connect" });
    });
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className={clsx(r.field, "h-[30px] min-w-[260px] flex-1")}>
          <input type="password" autoComplete="off" spellCheck={false} value={url} onChange={(e) => (setUrl(e.target.value), setWrites(null))} placeholder="postgres://reader:password@host:5432/database" aria-label="The connection string" className={r.fieldInput} />
        </span>
        <Button size="sm" disabled={!parsed || "why" in parsed || !!busy} onClick={() => void connect()}>
          Connect
        </Button>
      </div>
      {parsed && "why" in parsed && <p className="text-caption text-fg-muted">{parsed.why}</p>}
      <p className="text-caption text-fg-muted">
        Postgres or MySQL, with a user that can only read. The string stays in this computer's Keychain.{" "}
        {supabase && "On Supabase, use the session pooler's string (Connect → Session pooler), and add its certificate. "}
        {!showCa && (
          <button type="button" className="text-fg underline" onClick={() => setShowCa(true)}>
            Add a CA certificate
          </button>
        )}
      </p>
      {showCa && <textarea value={ca} onChange={(e) => setCa(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" aria-label="The server's CA certificate" rows={4} className={clsx(r.textarea, "w-full font-mono text-micro")} spellCheck={false} />}
      <Fold label="Make a user that can only read">
        <Sql text={readerSql(supabase ? "supabase" : kind, parsed && !("why" in parsed) ? parsed.database : undefined)} />
      </Fold>
      {writes && (
        <div role="alert" className="flex flex-col gap-[6px] rounded-lg bg-warning-subtle px-[10px] py-[8px]">
          <p className="text-caption text-fg">
            {writes.superuser ? `${writes.user} can change anything in this database.` : `${writes.user} can change ${plural(writes.writesCount, "table")}: ${writes.writes.join(", ")}${writes.writesCount > writes.writes.length ? ", …" : ""}.`} Qalam only reads, each query in a read-only transaction, but a user that can only read is safer: give it the SQL above.
          </p>
          <span className="flex gap-[6px]">
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void connect(true)}>
              Use it anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWrites(null)}>
              Cancel
            </Button>
          </span>
        </div>
      )}
      <Status busy={busy} error={error} />
    </div>
  );
}

function Connected() {
  const c = useDatabase((s) => s.view?.connection)!;
  const { busy, error, run } = useRun();
  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex items-center gap-[8px]">
        <DatabaseIcon size={14} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-body text-fg">{c.label}</span>
        <span className="shrink-0 text-caption text-fg-muted">{[KIND_LABEL[c.kind], c.version?.replace(/^(PostgreSQL|MySQL)\s*/i, "")].filter(Boolean).join(" ")}</span>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("Disconnecting", () => databaseDb.forget().then(() => {}))}>
          Disconnect
        </Button>
        {c.kind === "supabase" && (
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("Signing out of Supabase", () => databaseDb.forget().then(signOutOfSupabase))}>
            Sign out of Supabase
          </Button>
        )}
      </div>
      {c.canWrite && <p className="text-caption text-warning">{c.user} can change the database{c.writes?.length ? ` (${c.writes.join(", ")})` : ""}. You let it in anyway: every query still runs read-only.</p>}
      {!!c.hidden?.length && <p className="text-caption text-fg-muted">Row-level security hides rows of {c.hidden.join(", ")} from {c.user}, so numbers there can't be read. Give the user BYPASSRLS to count every row.</p>}
      <Status busy={busy} error={error} />
    </div>
  );
}

function Layout() {
  const l = useDatabase((s) => s.view?.layout ?? null);
  const { busy, error, run } = useRun();
  const read = () => run("Reading how it's laid out", (say) => databaseDb.readLayout(say).then(() => {}));
  return (
    <div className="flex flex-col gap-[4px] border-t border-line-subtle pt-[10px]">
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 text-caption text-fg-muted">
          {l ? `Read ${ago(l.at)}: ${plural(l.tables, "table")}, ${plural(l.personal, "personal column")} kept back, ${plural(l.sampled, "column")} like status sampled.` : "Qalam hasn't read how it's laid out yet. It reads names, types, keys and a few status values, no tokens and no rows."}
        </span>
        <Button size="sm" variant={l ? "ghost" : "secondary"} disabled={!!busy} onClick={() => void read()}>
          {l ? (
            <>
              <RotateCcw {...ICON} /> Read again
            </>
          ) : (
            "Read how it's laid out"
          )}
        </Button>
      </div>
      <Status busy={busy} error={error} />
    </div>
  );
}

function Drafts() {
  const view = useDatabase((s) => s.view)!;
  const d = view.drafts;
  const { busy, error, run } = useRun();
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>({});
  const draft = (with_: DraftAnswer[] = []) =>
    run("Asking Qalam AI", async (say) => {
      if (with_.length) await rememberRound({ ...MEMORY, answers: with_.map((a) => ({ qid: a.id, q: a.question, a: a.answer, how: a.how })) });
      await databaseDb.draft(with_, say);
      setAnswers({});
    });
  const answered = Object.values(answers).filter((a) => a.how === "unknown" || a.answer.trim());
  return (
    <div className="flex flex-col gap-[10px] border-t border-line-subtle pt-[10px]">
      <div className="flex items-center gap-[8px]">
        <h3 className="min-w-0 flex-1 text-caption font-medium text-fg">{d?.drafts.length ? `${plural(d.drafts.length, "number")} to check` : "Numbers to check"}</h3>
        <Button size="sm" variant={d ? "ghost" : "secondary"} disabled={!!busy} onClick={() => void draft()}>
          {d ? "Draft again" : "Draft the numbers"}
        </Button>
      </div>
      {!d && !busy && <p className="text-caption text-fg-muted">Qalam AI reads the layout (never a row) and drafts the numbers your goals need, each with its query. Code checks every query before it runs, and runs each once, read-only, so you see what it gives.</p>}
      {d?.drafts.map((x) => <DraftCard key={x.id} d={x} home={view.metrics[0]?.metric.dialect === "mysql" ? "" : "public"} />)}
      {!!d?.questions.length && (
        <div className="flex flex-col gap-[8px]">
          <h4 className="text-micro font-medium text-fg-subtle">What Qalam AI couldn't tell</h4>
          {d.questions.map((q) => (
            <Question key={q.id} q={q} answer={answers[q.id]} onAnswer={(a) => setAnswers((x) => ({ ...x, [q.id]: a }))} />
          ))}
          <Button size="sm" variant="secondary" className="self-start" disabled={!answered.length || !!busy} onClick={() => void draft(answered)}>
            Draft again with my answers
          </Button>
        </div>
      )}
      {!!d?.dropped.length && (
        <Fold label={`${plural(d.dropped.length, "draft")} Qalam's checks left out`}>
          <ul className="flex flex-col gap-[2px]">
            {d.dropped.map((x, i) => (
              <li key={i} className="text-caption text-fg-muted">
                <span className="text-fg">{x.name}</span>: {x.why}
              </li>
            ))}
          </ul>
        </Fold>
      )}
      <Status busy={busy} error={error} />
    </div>
  );
}

function DraftCard({ d, home }: { d: Draft; home: string }) {
  const goal = useGoals((g) => (d.goal ? g.goals.find((x) => x.id === d.goal)?.title : undefined));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const [means, setMeans] = useState(d.means);
  const [sql, setSql] = useState(d.sql);
  const { busy, error, run } = useRun();
  const changed = name !== d.name || means !== d.means || sql !== d.sql;
  return (
    <article className="flex flex-col gap-[6px] rounded-lg px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-baseline gap-[8px]">
        {editing ? (
          <span className={clsx(r.field, "h-[28px] flex-1")}>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Its name" className={r.fieldInput} />
          </span>
        ) : (
          <h4 className="min-w-0 flex-1 text-body font-medium text-fg">{d.name}</h4>
        )}
        {d.sample ? <span className="tnum shrink-0 text-body font-medium text-fg">{formatValue(d.sample.value, d.unit)}</span> : <span className="shrink-0 text-caption text-danger">didn't read</span>}
      </div>
      {editing ? <textarea value={means} onChange={(e) => setMeans(e.target.value)} rows={2} aria-label="What it means" className={clsx(r.textarea, "w-full text-caption")} /> : <p className="text-caption text-fg-muted">{d.means}</p>}
      {d.error && <p className="text-caption text-danger">{d.error}</p>}
      {(!!d.reads.length || goal) && (
        <p className="text-micro text-fg-subtle">
          {[goal ? `For your goal: ${goal}` : null, d.reads.length ? `Reads ${d.reads.map((c) => shortColumn(c, home)).join(", ")}` : null, d.sample ? "Ran just now, read-only" : null].filter(Boolean).join(" · ")}
        </p>
      )}
      {!!d.assumes.length && (
        <ul className="list-disc pl-[16px] text-micro text-fg-subtle">
          {d.assumes.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      {d.flags.map((f, i) => (
        <p key={i} className="text-micro text-warning">
          {f}
        </p>
      ))}
      {editing ? <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={5} aria-label="Its query" spellCheck={false} className={clsx(r.textarea, "w-full font-mono text-micro")} /> : <Fold label="Its query"><Sql text={d.sql} /></Fold>}
      <span className="flex flex-wrap items-center gap-[6px]">
        <Button size="sm" disabled={!!busy || (!d.sample && !changed)} onClick={() => void run(changed ? "Checking your edit on the database" : "Keeping it", () => databaseDb.use(d.id, changed ? { name, means, sql } : undefined).then(() => feedback(`Kept: ${name}`, { kind: "success", id: "database.use" })))}>
          {changed ? "Check and use it" : "Use it"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setEditing((x) => !x)}>
          {editing ? "Done editing" : "Edit"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("Leaving it out", () => databaseDb.leave(d.id).then(() => {}))}>
          Leave out
        </Button>
      </span>
      <Status busy={busy} error={error} />
    </article>
  );
}

function Question({ q, answer, onAnswer }: { q: DraftQuestion; answer?: DraftAnswer; onAnswer: (a: DraftAnswer) => void }) {
  const [known, setKnown] = useState<KnownAnswer[]>([]);
  useEffect(() => {
    void withKnownAnswers(MEMORY, [{ id: q.id, title: q.question }]).then((x) => setKnown(x[0]?.known ?? []));
  }, [q.id]);
  const set = (how: DraftAnswer["how"], text: string) => onAnswer({ id: q.id, question: q.question, answer: text, how });
  return (
    <div className="flex flex-col gap-[6px] rounded-lg px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-caption text-fg">{q.question}</p>
      {!!q.choices.length && (
        <span className="flex flex-wrap gap-[6px]">
          {q.choices.map((c) => (
            <button key={c} type="button" aria-pressed={answer?.how === "pick" && answer.answer === c} onClick={() => set("pick", c)} className={clsx(r.composerPill, answer?.how === "pick" && answer.answer === c && "bg-selected text-fg")}>
              {answer?.how === "pick" && answer.answer === c && <Check {...ICON} />}
              <span className="font-mono text-micro">{c}</span>
            </button>
          ))}
        </span>
      )}
      <span className="flex items-center gap-[6px]">
        <span className={clsx(r.field, "h-[28px] flex-1")}>
          <input value={answer?.how === "own" ? answer.answer : ""} onChange={(e) => set("own", e.target.value)} placeholder="In your words" aria-label={`Your answer: ${q.question}`} className={r.fieldInput} />
        </span>
        <Button size="sm" variant={answer?.how === "unknown" ? "secondary" : "ghost"} onClick={() => set("unknown", "")}>
          I don't know
        </Button>
      </span>
      {!!known.length && <KnownStrip known={known} use={(k) => (k.how === "unknown" ? () => set("unknown", "") : () => set("own", k.text))} />}
    </div>
  );
}

function Metrics() {
  const metrics = useDatabase((s) => s.view?.metrics ?? []);
  return (
    <div className="flex flex-col gap-[6px] border-t border-line-subtle pt-[10px]">
      <h3 className="text-caption font-medium text-fg">The numbers your team keeps</h3>
      <p className="text-micro text-fg-subtle">In hub/metrics.md, shared with your team. A number read into a goal goes in goals.md, as a chart's does.</p>
      <ul className="flex flex-col">
        {metrics.map((m) => (
          <MetricRow key={m.metric.id} m={m} />
        ))}
      </ul>
    </div>
  );
}

const STATE_WORDS: Record<MetricView["state"], string> = {
  ready: "",
  check: "Not checked on this computer yet",
  elsewhere: "Checked on another database: check it on this one",
  dialect: "Written for another kind of database",
  unconnected: "Connect your database here to read it",
};

function MetricRow({ m }: { m: MetricView }) {
  const [checked, setChecked] = useState<Checked | null>(null);
  const { busy, error, run } = useRun();
  const x = m.metric;
  return (
    <li className="flex flex-col gap-[4px] border-t border-line-subtle py-[8px] first:border-t-0">
      <div className="flex items-baseline gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-body text-fg" title={x.means}>
          {x.name}
        </span>
        {m.reading && <span className="tnum shrink-0 text-body text-fg">{formatValue(m.reading.value, x.unit)}</span>}
        {m.reading && <span className="shrink-0 text-micro text-fg-subtle">{ago(m.reading.at)}</span>}
        {m.state === "ready" && (
          <IconBtn size="sm" label={`Read ${x.name} again`} disabled={!!busy} onClick={() => void run("Reading it", () => databaseDb.read([x.id], true).then(() => loadDatabase()))}>
            <RotateCcw {...ICON} />
          </IconBtn>
        )}
        <IconBtn size="sm" label={`Take ${x.name} off`} disabled={!!busy} onClick={() => void run("Taking it off", () => databaseDb.edit({ kind: "remove", id: x.id }).then(() => {}))}>
          <X {...ICON} />
        </IconBtn>
      </div>
      <p className="text-micro text-fg-subtle">{x.means}</p>
      {m.state !== "ready" && (
        <div className="flex flex-col gap-[4px]">
          <span className="flex items-center gap-[6px] text-caption text-fg-muted">
            {STATE_WORDS[m.state]}
            {(m.state === "check" || m.state === "elsewhere") && !checked && (
              <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void run("Running it once, read-only", () => databaseDb.check(x.id).then(setChecked))}>
                Check it beside a sample
              </Button>
            )}
          </span>
          {checked && (
            <div className="flex flex-col gap-[4px] rounded-lg px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              <span className="text-caption text-fg">{checked.sample ? <>It gives <span className="tnum font-medium">{formatValue(checked.sample.value, x.unit)}</span> now.</> : checked.error}</span>
              {checked.flags.map((f, i) => (
                <p key={i} className="text-micro text-warning">
                  {f}
                </p>
              ))}
              <Fold label="Its query">
                <Sql text={x.sql} />
              </Fold>
              {checked.sample && (
                <Button size="sm" className="self-start" disabled={!!busy} onClick={() => void run("Keeping it for this computer", () => databaseDb.approve(x.id, checked.q, checked.sample!.value).then(() => setChecked(null)))}>
                  Use it on this computer
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <Status busy={busy} error={error} />
    </li>
  );
}

function Sql({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-md bg-field px-[8px] py-[6px] pr-[28px] font-mono text-micro text-fg">{text}</pre>
      <IconBtn size="sm" label="Copy it" className="absolute right-[4px] top-[4px]" onClick={() => void navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
        {copied ? <Check {...ICON} /> : <Copy {...ICON} />}
      </IconBtn>
    </div>
  );
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-caption text-fg-muted hover:text-fg">{label}</summary>
      <div className="pt-[6px]">{children}</div>
    </details>
  );
}

function Status({ busy, error }: { busy: string | null; error: string | null }) {
  return (
    <>
      {busy && (
        <p className="inline-flex items-center gap-[6px] text-caption text-fg-muted">
          <Spinner size={12} /> <span className="q-shimmer-text">{busy}…</span>
        </p>
      )}
      {error && <p className="text-caption text-danger">{error}</p>}
    </>
  );
}
