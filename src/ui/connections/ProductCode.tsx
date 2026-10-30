import { useEffect, useState } from "react";
import clsx from "clsx";
import { FolderGit2, FolderOpen, RotateCcw, X } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { codeDb, type CodeView } from "@/org/code";
import { useOrgContext } from "@/org/context";
import { onOrgChange } from "@/org/live";
import { placeHref } from "@/projects/model";
import { Button, IconBtn, Segmented, Select } from "../controls";
import { useWords } from "../frame/store";
import { r } from "../recipes";
import { ago } from "../time";

/**
 * Product code on Connections: the repositories (or folders) this Mac reads, read-only, each for a
 * product. Qalam copies a repository's code onto this computer (this Mac's GitHub CLI, or Qalam's own
 * GitHub sign-in) or reads a folder where it is, then writes what the product does today, the
 * events it sends and the funnel behind each goal, for the team (hub/maps).
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function ProductCode() {
  const [view, setView] = useState<CodeView | null>(null);
  const [how, setHow] = useState<"github" | "folder">("github");
  const [repo, setRepo] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState<{ key: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<{ code: string; url: string } | null>(null);
  const { products } = useOrgContext();
  const words = useWords();
  const [product, setProduct] = useState<string>("org");
  useEffect(() => {
    if (products.length && product === "org") setProduct(products[0].id);
  }, [products]);
  const load = () => void codeDb.view().then(setView, () => setView({ gh: null, app: false, signedIn: false, repos: [], maps: [] }));
  useEffect(() => {
    load();
    return onOrgChange((c) => c.kind === "map" && load());
  }, []);

  const read = async (fn: (onActivity: (label: string) => void) => Promise<{ flows: number; steps: number }>, key: string) => {
    setBusy({ key, label: "Starting" });
    setError(null);
    try {
      const r = await fn((label) => setBusy({ key, label }));
      feedback(r.flows ? `Read it: ${plural(r.flows, "flow")}, ${plural(r.steps, "step")}` : "Read it, but no flow held up against the code.", { kind: r.flows ? "success" : "info", id: "code.read" });
      setRepo("");
      setFolder("");
      load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  const add = () => {
    const forProduct = product === "org" ? null : product;
    if (how === "github") void read((on) => codeDb.add({ kind: "github", repo, product: forProduct }, on), "new");
    else void read((on) => codeDb.add({ kind: "folder", path: folder, product: forProduct }, on), "new");
  };
  const startSignIn = async () => {
    setError(null);
    try {
      const s = await codeDb.signIn();
      setSignIn({ code: s.code, url: s.url });
      window.open(s.url, "_blank", "noreferrer");
      for (;;) {
        await new Promise((res) => setTimeout(res, s.interval * 1000));
        const { state } = await codeDb.poll(s.id);
        if (state === "pending") continue;
        setSignIn(null);
        if (state !== "done") setError(state === "denied" ? "GitHub says the sign-in was turned down." : "The code ran out before it was entered. Start again.");
        load();
        break;
      }
    } catch (e) {
      setSignIn(null);
      setError(message(e));
    }
  };

  const ready = how === "github" ? /^[\w.-]+\/[\w.-]+$/.test(repo.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "")) && (!!view?.gh || !!view?.signedIn) : !!folder.trim();
  const productName = (id: string | null) => (id ? (products.find((p) => p.id === id)?.name ?? "A product") : words.whole);

  return (
    <section aria-label="Product code" className="flex flex-col gap-[10px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-caption text-fg-muted">
        Read-only. Qalam copies the code onto this computer and reads it: what each product does today, the events it sends, and the funnel behind each goal. It never writes to the repository.{" "}
        <a href={placeHref("evidence")} className="text-fg hover:underline">
          See what it found
        </a>
      </p>
      {!!view?.repos.length && (
        <ul className="flex flex-col">
          {view.repos.map((x) => {
            const map = view.maps.find((m) => m.key === x.key);
            return (
              <li key={x.key} className="flex items-center gap-[10px] border-t border-line-subtle py-[8px] first:border-t-0">
                {x.kind === "github" ? <FolderGit2 {...ICON} className="shrink-0 text-fg-subtle" /> : <FolderOpen {...ICON} className="shrink-0 text-fg-subtle" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body text-fg">{x.repo ?? x.path}</span>
                  <span className="truncate text-caption text-fg-muted">
                    {[productName(x.product), x.readAt ? `read ${ago(x.readAt)}${x.commit ? ` at ${x.commit.slice(0, 7)}` : ""}` : "not read yet", map ? plural(map.flows.length, "flow") : null].filter(Boolean).join(" · ")}
                  </span>
                  {busy && busy.key === x.key && <span className="q-shimmer-text truncate text-caption text-fg-muted">{busy.label}…</span>}
                </span>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void read((on) => codeDb.read(x.key, on), x.key)}>
                  <RotateCcw size={12} absoluteStrokeWidth strokeWidth={1.25} /> Read again
                </Button>
                <IconBtn size="sm" label="Stop reading it here" onClick={() => void codeDb.remove(x.key).then(load, (e) => setError(message(e)))}>
                  <X {...ICON} />
                </IconBtn>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-[8px] border-t border-line-subtle pt-[10px]">
        <Segmented
          label="Read from"
          value={how}
          options={[
            { value: "github", label: "GitHub" },
            { value: "folder", label: "A folder on this computer" },
          ]}
          onChange={setHow}
        />
        {how === "github" && (
          <span className="text-caption text-fg-muted">
            {view?.gh ? `Through this computer's GitHub CLI, signed in as ${view.gh}.` : view?.signedIn ? "Through Qalam's GitHub sign-in." : "Sign in to GitHub's CLI on this computer (gh auth login), or with Qalam's own sign-in."}
            {!view?.gh && view?.app && !view.signedIn && (
              <>
                {" "}
                <button type="button" className="text-fg underline" onClick={() => void startSignIn()}>
                  Sign in with GitHub
                </button>
              </>
            )}
          </span>
        )}
        {signIn && (
          <p className="text-caption text-fg">
            Enter <span className="font-mono font-medium">{signIn.code}</span> at{" "}
            <a href={signIn.url} target="_blank" rel="noreferrer" className="underline">
              {signIn.url}
            </a>
            . Qalam asks to read code only.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-[8px]">
          {how === "github" ? (
            <span className={clsx(r.field, "h-[30px] min-w-[220px] flex-1")}>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" aria-label="The repository" className={r.fieldInput} />
            </span>
          ) : (
            <>
              <span className={clsx(r.field, "h-[30px] min-w-[220px] flex-1")}>
                <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Users/you/code/app" aria-label="The folder" className={r.fieldInput} />
              </span>
              <Button size="sm" variant="ghost" onClick={() => void codeDb.chooseFolder().then((f) => f.path && setFolder(f.path), (e) => setError(message(e)))}>
                Choose…
              </Button>
            </>
          )}
          <Select ariaLabel="The product it's for" value={product} options={[{ value: "org", label: words.whole }, ...products.map((p) => ({ value: p.id, label: p.name }))]} onChange={setProduct} />
          <Button size="sm" disabled={!ready || !!busy} onClick={add}>
            Read it
          </Button>
        </div>
        {busy && busy.key === "new" && <p className="q-shimmer-text text-caption text-fg-muted">{busy.label}… a few minutes for a big repository</p>}
        {error && <p className="text-caption text-danger">{error}</p>}
      </div>
    </section>
  );
}
