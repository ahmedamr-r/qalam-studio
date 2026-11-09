import { useEffect, useState } from "react";
import type { Lookup } from "@/asking/types";
import { loadScreenReview, useScreenReviews } from "@/org/screens";
import type { ScreenFinding, ScreenReview } from "@/screens/types";
import type { PartData } from "../../chat/types";
import { ReplyChips } from "../../chat/ChatThread";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { Spinner } from "../../controls";
import { r } from "../../recipes";
import { Shot } from "../../seen/Shot";
import { lookAtScreensAgain, putScreensOnCanvas, useCanvasChat } from "./store";

/** A plan turn's interview, followed as the chat changes. */
const usePlanAsking = (turn: unknown) =>
  useCanvasChat((s) => {
    const j = s.chat.turns.find((t) => t.id === turn)?.job;
    return j?.kind === "plan" ? (j.asking ?? null) : null;
  });

/*
 * The screenshots an answer gave, in the thread under that round: while they're looked at, then the look:
 * each screen small with numbered marks where its findings point, and the findings ranked, each with its
 * side and its one change. A click opens a screen big, marks and all.
 */

const SIDE = { customer: "Customer", business: "Business" } as const;

/** Each screen's marks: the findings that point at printed words on it, by their number. */
function marksOn(findings: readonly ScreenFinding[], shot: string) {
  return findings.flatMap((f, i) => (f.shot === shot && f.on ? [{ box: f.on.box, label: String(i + 1) }] : []));
}

