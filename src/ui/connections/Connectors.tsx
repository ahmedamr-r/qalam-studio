import { useCallback, useEffect, useState, type FormEvent } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { GROUPS } from "@/connectors/catalog";
import type { Hit } from "@/connectors/recipes";
import { connectorsDb, type ConnectorState, type ImportResult } from "@/org/connectors";
import { placeHref } from "@/projects/model";
import { Button, Checkbox, IconBtn, Spinner } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";
import { StatusDot } from "../viz";

/*
 * Connectors in Connections: the four groups as cards, each with a dot and a word (Connected,
 * In Claude Code, Coming next…) and one action. One Claude Code already has is used with one click
 * (Claude Code keeps its sign-in); otherwise Qalam keeps a token in the Keychain. A connected one
 * brings material in: search it, pick, and each item is taken in like any source (read, filed,
 * placed on the boards).
 */

type View = Awaited<ReturnType<typeof connectorsDb.list>>;

export function Connectors() {
  const [view, setView] = useState<View | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<ConnectorState | null>(null);
  const load = useCallback(() => void connectorsDb.list().then(setView, (e: unknown) => setError(e instanceof Error ? e.message : String(e))), []);
  useEffect(load, [load]);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setView(await connectorsDb.check());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };
  // The first visit asks Claude Code once, so its connectors show without a click.
  useEffect(() => {
    if (view && view.checkedAt === null && !checking) void check();
  }, [view?.checkedAt]);

  if (!view) return <div className={clsx(r.skeleton, "h-[120px] rounded-lg")} aria-hidden />;
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center gap-[10px] text-caption text-fg-subtle">
        {checking ? (
          <span className="inline-flex items-center gap-[6px]">
            <Spinner size={12} /> Asking Claude Code which it has…
          </span>
        ) : (
          <span>{view.checkedAt ? `Claude Code checked ${ago(view.checkedAt)}` : "Not checked with Claude Code yet"}</span>
        )}
        <button type="button" disabled={checking} onClick={() => void check()} className={clsx(r.buttonSm, r.buttonGhost)}>
          Check again
        </button>
      </div>
      {error && <p className="text-caption text-danger">{error}</p>}
      {GROUPS.map((g) => (
        <div key={g.id} className="flex flex-col gap-[8px]">
          <h3 className="text-micro font-medium text-fg-subtle">{g.label}</h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[8px]">
            {view.connectors
              .filter((c) => c.group === g.id)
              .map((c) => (
                <Card key={c.id} c={c} onView={setView} onImport={() => setImporting(c)} />
              ))}
          </ul>
        </div>
      ))}
      {importing && <BringIn c={importing} onClose={() => setImporting(null)} />}
    </div>
  );
}

function Card({ c, onView, onImport }: { c: ConnectorState; onView: (v: View) => void; onImport: () => void }) {
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const act = async (fn: () => Promise<View>) => {
    setBusy(true);
    setNote(null);
    try {
      onView(await fn());
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const v = await connectorsDb.saveToken(c.id, token);
      setToken("");
      setTokenOpen(false);
      return v;
    });
  };
  const soon = !c.imports && !c.numbers && !c.status && !c.via && !c.claudeCode && !c.canToken;
  return (
    <li className={clsx("flex flex-col gap-[8px] rounded-lg bg-panel px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]", soon && "opacity-60")}>
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{c.label}</span>
        <span className="inline-flex shrink-0 items-center gap-[6px] text-caption text-fg-muted">
          <StatusDot tone={c.tone} hollow={c.tone === "off"} />
          {c.word}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-[6px]">
        {c.via && c.imports && (
          <Button size="sm" onClick={onImport}>
            Bring in…
          </Button>
        )}
        {!c.via && (c.imports || c.numbers) && c.claudeCode?.status === "connected" && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => connectorsDb.viaClaudeCode(c.id, c.claudeCode!.server))}>
            Use it
          </Button>
        )}
        {!c.via && (c.imports || c.status === "token") && c.canToken && !tokenOpen && (
          <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={() => setTokenOpen(true)}>
            Add a token
          </button>
        )}
        {c.via && (
          <button type="button" disabled={busy} className={clsx(r.buttonSm, r.buttonGhost, "ml-auto")} onClick={() => void act(() => connectorsDb.forget(c.id))}>
            Disconnect
          </button>
        )}
        {(c.via || c.status === "public") && !c.imports && <span className="text-micro text-fg-subtle">{c.numbers ? "Outcomes read their number from it" : "Shows where linked work stands"}</span>}
        {!c.via && !c.imports && !c.numbers && !c.status && (c.claudeCode || c.canToken) && <span className="text-micro text-fg-subtle">Coming next</span>}
      </div>
      {tokenOpen && c.tokenHelp && (
        <form onSubmit={save} className="flex flex-col gap-[6px]">
          <span className={r.field}>
            <input type="password" autoComplete="off" spellCheck={false} aria-label={c.tokenHelp.label} placeholder={c.tokenHelp.placeholder} value={token} onChange={(e) => setToken(e.target.value)} className={r.fieldInput} />
          </span>
          <span className="flex items-center gap-[6px]">
            <Button type="submit" size="sm" disabled={busy || token.trim().length < 10}>
              {busy ? "Checking…" : "Test and keep"}
            </Button>
            <a href={c.tokenHelp.href} target="_blank" rel="noreferrer" className="text-micro text-fg-subtle underline decoration-dotted underline-offset-2 hover:text-fg">
              Make one
            </a>
          </span>
        </form>
      )}
      {note && <p className="text-micro text-danger">{note}</p>}
    </li>
  );
}

