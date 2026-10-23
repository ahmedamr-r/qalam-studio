import { useEffect, useMemo, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { Check, ChevronRight, Eye, RotateCcw, SlidersHorizontal, Square } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { assetURL } from "@/doc/assets";
import { TokenSet } from "@/design-system/resolve";
import { DEPTHS, describeRun, type Depth } from "@/design-system/extract-options";
import { PLATFORMS } from "@/design-system/platform";
import type { DesignSystem } from "@/design-system/registry";
import { r } from "../recipes";
import { Button, Checkbox, Hint, Segmented, Swatch, Tag } from "../controls";
import { getController } from "../CanvasView";
import { screenPreview } from "../componentPreviews";
import { ErrorNote, Progress } from "./common";
import { chatById, patchTurn, retry, send, stopTurn } from "./chats";
import type { ChatTurn } from "./chatTypes";
import {
  applySuggestion,
  discardExtract,
  extractOutcomeOf,
  isRetrying,
  reopenAnswers,
  retryDocs,
  retryRebuild,
  saveExtract,
  shotsOf,
  stopRetry,
  type ExtractDeps,
  type ExtractOutcome,
  type FidelityRebuild,
} from "./extract";
import { advancedFor, coverage, extractQuestions, fetchOf, optionsFromAnswers, type ExtractAdvanced } from "./extractQuestions";
import { pinPreview } from "./extractPreview";
import ReconcileSummary from "./ReconcileSummary";
import { AnswersSummary, Questionnaire } from "./Questionnaire";
import type { FlowState } from "./questionFlow";

/**
 * An extraction in the chat: Qalam AI's first look at the screenshots, its questions, the run,
 * then the draft to review (tokens, fidelity check) and save.
 */

const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const linkBtn = clsx(r.link, "text-caption font-medium");
/** An outlined card in a turn (the first look). */
const cardBox = "flex flex-col gap-[6px] rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";
/** A raised card nested in a turn's card (preview, fidelity check, advanced settings). */
const insetBox = "rounded-lg bg-raised shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";
/** Saved. */
const doneBox = "flex flex-col gap-[8px] rounded-lg bg-success-subtle p-[10px] text-caption text-fg";

function depsFor(chatId: string, turnId: string): ExtractDeps {
  return {
    patch: (p) => patchTurn(chatId, turnId, p),
    current: () => chatById(chatId)?.turns.find((t) => t.id === turnId) ?? null,
    ids: { chatId, turnId },
  };
}

export function ExtractView({ chatId, t }: { chatId: string; t: ChatTurn }) {
  const o = extractOutcomeOf(t);
  const deps = useMemo(() => depsFor(chatId, t.id), [chatId, t.id]);
  /** Change the outcome as it is now (a background pass may have updated it since this render). */
  const update = (fn: (cur: ExtractOutcome) => ExtractOutcome) => patchTurn(chatId, t.id, (cur) => (extractOutcomeOf(cur) ? { outcome: fn(extractOutcomeOf(cur)!) } : {}));
  const phase = o?.phase ?? "scanning";
  const questions = useMemo(() => (o ? extractQuestions(o.scan, o.form.answers) : []), [o]);
  const answers = o && phase !== "scanning" && phase !== "asking" && <AnswersSummary questions={questions} answers={o.form.answers} />;
  const changeAnswers = o && (
    <button type="button" className={linkBtn} onClick={() => update((cur) => reopenAnswers(t, cur))}>
      Change answers
    </button>
  );

  if (t.status === "running")
    return (
      <div className="flex flex-col gap-[8px]">
        {answers}
        <Progress tokens={t.tokens} started={t.started} label={t.activity ?? (phase === "scanning" ? "Looking at your screenshots…" : "Extracting…")} />
        {o?.draft && (
          <div className="q-fade flex items-center gap-[8px] text-caption text-fg-muted">
            Tokens are ready.
            <PreviewButton chatId={chatId} t={t} />
          </div>
        )}
        <Button size="sm" variant="ghost" className="-ml-[4px] self-start" onClick={() => stopTurn(chatId, t.id)}>
          <Square size={12} {...icon} /> Stop
        </Button>
      </div>
    );
  if (t.status === "error")
    return (
      <div className="flex flex-col gap-[8px]">
        {answers}
        <ErrorNote message={t.error ?? "Something went wrong."} />
        <div className="flex items-center gap-[12px] text-caption">
          <Button size="sm" variant="secondary" onClick={() => retry(chatId, t.id)}>
            <RotateCcw size={14} {...icon} /> Try again
          </Button>
          {phase === "running" && changeAnswers}
        </div>
      </div>
    );
  if (t.status === "stopped")
    return (
      <div className="flex flex-col gap-[8px]">
        {answers}
        <div className="flex items-center gap-[12px] text-caption text-fg-subtle">
          Stopped.
          <button type="button" className={linkBtn} onClick={() => retry(chatId, t.id)}>
            {phase === "scanning" ? "Look again" : "Run again"}
          </button>
          {phase === "running" && changeAnswers}
        </div>
      </div>
    );
  if (!o) return null;

  if (phase === "asking") {
    const start = (form: FlowState) => {
      update((cur) => ({ ...cur, form, options: optionsFromAnswers(cur.scan, form.answers, cur.advanced, t.request.text), phase: "running" }));
      retry(chatId, t.id);
    };
    const lookAgain = () => {
      update((cur) => ({ ...cur, phase: "scanning", scanError: undefined }));
      retry(chatId, t.id);
    };
    const preview = optionsFromAnswers(o.scan, o.form.answers, o.advanced, t.request.text);
    return (
      <div className="flex flex-col gap-[8px]">
        <Findings t={t} o={o} onLookAgain={lookAgain} />
        <Questionnaire
          questions={questions}
          state={o.form}
          title="Before I extract"
          onChange={(form) => update((cur) => ({ ...cur, form }))}
          onSubmit={start}
          review={{
            title: "Ready to extract?",
            submitLabel: "Start extraction",
            extra: <Advanced o={o} sample={!!t.sample} onChange={(advanced) => update((cur) => ({ ...cur, advanced }))} />,
            footnote: `${describeRun(preview, !!t.sample || !o.advanced.rebuild)} You can stop at any time; the tokens preview as soon as the first pass finishes.`,
          }}
        />
      </div>
    );
  }

  if (phase === "draft" && o.draft)
    return (
      <div className="flex flex-col gap-[8px]">
        {answers}
        <DraftReview chatId={chatId} t={t} o={o} deps={deps} update={update} />
      </div>
    );

  if (phase === "saved" && o.saved)
    return (
      <div className="flex flex-col gap-[8px]">
        {answers}
        <Saved saved={o.saved} />
      </div>
    );

  if (phase === "discarded")
    return (
      <div className="flex flex-col gap-[8px]">
        {answers}
        <div className="flex items-center gap-[12px] text-caption text-fg-subtle">
          Discarded the draft.
          <button type="button" className={linkBtn} onClick={() => update((cur) => reopenAnswers(t, cur))}>
            Start over with these screenshots
          </button>
        </div>
      </div>
    );
  return answers || null;
}

// ---------------------------------------------------------------------------
// The first look

function Findings({ t, o, onLookAgain }: { t: ChatTurn; o: ExtractOutcome; onLookAgain: () => void }) {
  const s = o.scan;
  const n = shotsOf(t).length;
  if (!s)
    return (
      <Hint action="Look again" onAction={onLookAgain}>
        I couldn&apos;t take a first look{o.scanError ? ` (${o.scanError})` : ""}, so pick what to extract from the whole catalog below.
      </Hint>
    );
  return (
    <div className={cardBox}>
      <div className="flex items-center gap-[6px]">
        <span className={r.eyebrow}>Here&apos;s what I found</span>
        {t.sample && <Tag>Recorded sample</Tag>}
      </div>
      <div className="text-body font-medium text-fg" dir="auto">
        {s.product || "Your product"}
        <span className="font-normal text-fg-subtle tnum">
          {" "}
          · {PLATFORMS[s.platform].label} · {n} screen{n > 1 ? "s" : ""}
        </span>
      </div>
      {s.look && (
        <p className="text-caption text-fg-muted" dir="auto">
          {s.look}
        </p>
      )}
      {s.components.length > 0 ? (
        <div className="q-stagger mt-[2px] flex flex-wrap gap-[4px]">
          {s.components.map((c, k) => (
            <span key={c.name} title={c.evidence} style={{ "--i": k } as CSSProperties} className="inline-flex h-[22px] items-center gap-[4px] rounded-md bg-active px-[6px] text-caption text-fg-muted">
              {c.name}
              <span className="text-micro text-fg-subtle tnum">×{c.count}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-caption text-fg-subtle">No catalog components recognised.</p>
      )}
      {s.candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-[4px]">
          <span className="mr-[2px] text-micro text-fg-subtle">Distinctive:</span>
          {s.candidates.map((c) => (
            <span key={c.name} title={c.description} className="inline-flex h-[22px] items-center rounded-md border border-dashed border-line-strong px-[6px] text-caption text-fg-muted" dir="auto">
              {c.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Depth and docs follow the first answer unless the designer sets them here. */
function Advanced({ o, sample, onChange }: { o: ExtractOutcome; sample: boolean; onChange: (a: ExtractAdvanced) => void }) {
  const fetch = fetchOf(o.scan, o.form.answers);
  const eff = advancedFor(fetch, o.advanced);
  const custom = o.advanced.depth !== null || o.advanced.language !== null;
  return (
    <details className={clsx(insetBox, "group/adv px-[10px]")} open={custom}>
      <summary className="flex h-[32px] cursor-pointer list-none items-center gap-[6px] text-caption font-medium text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} {...icon} className="shrink-0 text-fg-subtle transition-transform duration-fast group-open/adv:rotate-90" />
        <span className="min-w-0 truncate">
          Advanced <span className="font-normal text-fg-subtle">· {DEPTHS.find((d) => d.value === eff.depth)!.label} tokens{eff.language ? " · language docs" : ""}</span>
        </span>
        {custom && <span className={clsx(r.chip, "ml-auto shrink-0")}>Changed</span>}
      </summary>
      <div className="flex flex-col gap-[10px] pb-[10px]">
        <div className="flex flex-col gap-[6px]">
          <div className="flex items-center justify-between text-caption text-fg-muted">
            <span>How deep the tokens go</span>
            {o.advanced.depth !== null && (
              <button type="button" className={linkBtn} onClick={() => onChange({ ...o.advanced, depth: null })}>
                Reset
              </button>
            )}
          </div>
          <Segmented<Depth> label="How deep the tokens go" value={eff.depth} onChange={(depth) => onChange({ ...o.advanced, depth })} options={DEPTHS.map((d) => ({ value: d.value, label: d.label }))} />
          <p className="text-caption text-fg-subtle">
            {o.advanced.depth === null && "Set by your first answer. "}
            {DEPTHS.find((d) => d.value === eff.depth)!.description}
          </p>
          {fetch !== "tokens" && eff.depth !== "complete" && <Hint>At this depth your components get guides but keep the default styling, apart from the shapes the studio measures.</Hint>}
        </div>
        <div className="flex flex-col">
          <Checkbox checked={eff.language} onChange={(language) => onChange({ ...o.advanced, language })} label="Write the design language and layout docs" />
          {!sample && <Checkbox checked={o.advanced.rebuild} onChange={(rebuild) => onChange({ ...o.advanced, rebuild })} label="Rebuild screen 1 with the draft, then compare and correct" />}
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// The draft

function PreviewButton({ chatId, t }: { chatId: string; t: ChatTurn }) {
  return (
    <button
      type="button"
      className={clsx(linkBtn, "inline-flex items-center gap-[4px]")}
      onClick={() => {
        pinPreview({ chatId, turnId: t.id });
        studio().setLeftTab("tokens");
      }}
    >
      <Eye size={12} {...icon} /> Preview in Tokens
    </button>
  );
}

function DraftReview({ chatId, t, o, deps, update }: { chatId: string; t: ChatTurn; o: ExtractOutcome; deps: ExtractDeps; update: (fn: (cur: ExtractOutcome) => ExtractOutcome) => void }) {
  const draft = o.draft!;
  const [name, setName] = useState("");
  const [placeRebuild, setPlaceRebuild] = useState(true);
  const [saving, setSaving] = useState(false);
  const cov = o.options ? coverage(o.options) : null;
  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveExtract(t, extractOutcomeOf(deps.current()) ?? o, name, { placeRebuild });
      update(() => saved);
    } finally {
      setSaving(false);
    }
  };
  // A retry that didn't survive a reload isn't running.
  const retrying = !!o.retrying && isRetrying(t.id);
  return (
    <div className="flex flex-col gap-[10px] rounded-lg bg-muted p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-center gap-[8px]">
        <Tag tone="ai">{t.sample ? "Sample output" : `Draft · ${t.model ?? "Qalam AI"}`}</Tag>
        <span className="text-caption text-fg-muted">Review, then save.</span>
      </div>
      <input className="ds-input placeholder:text-fg-faint" placeholder={draft.name} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name the new design system" />
      <TokenPreview ds={draft} />
      {cov && <p className="text-caption text-fg-muted">{cov.line}.</p>}
      {retrying ? (
        <div className="flex flex-col gap-[6px]">
          <Progress tokens={o.retrying!.tokens} started={o.retrying!.started} label="Writing the docs again…" />
          <Button size="sm" variant="ghost" className="-ml-[4px] self-start" onClick={() => stopRetry(t.id)}>
            <Square size={12} {...icon} /> Stop
          </Button>
        </div>
      ) : (
        o.guideError && (
          <Hint action="Retry the docs" onAction={() => void retryDocs(t, deps)}>
            The written guide didn&apos;t finish ({o.guideError}). The tokens are fine: retry just the docs, or save without them. Without a design language and layout rules, screens generated with this system come out generic.
          </Hint>
        )
      )}
      {!t.sample && o.rebuild && <FidelityCheck rebuild={o.rebuild} draft={draft} onRetry={() => void retryRebuild(t, deps)} />}
      {!t.sample && o.reconcile && <ReconcileSummary state={o.reconcile} onApply={(s) => applySuggestion(deps, s)} />}
      {!!draft.notes?.length && (
        <details className="group/notes text-caption text-fg-muted">
          <summary className="flex h-[24px] cursor-pointer list-none items-center gap-[6px] font-medium hover:text-fg [&::-webkit-details-marker]:hidden">
            <ChevronRight size={12} {...icon} className="shrink-0 text-fg-subtle transition-transform duration-fast group-open/notes:rotate-90" />
            What the studio measured and adjusted <span className="font-normal text-fg-subtle tnum">({draft.notes.length})</span>
          </summary>
          <ul className="mt-[2px] flex list-disc flex-col gap-[2px] pl-[32px] marker:text-fg-faint">
            {draft.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {o.rebuild?.status === "done" && <Checkbox checked={placeRebuild} onChange={setPlaceRebuild} label="Put the rebuild on the canvas next to the screenshot" />}
      <div className="flex flex-wrap items-center gap-[6px]">
        <Button size="sm" onClick={() => void save()} disabled={saving || !!retrying}>
          <Check size={14} {...icon} /> Save as design system
        </Button>
        <Button size="sm" variant="ghost" onClick={() => update((cur) => discardExtract(t, cur))} disabled={saving}>
          Discard
        </Button>
        <span className="ml-auto text-caption">
          <PreviewButton chatId={chatId} t={t} />
        </span>
      </div>
    </div>
  );
}

const PREVIEW_ROLES = ["bg.canvas", "bg.surface", "bg.brand-strong", "bg.brand", "bg.brand-subtle", "text.primary", "text.secondary", "border.subtle", "text.success", "text.error"];

/** The draft at a glance: its colour roles, type and corner radii. */
function TokenPreview({ ds }: { ds: DesignSystem }) {
  const ts = useMemo(() => new TokenSet(ds.tree), [ds.tree]);
  const family = String(ts.get("font.family.latin")?.value ?? ds.fonts[0]?.family ?? "");
  const type = ["type.display", "type.title", "type.body", "type.caption"].map((p) => ({ p, s: ts.typography(p) })).filter((x) => x.s);
  const radii = ["radius.sm", "radius.md", "radius.lg", "radius.xl"].map((p) => ({ p, v: ts.dimension(p) })).filter((x) => x.v !== undefined);
  return (
    <div className={clsx(insetBox, "flex flex-col gap-[10px] p-[10px]")}>
      <div className="flex flex-wrap gap-[4px]">
        {PREVIEW_ROLES.map((p) => {
          const c = ts.color(p);
          return c ? (
            <span key={p} title={`${p} · ${c}`}>
              <Swatch color={c} size={20} />
            </span>
          ) : null;
        })}
      </div>
      <div className="flex items-end justify-between gap-[8px]">
        <div className="min-w-0">
          <div className="truncate text-micro text-fg-subtle">{family}</div>
          <div className="flex items-baseline gap-[8px] truncate text-fg" style={{ fontFamily: family }}>
            {type.map(({ p, s }) => (
              <span key={p} title={`${p} · ${s!.fontSize}/${s!.lineHeight} · ${s!.fontWeight}`} style={{ fontSize: Math.min(s!.fontSize, 26), fontWeight: s!.fontWeight, lineHeight: 1.1 }}>
                Aa
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-end gap-[4px]">
          {radii.map(({ p, v }) => (
            <span key={p} title={`${p} · ${v}px`} className="size-[24px] border-t-[1.5px] border-l-[1.5px] border-fg-subtle" style={{ borderTopLeftRadius: Math.min(v!, 24) }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The fidelity check: the screenshot beside its rebuild from catalog components with the draft,
 * so the designer sees what the system (and the catalog) can and can't reproduce before saving.
 */
function FidelityCheck({ rebuild, draft, onRetry }: { rebuild: FidelityRebuild; draft: DesignSystem; onRetry: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const spec = rebuild.status === "done" ? rebuild.spec : undefined;
  const version = draft.updatedAt;
  useEffect(() => {
    let live = true;
    const ref = draft.sources?.[0];
    if (ref) void assetURL(ref).then((u) => live && setSource(u));
    return () => {
      live = false;
    };
  }, [draft.sources]);
  useEffect(() => {
    if (!spec) return;
    let live = true;
    let made: string | null = null;
    void screenPreview(spec, draft, 640)
      .then((u) => {
        made = u;
        if (live) setUrl(u);
      })
      .catch(() => live && setUrl(null));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
    // Redraw when the draft changes (the docs pass doesn't change tokens, but a retry might).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, version]);
  // Screenshots are content: they sit on the light stage in both themes.
  const img = "q-fade max-h-[240px] w-full rounded-md bg-stage object-contain object-top shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";
  const well = "h-[160px] rounded-md";
  return (
    <div className={clsx(insetBox, "flex flex-col gap-[8px] p-[10px]")}>
      <div className="text-caption font-medium text-fg">Fidelity check</div>
      <div className="grid grid-cols-2 gap-[8px]">
        <figure className="flex flex-col gap-[4px]">
          {source || draft.thumbnail ? <img src={source ?? draft.thumbnail} alt="The screenshot" className={img} /> : <div className={clsx(well, "bg-muted")} />}
          <figcaption className="text-micro text-fg-subtle">Screenshot</figcaption>
        </figure>
        <figure className="flex flex-col gap-[4px]">
          {rebuild.status === "running" ? (
            <div className={clsx(well, r.skeleton)} aria-label="Rebuilding" />
          ) : rebuild.status === "error" ? (
            <div className={clsx(well, "flex flex-col items-center justify-center gap-[4px] bg-muted p-[8px] text-center text-caption text-fg-muted")}>
              The rebuild didn&apos;t finish{rebuild.error ? ` (${rebuild.error})` : ""}.
              <button type="button" className={linkBtn} onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : url ? (
            <img src={url} alt="The screenshot rebuilt with this system" className={img} />
          ) : (
            <div className={clsx(well, r.skeleton)} />
          )}
          <figcaption className="text-micro text-fg-subtle">Rebuilt with this system</figcaption>
        </figure>
      </div>
      {rebuild.status === "running" && <p className="q-shimmer-text text-caption">Rebuilding the screenshot from catalog components with the draft…</p>}
      {!!rebuild.gaps?.length && (
        <div className="text-caption text-fg-muted">
          <span className="font-medium text-fg">Not in the catalog:</span> {rebuild.gaps.map((g) => `${g.element} (used ${g.workaround})`).join("; ")}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved

/** Close the loop: tune the system against the screenshot it came from. */
function Saved({ saved }: { saved: NonNullable<ExtractOutcome["saved"]> }) {
  const [asked, setAsked] = useState(false);
  const onCanvas = useStudio((s) => !!saved.rebuiltId && !!s.doc.nodes[saved.rebuiltId]);
  const tune = () => {
    if (!saved.rebuiltId || !studio().doc.nodes[saved.rebuiltId]) return;
    setAsked(true);
    studio().select([saved.rebuiltId]);
    getController()?.zoomToFit([saved.rebuiltId]);
    void send({
      tool: "tune",
      systemId: saved.systemId,
      text: "This screen is the source screenshot rebuilt with this design system; the screenshot itself is attached as the reference. Compare them and change the system so screens built with it look like the product: colours and where they're used, type sizes and weights, corner radii, spacing and density, borders versus shadows, component styling. Where a difference comes from the catalog (a component it doesn't have), list it under limitations.",
    });
  };
  return (
    <div className={clsx(doneBox, "q-rise")}>
      <div className="flex items-center gap-[8px] text-body font-medium text-fg">
        <Check size={14} {...icon} className="shrink-0 text-success" /> Saved “{saved.name}” as the active system
      </div>
      {onCanvas ? (
        <>
          <p className="pl-[22px] text-fg-muted">The rebuilt screenshot is on the canvas next to the original. If they differ, Qalam AI can compare them and propose token and recipe changes for you to review.</p>
          <div className="flex gap-[6px] pl-[22px]">
            <Button size="sm" onClick={tune} disabled={asked}>
              <SlidersHorizontal size={14} {...icon} /> Tune to match the screenshot
            </Button>
            <Button size="sm" variant="ghost" onClick={() => studio().setLeftTab("tokens")}>
              Open in Tokens
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="ghost" className="ml-[18px] self-start" onClick={() => studio().setLeftTab("tokens")}>
          Open in Tokens
        </Button>
      )}
    </div>
  );
}

/** The screenshots of an extraction request, as a strip. */
export function ShotStrip({ refs }: { refs: { ref: string; name: string }[] }) {
  return (
    <div className="flex flex-wrap gap-[6px]">
      {refs.map((x) => (
        <ShotThumb key={x.ref} src={x.ref} name={x.name} />
      ))}
    </div>
  );
}

function ShotThumb({ src, name }: { src: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // assetURL caches its object URLs, so they aren't revoked here.
    let live = true;
    void assetURL(src).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [src]);
  return url ? (
    <img src={url} alt={name} title={name} className="q-fade h-[64px] w-auto max-w-[52px] rounded-md bg-stage object-cover object-top shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" />
  ) : (
    <div className={clsx(r.skeleton, "h-[64px] w-[40px]")} />
  );
}
