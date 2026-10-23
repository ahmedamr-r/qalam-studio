import { Fragment, useMemo, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { Ban, Blocks, ChevronRight, Compass, ListChecks, MousePointerClick, RotateCcw, TriangleAlert } from "lucide-react";
import { PLATFORMS } from "@/design-system/platform";
import type { PlanResult, PlanStandard } from "@/ai/plan";
import { hostOf, type ResearchInfo, type ResearchSource } from "@/ai/research-shared";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { r as rc } from "../recipes";
import { Button, Tag } from "../controls";
import { patchTurn, retry } from "./chats";
import type { ChatTurn } from "./chatTypes";
import { bucketQuestions, bucketsOf, closeBucket, planPlatform, reopenBucket, type PlanBucket, type PlanLibraries, type PlanState } from "./plan";
import { REVIEW, type FlowState, type Question } from "./questionFlow";
import { AnswersSummary, Questionnaire, qr } from "./Questionnaire";
import { Notes } from "./ResearchView";

/**
 * Plan first, in the chat: what Qalam AI understood from the brief, the market standard it planned
 * from, its questions in buckets (each answered bucket with what Qalam AI made of it, then the next
 * one), and the libraries it found for what the catalog can't draw. Once Qalam AI has what it
 * needs (or the designer skips), Generate starts.
 */
const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
/** A quiet text action under a card ("Skip the questions…", "Change answers"). */
const quietBtn = "q-item inline-flex h-[24px] items-center gap-[6px] self-start rounded-md -ml-[6px] px-[6px] text-caption text-fg-subtle hover:bg-hover hover:text-fg";

export function PlanView({ chatId, t }: { chatId: string; t: ChatTurn }) {
  const s = t.plan!;
  const buckets = bucketsOf(s);
  const last = buckets.length - 1;
  const questions = useMemo(() => bucketsOf(s).map((_, i) => bucketQuestions(s, i)), [s]);
  const update = (fn: (cur: PlanState) => PlanState) => patchTurn(chatId, t.id, (cur) => (cur.plan ? { plan: fn(cur.plan) } : {}));
  /** Done with the current bucket: Qalam AI reads the answers (or, skipped, generates), and the platform settles. */
  const close = (form: FlowState, phase: "analyzing" | "skipped") => {
    patchTurn(chatId, t.id, (cur) => {
      const plan = closeBucket(cur.plan!, form, phase);
      return { plan, request: { ...cur.request, platform: planPlatform(plan, cur.request.platform ?? "mobile") } };
    });
    retry(chatId, t.id);
  };

  if (s.phase === "failed" && t.status !== "running")
    return (
      <div className="flex flex-col gap-[8px]">
        <p className="text-caption text-fg-muted">Qalam AI couldn&apos;t plan this one{s.error ? ` (${s.error.slice(0, 140)})` : ""}.</p>
        <Button size="sm" variant="secondary" className="self-start" onClick={() => close({ current: REVIEW, answers: {}, visited: [], editing: false, submitted: true }, "skipped")}>
          <QalamAIGlyph size={12} /> Generate without a plan
        </Button>
      </div>
    );
  if (!s.result || !buckets.length) return null;
  const platform = planPlatform(s, t.request.platform ?? "mobile");
  const answered = (n: number) =>
    buckets.slice(0, n).map((b, i) => <AnsweredBucket key={i} n={i + 1} rounds={buckets.length} questions={questions[i]} bucket={b} picks={s.phase === "skipped" && i === last} ready={s.phase === "ready" && i === last} />);

  if (s.phase === "asking" && t.status !== "running")
    return (
      <div className="flex flex-col gap-[8px]">
        <PlanSummary r={s.result} platform={platform} />
        <MarketStandard s={s.result.standard} market={s.market} />
        {answered(last)}
        <Questionnaire
          key={last}
          questions={questions[last]}
          state={buckets[last].form}
          title={last ? "A few more questions" : "Before I design"}
          onChange={(form) => update((cur) => ({ ...cur, form: undefined, buckets: bucketsOf(cur).map((b, i) => (i === last ? { ...b, form } : b)) }))}
          onSubmit={(form) => close(form, "analyzing")}
          review={{
            title: "Send these answers?",
            submitLabel: "Send answers",
            extra: <Libraries r={s.result} libs={s.libraries} />,
            footnote: "Qalam AI reads your answers and asks more only if they would change the design; then it designs. The avoid list goes to the model as a hard rule.",
          }}
        />
        <button type="button" className={quietBtn} onClick={() => close(buckets[last].form, "skipped")}>
          {last ? "Skip the rest and generate with Qalam AI's picks" : "Skip the questions and use Qalam AI's picks"}
        </button>
      </div>
    );

  // Reading the answers, or agreed (or planning again after a stop): the record of what the screens were built from.
  const reading = s.phase === "analyzing";
  return (
    <div className="flex flex-col gap-[8px]">
      <PlanSummary r={s.result} platform={platform} compact={!reading} />
      <MarketStandard s={s.result.standard} market={s.market} compact={!reading} />
      {answered(buckets.length)}
      <Libraries r={s.result} libs={s.libraries} />
      {reading && t.status !== "running" && (
        <button
          type="button"
          className={quietBtn}
          title="Skip reading the answers and design with what you've answered so far"
          onClick={() => {
            update((cur) => ({ ...cur, phase: "ready" }));
            retry(chatId, t.id);
          }}
        >
          <QalamAIGlyph size={12} /> Generate with these answers
        </button>
      )}
      {(s.phase === "ready" || s.phase === "skipped") && t.status !== "running" && (
        <button
          type="button"
          className={quietBtn}
          title="Answer the last questions again and generate again (the screens already on the canvas stay)"
          onClick={() => update(reopenBucket)}
        >
          <RotateCcw size={12} {...icon} /> Change answers
        </button>
      )}
    </div>
  );
}

/** A bucket the designer answered, and what Qalam AI made of the answers. */
function AnsweredBucket({ n, rounds, questions, bucket, picks, ready }: { n: number; rounds: number; questions: Question[]; bucket: PlanBucket; picks: boolean; ready: boolean }) {
  if (!questions.length) return null;
  const label = picks ? "Qalam AI's picks" : rounds > 1 ? `Your answers · round ${n}` : "Your answers";
  return (
    <div className="flex flex-col gap-[6px]">
      <AnswersSummary questions={questions} answers={bucket.form.answers} label={label} />
      {bucket.analysis && (
        <div className="flex flex-col gap-[4px] rounded-lg bg-ai-subtle p-[10px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ai)_18%,transparent)]">
          <span className={qr.caption}>
            <QalamAIGlyph size={12} /> What I took from your answers{ready ? " · ready to design" : ""}
          </span>
          <p className="text-body leading-[20px] text-fg" dir="auto">
            {bucket.analysis}
          </p>
        </div>
      )}
    </div>
  );
}

function PlanSummary({ r, platform, compact }: { r: PlanResult; platform: keyof typeof PLATFORMS; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-[6px] rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className={clsx(rc.eyebrow, "flex items-center gap-[6px]")}>
        <ListChecks size={12} {...icon} /> Plan
        <span className="ml-auto flex min-w-0 gap-[4px]">
          {r.product && <span className={clsx(rc.chip, "max-w-[180px] truncate")}>{r.product}</span>}
          <span className={clsx(rc.chip, "shrink-0 text-fg")}>{PLATFORMS[platform].label}</span>
        </span>
      </div>
      <p className="text-body leading-[20px] text-fg" dir="auto">
        {r.understanding}
      </p>
      {!compact && r.layout && (
        <p className="text-caption text-fg-muted" dir="auto">
          {r.layout}
        </p>
      )}
      {!compact && !!r.interactions?.length && (
        <div className="flex items-start gap-[6px] text-caption text-fg-muted" dir="auto">
          <MousePointerClick size={12} {...icon} className="mt-[2px] shrink-0 text-selection" />
          <span>
            <span className="font-medium text-fg">Prototyped on the screen, not drawn:</span> {r.interactions.join(" · ")}
          </span>
        </div>
      )}
      {r.avoid.length > 0 && (
        <div className="flex items-start gap-[6px] text-caption text-fg-muted" dir="auto">
          <Ban size={12} {...icon} className="mt-[2px] shrink-0 text-danger" />
          <span>
            <span className="font-medium text-fg">Avoid:</span> {r.avoid.join(" · ")}
          </span>
        </div>
      )}
      {!compact && r.variants.length === 1 && (
        <p className="text-caption text-fg-muted" dir="auto">
          <span className="font-medium text-fg">Direction:</span> {r.variants[0]}
        </p>
      )}
      {!compact && r.variants.length > 1 && (
        <ol className="flex list-decimal flex-col gap-[2px] pl-[16px] text-caption text-fg-muted marker:text-fg-subtle marker:tnum" dir="auto">
          {r.variants.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Links to what a lookup read, by site. */
function SourceChips({ sources, max = 6 }: { sources: ResearchSource[]; max?: number }) {
  if (!sources.length) return null;
  return (
    <div className="q-stagger flex flex-wrap gap-[4px]">
      {sources.slice(0, max).map((src, k) => (
        <a
          key={src.url}
          href={src.url}
          target="_blank"
          rel="noreferrer"
          title={src.title}
          style={{ "--i": k } as CSSProperties}
          className="q-item inline-flex h-[22px] max-w-[180px] items-center rounded-md bg-muted px-[6px] text-micro text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-hover hover:text-fg"
        >
          <span className="truncate">{hostOf(src.url)}</span>
        </a>
      ))}
    </div>
  );
}

/** The flow the screen belongs to, with its own step marked. */
function Flow({ flow, here }: { flow: string[]; here: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-[4px] gap-y-[2px] text-caption text-fg-subtle" dir="auto">
      {flow.map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight size={10} {...icon} className="shrink-0 rtl:rotate-180" />}
          <span aria-current={i === here ? "step" : undefined} className={clsx(i === here && "rounded-sm bg-active px-[4px] font-medium text-fg")}>
            {step}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * How the leading products design this screen (looked up, or from what Qalam AI knows), and where
 * the designer's brief departs from it ("Your call") or adds to it ("Added").
 */
function MarketStandard({ s, market, compact }: { s?: PlanStandard; market?: ResearchInfo; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!s) return null;
  const researched = !!market?.notes;
  const sources = researched ? market!.sources : [];
  const basis = researched ? (sources.length ? `${sources.length} source${sources.length > 1 ? "s" : ""}` : "looked up") : "from what Qalam AI knows";
  const full = !compact || open;
  return (
    <div className={clsx(qr.inset, "flex flex-col gap-[6px] p-[10px]")}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-[6px] text-left text-caption font-medium text-fg">
        <Compass size={14} {...icon} className="shrink-0 text-fg-subtle" />
        <span className="flex-1">
          Market standard <span className="font-normal text-fg-subtle tnum">· {basis}</span>
        </span>
        <ChevronRight size={12} {...icon} className={clsx("shrink-0 text-fg-subtle transition-transform duration-fast", open && "rotate-90")} />
      </button>
      <p className="text-caption text-fg" dir="auto">
        {s.domain}
        {s.leaders.length > 0 && <span className="text-fg-subtle"> · as {s.leaders.join(", ")} do it</span>}
      </p>
      {full && s.architecture.length > 0 && (
        <ol className="flex list-decimal flex-col gap-[2px] pl-[16px] text-caption text-fg-muted marker:text-fg-subtle marker:tnum" dir="auto">
          {s.architecture.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ol>
      )}
      {full && s.primaryAction && (
        <p className="text-caption text-fg-muted" dir="auto">
          <span className="text-fg">Primary action:</span> {s.primaryAction}
        </p>
      )}
      {s.flow.length > 1 && <Flow flow={s.flow} here={s.here} />}
      {s.changes.length > 0 && (
        <ul className="flex flex-col gap-[4px] border-t border-line-subtle pt-[6px]">
          {s.changes.map((c, i) => (
            <li key={i} className="flex items-start gap-[6px] text-caption text-fg-muted" dir="auto">
              <span className="shrink-0" title={c.kind === "prescribed" ? "You said how it must be: followed as you said, over the standard" : "Something the standard doesn't have: fitted into it"}>
                <Tag tone={c.kind === "prescribed" ? "ai" : "neutral"} icon={null}>
                  {c.kind === "prescribed" ? "Your call" : "Added"}
                </Tag>
              </span>
              <span>
                <span className="text-fg">{c.asked}</span> · {c.applied}
              </span>
            </li>
          ))}
        </ul>
      )}
      {full && s.patterns.length > 1 && (
        <ul className="flex flex-col gap-[2px] text-caption text-fg-muted" dir="auto">
          {s.patterns.map((p, i) => (
            <li key={i} className="relative pl-[12px]">
              <span className="absolute left-0 text-fg-faint">•</span>
              {p}
            </li>
          ))}
        </ul>
      )}
      {open && researched && <Notes notes={market!.notes} />}
      <SourceChips sources={sources} max={open ? 12 : 4} />
      {market?.error && (
        <div className="flex items-start gap-[6px] text-caption text-fg-subtle">
          <TriangleAlert size={12} {...icon} className="mt-[2px] shrink-0 text-warning" />
          <span>Couldn&apos;t look it up ({market.error.slice(0, 140)}), so this is from what Qalam AI knows.</span>
        </div>
      )}
    </div>
  );
}

/** What the catalog can't draw, and the open-source libraries found for it. */
function Libraries({ r, libs }: { r: PlanResult; libs?: PlanLibraries }) {
  if (!r.gaps.length) return null;
  return (
    <div className={clsx(qr.inset, "flex flex-col gap-[6px] p-[10px]")}>
      <div className="flex items-center gap-[6px] text-caption font-medium text-fg">
        <Blocks size={14} {...icon} className="shrink-0 text-fg-subtle" /> Not in the catalog
        {libs?.research?.sources.length ? <span className="font-normal text-fg-subtle tnum">· {libs.research.sources.length} sources</span> : null}
      </div>
      <ul className="flex flex-col gap-[2px] text-caption text-fg-muted">
        {r.gaps.map((g) => (
          <li key={g.need} dir="auto">
            <span className="text-fg">{g.need}</span> <span className="text-fg-subtle">· closest: {g.closest}</span>
          </li>
        ))}
      </ul>
      {libs?.status === "searching" && (
        <div className="flex items-center gap-[8px] text-caption text-fg-subtle">
          <QalamAIGlyph size={12} />
          <span className="q-shimmer-text truncate">{libs.activity ?? "Looking up libraries"}…</span>
        </div>
      )}
      {libs?.status === "done" && libs.research && (
        <>
          <Notes notes={libs.research.notes} />
          <SourceChips sources={libs.research.sources} />
        </>
      )}
      {libs?.status === "error" && (
        <div className="flex items-start gap-[6px] text-caption text-fg-subtle">
          <TriangleAlert size={12} {...icon} className="mt-[2px] shrink-0 text-warning" />
          <span>Couldn&apos;t look up libraries{libs.error ? ` (${libs.error.slice(0, 140)})` : ""}. Qalam AI will compose these parts from the closest components.</span>
        </div>
      )}
    </div>
  );
}