/** Search a connector, pick, and take the picked items in. */
function BringIn({ c, onClose }: { c: ConnectorState; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"search" | "import" | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy("search");
    setError(null);
    try {
      setHits((await connectorsDb.search(c.id, query)).hits);
      setPicked(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const bringIn = async () => {
    const chosen = (hits ?? []).filter((h) => picked.has(h.id));
    if (!chosen.length) return;
    setBusy("import");
    setError(null);
    try {
      setResult(await connectorsDb.bringIn(c.id, chosen, (label) => setSteps((s) => [...s, label].slice(-3))));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className={r.overlay} data-state="open" onPointerDown={busy === "import" ? undefined : onClose} />
      <div role="dialog" aria-label={`Bring in from ${c.label}`} data-state="open" className={clsx(r.dialog, "flex max-h-[74vh] flex-col")}>
        <div className="flex items-center justify-between gap-[12px] border-b border-line-subtle px-[16px] py-[10px]">
          <h2 className="text-title font-medium text-fg">Bring in from {c.label}</h2>
          <IconBtn size="sm" label="Close" onClick={onClose}>
            <X size={14} absoluteStrokeWidth strokeWidth={1.25} />
          </IconBtn>
        </div>
        {result ? (
          <div className="flex flex-col gap-[10px] p-[16px]">
            <p className="flex items-center gap-[8px] text-body text-fg">
              <StatusDot tone={result.added.length ? "ok" : "off"} />
              {result.added.length ? `${result.added.length} taken in` : "Nothing new taken in"}
              {result.skipped.length > 0 && <span className="text-caption text-fg-subtle">· {result.skipped.length} already here</span>}
            </p>
            {result.failed.map((f) => (
              <p key={f.title} className="text-caption text-danger">
                {f.title}: {f.why}
              </p>
            ))}
            <span className="flex gap-[8px]">
              <a href={placeHref("sources")} className={clsx(r.buttonSm, r.buttonSecondary)}>
                See the sources
              </a>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Done
              </Button>
            </span>
          </div>
        ) : (
          <>
            <form onSubmit={(e) => void search(e)} className="flex items-center gap-[8px] px-[16px] pt-[12px]">
              <span className={clsx(r.field, "flex-1")}>
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: interview, research, feedback…" aria-label="Search" className={r.fieldInput} />
              </span>
              <Button type="submit" size="sm" variant="secondary" disabled={!query.trim() || !!busy}>
                {busy === "search" ? "Searching…" : "Search"}
              </Button>
            </form>
            <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[10px]">
              {hits === null ? null : !hits.length ? (
                <p className="text-caption text-fg-subtle">Nothing found. In Notion, a page shows once it's shared with what Qalam reads it through.</p>
              ) : (
                <ul className="flex flex-col gap-[2px]">
                  {hits.map((h) => (
                    <li key={h.id} className="flex flex-col rounded-md px-[4px] py-[4px] hover:bg-hover">
                      <Checkbox
                        checked={picked.has(h.id)}
                        onChange={(on) =>
                          setPicked((p) => {
                            const next = new Set(p);
                            if (on) next.add(h.id);
                            else next.delete(h.id);
                            return next;
                          })
                        }
                        label={<span className="truncate text-body text-fg">{h.title}</span>}
                      />
                      {h.snippet && <span className="truncate pl-[22px] text-micro text-fg-subtle">{h.snippet}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {busy === "import" && (
                <ul className="mt-[8px] flex flex-col gap-[2px]">
                  {steps.map((s, i) => (
                    <li key={i} className={clsx("text-caption", i === steps.length - 1 ? "q-shimmer-text text-fg-muted" : "text-fg-subtle")}>
                      {s}
                    </li>
                  ))}
                </ul>
              )}
              {error && <p className="mt-[8px] text-caption text-danger">{error}</p>}
            </div>
            <div className="flex items-center justify-between gap-[12px] border-t border-line-subtle px-[16px] py-[10px]">
              <span className="text-micro text-fg-subtle">Each is read, filed into the topic pages and placed on the boards.</span>
              <Button size="sm" disabled={!picked.size || !!busy} onClick={() => void bringIn()}>
                {busy === "import" ? "Taking in…" : `Bring in ${picked.size || ""}`.trim()}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