function Shots({ l, review }: { l: Lookup; review?: ScreenReview }) {
  const shots = review?.shots.map((s) => ({ asset: `asset:${s.asset}`, title: s.name, hash: s.asset })) ?? (l.shots ?? []).map((s) => ({ ...s, hash: s.asset.replace(/^asset:/, "") }));
  return (
    <ol className="flex flex-wrap items-start gap-[6px]" aria-label="The screens, in the order you showed them">
      {shots.map((s, i) => (
        <li key={s.asset} className="flex items-start gap-[6px]">
          {i > 0 && (
            <span aria-hidden className="mt-[24px] text-micro text-fg-faint">
              →
            </span>
          )}
          <span className="flex w-[64px] flex-col gap-[2px]">
            <Shot shot={s.asset} label={s.title} w={64} marks={review ? marksOn(review.findings, s.hash) : []} />
            <span className="truncate text-micro text-fg-subtle" title={s.title}>
              {s.title}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Finding({ f, n }: { f: ScreenFinding; n: number }) {
  return (
    <li className="flex gap-[8px]">
      <span aria-hidden className="mt-[1px] grid size-[18px] shrink-0 place-items-center rounded-full bg-ai text-micro font-medium text-panel tnum">
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-[2px]">
        <p className="text-body leading-[20px] text-fg" dir="auto">
          <span className="text-caption font-medium text-fg-muted">
            {SIDE[f.side]} · {f.name} ·{" "}
          </span>
          {f.title}
        </p>
        <p className="text-caption leading-[18px] text-fg-muted" dir="auto">
          {f.why}
        </p>
        {f.change && (
          <p className="text-caption leading-[18px] text-fg" dir="auto">
            <span className="font-medium">Change:</span> {f.change.what}
          </p>
        )}
      </div>
    </li>
  );
}

/** The findings onto the canvas: each a problem resting on its screen, its change a solution under it, reviewed there; what's decided already said in a line. */
function OnCanvas({ review }: { review: ScreenReview }) {
  const [busy, setBusy] = useState(false);
  const decided = Object.values(review.decided ?? {});
  const taken = decided.filter((d) => d === "accepted").length;
  const left = decided.filter((d) => d === "discarded").length;
  const open = review.findings.filter((f) => !review.decided?.[f.key]).length;
  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      {open > 0 && (
        <button
          type="button"
          disabled={busy}
          className={r.replyChipPrimary}
          onClick={() => {
            setBusy(true);
            void putScreensOnCanvas(review.id).finally(() => setBusy(false));
          }}
        >
          {busy ? (
            <>
              <Spinner size={12} /> Checking them against your evidence
            </>
          ) : (
            "Put on the canvas"
          )}
        </button>
      )}
      {(taken > 0 || left > 0) && (
        <span className="text-caption text-fg-muted">
          {[taken ? `${taken} on the canvas` : "", left ? `${left} left out` : ""].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}

/** The screenshots a round gave, looked at for the problem. */
export function ScreenReviewPart({ data }: { data: PartData }) {
  const state = usePlanAsking(data.turn);
  const l = state?.lookups.find((x) => x.id === data.lookup);
  const id = l?.review;
  const review = useScreenReviews((s) => (id ? s.reviews[id] : undefined));
  useEffect(() => {
    if (id) void loadScreenReview(id);
  }, [id]);
  if (!l) return null;
  const n = l.shots?.length ?? 0;
  const head = (words: string) => (
    <p className="flex items-center gap-[6px] text-caption font-medium text-fg-muted">
      <QalamAIGlyph size={12} />
      {words}
    </p>
  );
  return (
    <div className="q-sheet flex flex-col gap-[10px] rounded-xl p-[12px]">
      {l.state === "running" ? (
        <>
          {head(`Looking at your ${n === 1 ? "screen" : `${n} screens`} for what you're working out`)}
          <Shots l={l} />
          <p className="flex items-center gap-[6px] text-caption text-fg-muted">
            <Spinner size={12} /> Keeping them with your screens, then looking
          </p>
        </>
      ) : l.state !== "done" ? (
        <>
          {head(n === 1 ? "Your screen" : "Your screens")}
          <Shots l={l} />
          <p className="text-caption text-fg-muted">{l.state === "failed" ? `I couldn't look at them: ${l.error ?? "something went wrong"}` : "You stopped the look at them."}</p>
          <ReplyChips>
            <button type="button" className={r.replyChip} onClick={() => lookAtScreensAgain(String(data.turn), l.id)}>
              Look again
            </button>
          </ReplyChips>
        </>
      ) : !review ? (
        <>
          {head(n === 1 ? "Kept with your screens" : `Kept ${n} screens with your screens`)}
          <Shots l={l} />
        </>
      ) : (
        <>
          {head(review.findings.length ? `On your ${review.shots.length === 1 ? "screen" : `${review.shots.length} screens`}, for what you're working out` : n === 1 ? "Your screen" : "Your screens")}
          <Shots l={l} review={review} />
          {review.unseen ? (
            <p className="text-caption text-fg-muted">I couldn&apos;t look at them for the problem: the engine here can&apos;t see pictures. They&apos;re kept with your screens.</p>
          ) : !review.findings.length ? (
            <p className="text-caption text-fg-muted">Nothing on {review.shots.length === 1 ? "it" : "them"} bears on what you&apos;re working out, as far as I can see.</p>
          ) : (
            <ol className="flex flex-col gap-[10px]" aria-label="What bears on it, the most first">
              {review.findings.map((f, i) => (
                <Finding key={f.key} f={f} n={i + 1} />
              ))}
            </ol>
          )}
          {review.unread && <p className="text-micro text-fg-subtle">Nothing printed on them could be read on this computer, so nothing&apos;s marked or quoted.</p>}
          {review.findings.length > 0 && <OnCanvas review={review} />}
          {review.left.length > 0 && (
            <details className="q-fold text-caption text-fg-muted">
              <summary className="cursor-pointer list-none hover:text-fg [&::-webkit-details-marker]:hidden">Left out ({review.left.length})</summary>
              <ul className="mt-[6px] flex flex-col gap-[4px]">
                {review.left.map((x, i) => (
                  <li key={i} dir="auto">
                    {x.what}: {x.why.charAt(0).toLowerCase() + x.why.slice(1)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
