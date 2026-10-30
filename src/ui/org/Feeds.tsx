import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Rss } from "lucide-react";
import { nanoid } from "nanoid";
import { aiStatus } from "@/ai/client";
import type { ConnectorInfo } from "@/ai/research-shared";
import { feedback } from "@/commands/feedback";
import { orgFetch, orgJson } from "@/org/client";
import type { Product } from "@/org/context-md";
import { FEED_EVERY_LABEL, type Feed, type FeedEvery } from "@/org/feeds";
import { onOrgChange } from "@/org/live";
import { Button, Segmented, Select, Spinner } from "../controls";
import { r } from "../recipes";
import { confirmDialog } from "../surfaces/dialog";
import { ago } from "../time";

/**
 * The organization's feeds: what's pulled in every day or week without anyone adding it (a page
 * or export at an address, or a request to a connected tool). What each brings that's new becomes
 * a source, read, filed and placed like anything added (server/feeds.ts).
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export function Feeds({ products, product }: { products: Product[]; product: string | null }) {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const load = useCallback(() => void orgJson<Feed[]>("/feeds").then(setFeeds, () => setFeeds([])), []);
  useEffect(() => {
    load();
    return onOrgChange((c) => c.kind === "feeds" && load());
  }, [load]);
  if (!feeds) return null;

  const put = async (f: Feed) => {
    await orgFetch(`/feeds/${f.id}`, { method: "PUT", json: f });
    load();
  };
  const pull = async (f: Feed) => {
    setPulling(f.id);
    try {
      const res = await orgJson<{ added: number; error?: string }>(`/feeds/${f.id}/pull`, { method: "POST" });
      feedback(res.error ? `${f.label}: ${res.error}` : res.added ? `${f.label} brought in ${res.added} new ${res.added === 1 ? "item" : "items"}` : `${f.label} has nothing new`, { kind: res.error ? "error" : undefined, id: "feeds" });
    } catch (e) {
      feedback(e instanceof Error ? e.message : String(e), { kind: "error", id: "feeds" });
    } finally {
      setPulling(null);
      load();
    }
  };
  const remove = async (f: Feed) => {
    if (!(await confirmDialog({ title: `Stop pulling “${f.label}”?`, body: "What it brought in stays in the organization's sources.", confirmLabel: "Remove feed", danger: true }))) return;
    await orgFetch(`/feeds/${f.id}`, { method: "DELETE" });
    load();
  };
  const name = (p: string | null) => (p ? (products.find((x) => x.id === p)?.name ?? "A product") : "The whole organization");

  return (
    <section aria-label="Feeds" className="flex flex-col gap-[8px]">
      <div className="flex items-center justify-between gap-[12px]">
        <p className="text-caption text-fg-muted">Feeds bring in what customers say every day or week: an export at an address, or what you ask a connected tool for. Only what's new comes in.</p>
        {!adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Add a feed
          </Button>
        )}
      </div>
      {adding && (
        <FeedForm
          products={products}
          product={product}
          onDone={(f) => {
            setAdding(false);
            if (f) void put(f);
          }}
        />
      )}
      {feeds.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {feeds.map((f) => (
            <li key={f.id} className="flex items-start gap-[10px] px-[12px] py-[10px]">
              <span className="mt-[2px] text-fg-subtle">
                <Rss {...ICON} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="truncate text-body text-fg">
                  {f.label}
                  {f.paused && <span className="ml-[6px] text-caption text-fg-subtle">paused</span>}
                </span>
                <span className="truncate text-caption text-fg-muted">{f.kind === "url" ? f.url : `${f.request} · from ${(f.connectors ?? []).join(", ")}`}</span>
                <span className={clsx("text-caption", f.error ? "text-danger" : "text-fg-subtle")}>
                  {[FEED_EVERY_LABEL[f.every], name(f.product), f.error ? `Last pull failed: ${f.error}` : f.last ? `pulled ${ago(f.last)}` : "not pulled yet", f.added ? `${f.added} brought in` : ""].filter(Boolean).join(" · ")}
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-[4px]">
                <button type="button" disabled={pulling !== null} onClick={() => void pull(f)} className={clsx(r.buttonSm, r.buttonGhost)}>
                  {pulling === f.id ? <Spinner size={12} /> : null} Pull now
                </button>
                <button type="button" onClick={() => void put({ ...f, paused: !f.paused })} className={clsx(r.buttonSm, r.buttonGhost)}>
                  {f.paused ? "Resume" : "Pause"}
                </button>
                <button type="button" onClick={() => void remove(f)} className={clsx(r.buttonSm, r.buttonGhost)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedForm({ products, product, onDone }: { products: Product[]; product: string | null; onDone: (f: Feed | null) => void }) {
  const [kind, setKind] = useState<Feed["kind"]>("url");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [tools, setTools] = useState<ConnectorInfo[]>([]);
  const [tool, setTool] = useState("");
  const [request, setRequest] = useState("");
  const [every, setEvery] = useState<FeedEvery>("week");
  const [forProduct, setForProduct] = useState(product ?? "_org");
  useEffect(() => {
    void aiStatus().then((s) => {
      const list = (s.connectors ?? []).filter((c) => c.kind !== "web");
      setTools(list);
      setTool((t) => t || list[0]?.id || "");
    });
  }, []);
  const ok = label.trim() && (kind === "url" ? /^https?:\/\/\S+$/i.test(url.trim()) : tool && request.trim().length >= 4);
  const field = "flex flex-col gap-[4px]";
  return (
    <div className="flex flex-col gap-[10px] rounded-lg bg-panel p-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="grid gap-[10px] sm:grid-cols-[1fr_auto]">
        <label className={field}>
          <span className="text-caption font-medium text-fg">Name</span>
          <span className={clsx(r.field, "h-[32px]")}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Support tickets" className={clsx(r.fieldInput, "text-body")} />
          </span>
        </label>
        <div className={field}>
          <span className="text-caption font-medium text-fg">From</span>
          <Segmented label="From" value={kind} onChange={setKind} options={[{ value: "url", label: <span className="px-[6px]">An address</span> }, { value: "tool", label: <span className="px-[6px]">A connected tool</span> }]} />
        </div>
      </div>
      {kind === "url" ? (
        <label className={field}>
          <span className="text-caption font-medium text-fg">Address</span>
          <span className={clsx(r.field, "h-[32px]")}>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (a page, a public sheet's CSV, an export link)" className={clsx(r.fieldInput, "text-body")} />
          </span>
          <span className="text-micro text-fg-subtle">Read the way a page added by hand is; when it changes, what it says now comes in as a new source.</span>
        </label>
      ) : tools.length ? (
        <div className="grid gap-[10px] sm:grid-cols-[200px_1fr]">
          <div className={field}>
            <span className="text-caption font-medium text-fg">Tool</span>
            <Select ariaLabel="Tool" value={tool} options={tools.map((t) => ({ value: t.id, label: t.label }))} onChange={setTool} />
          </div>
          <label className={field}>
            <span className="text-caption font-medium text-fg">What to bring in</span>
            <span className={clsx(r.field, "h-[32px]")}>
              <input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="This week's tickets tagged delivery" className={clsx(r.fieldInput, "text-body")} />
            </span>
          </label>
        </div>
      ) : (
        <p className="text-caption text-fg-muted">No connected tools here. Connect one in Claude Code (CLI_MCP_SERVERS) or with MCP_SERVERS, then add a feed from it.</p>
      )}
      <div className="grid gap-[10px] sm:grid-cols-2">
        <div className={field}>
          <span className="text-caption font-medium text-fg">How often</span>
          <Segmented label="How often" value={every} onChange={setEvery} options={[{ value: "day", label: <span className="px-[6px]">Every day</span> }, { value: "week", label: <span className="px-[6px]">Every week</span> }]} />
        </div>
        <div className={field}>
          <span className="text-caption font-medium text-fg">For</span>
          <Select ariaLabel="For" value={forProduct} options={[{ value: "_org", label: "The whole organization" }, ...products.map((p) => ({ value: p.id, label: p.name }))]} onChange={setForProduct} />
        </div>
      </div>
      <div className="flex justify-end gap-[8px]">
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!ok}
          onClick={() =>
            onDone({
              id: nanoid(10),
              label: label.trim(),
              kind,
              ...(kind === "url" ? { url: url.trim() } : { connectors: [tool], request: request.trim() }),
              every,
              product: forProduct === "_org" ? null : forProduct,
            })
          }
        >
          Add feed
        </Button>
      </div>
    </div>
  );
}
