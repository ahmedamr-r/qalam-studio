import { useEffect, useState } from "react";
import { loadScreenReview, useScreenReviews } from "@/org/screens";
import type { ScreenFinding, ScreenReview } from "@/screens/types";
import type { PartData } from "../../chat/types";
import { ReplyChips } from "../../chat/ChatThread";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { Spinner } from "../../controls";
import { r } from "../../recipes";
import { Shot } from "../../seen/Shot";
import { lookAtScreensAgain, lookAtTakenAgain, notAScreen, putScreensOnCanvas, useCanvasChat } from "./store";

/*
 * Screenshots of their own product in the thread: those a round's answer gave, under that round, and those
 * dropped in the chat, under what was taken in. While they're looked at, then the look: each screen small
 * with numbered marks where its findings point, and the findings ranked, each with its side and its one
 * change. A click opens a screen big, marks and all.
 */

const SIDE = { customer: "Customer", business: "Business" } as const;

/** A plan turn's interview, followed as the chat changes. */
const usePlanAsking = (turn: unknown) =>
  useCanvasChat((s) => {
    const j = s.chat.turns.find((t) => t.id === turn)?.job;
    return j?.kind === "plan" ? (j.asking ?? null) : null;
  });

/** A look kept in the project, read once this window wants it. */
function useReview(id: string | undefined) {
  const review = useScreenReviews((s) => (id ? s.reviews[id] : undefined));
  useEffect(() => {
    if (id) void loadScreenReview(id);
  }, [id]);
  return review;
}

/** Each screen's marks: the findings that point at printed words on it, by their number. */
function marksOn(findings: readonly ScreenFinding[], shot: string) {
  return findings.flatMap((f, i) => (f.shot === shot && f.on ? [{ box: f.on.box, label: String(i + 1) }] : []));
}

type ShotRef = { asset: string; title: string };

function Shots({ shots, review, onNotOurs }: { shots: readonly ShotRef[]; review?: ScreenReview; onNotOurs?: (s: ShotRef) => void }) {
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
            <Shot shot={s.asset} label={s.title} w={64} marks={review ? marksOn(review.findings, s.asset.replace(/^asset:/, "")) : []} />
            <span className="truncate text-micro text-fg-subtle" title={s.title}>
              {s.title}
            </span>
            {onNotOurs && (
              <button
                type="button"
                title="Not a screen of your product: take it in as any picture"
                className="self-start whitespace-nowrap text-micro text-fg-subtle underline decoration-fg/20 underline-offset-2 hover:text-fg"
                onClick={() => onNotOurs(s)}
              >
                Not ours
              </button>
            )}
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
        {f.weigh && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-[6px] text-caption leading-[18px]">
            <dt className="text-fg-subtle">Customers</dt>
            <dd className="text-fg-muted" dir="auto">
              {f.weigh.customers}
            </dd>
            <dt className="text-fg-subtle">Business</dt>
            <dd className="text-fg-muted" dir="auto">
              {!f.weigh.known && <span className="text-fg-subtle">Not known yet: </span>}
              {f.weigh.business}
            </dd>
          </dl>
        )}
        {f.change && (
          <p className="text-caption leading-[18px] text-fg" dir="auto">
            <span className="font-medium">{f.weigh?.apart ? "Your call:" : "Change:"}</span> {f.change.what}
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

const Head = ({ children }: { children: string }) => (
  <p className="flex items-center gap-[6px] text-caption font-medium text-fg-muted">
    <QalamAIGlyph size={12} />
    {children}
  </p>
);

/** A look at the screens: the screens with their marks, what bears on the problem, and on to the canvas. */
function Look({ review, shots, onNotOurs }: { review: ScreenReview; shots: readonly ShotRef[]; onNotOurs?: (s: ShotRef) => void }) {
  const n = review.shots.length;
  return (
    <>
      <Head>{review.findings.length ? (review.first ? `A first look at your ${n === 1 ? "screen" : `${n} screens`}` : `On your ${n === 1 ? "screen" : `${n} screens`}, weighed for customers and the business`) : n === 1 ? "Your screen" : "Your screens"}</Head>
      <Shots shots={shots} review={review} {...(onNotOurs ? { onNotOurs } : {})} />
      {review.unseen ? (
        <p className="text-caption text-fg-muted">I couldn&apos;t look at them for the problem: the engine here can&apos;t see pictures. They&apos;re kept with your screens.</p>
      ) : !review.findings.length ? (
        <p className="text-caption text-fg-muted">Nothing on {n === 1 ? "it" : "them"} bears on what you&apos;re working out, as far as I can see.</p>
      ) : (
        <ol className="flex flex-col gap-[10px]" aria-label="What bears on it, the most first">
          {review.findings.map((f, i) => (
            <Finding key={f.key} f={f} n={i + 1} />
          ))}
        </ol>
      )}
      {review.unread && <p className="text-micro text-fg-subtle">Nothing printed on them could be read on this computer, so nothing&apos;s marked or quoted.</p>}
      {review.findings.length > 0 && (review.first ? <p className="text-caption text-fg-muted">I'll ask what these screens are for, who uses them and what the business needs from them, then look again with both sides in mind.</p> : <OnCanvas review={review} />)}
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
  );
}

/** The screenshots a round gave, looked at for the problem. */
export function ScreenReviewPart({ data }: { data: PartData }) {
  const state = usePlanAsking(data.turn);
  const l = state?.lookups.find((x) => x.id === data.lookup);
  const review = useReview(l?.review);
  if (!l) return null;
  const shots = l.shots ?? [];
  const n = shots.length;
  return (
    <div className="q-sheet flex flex-col gap-[10px] rounded-xl p-[12px]">
      {l.state === "running" ? (
        <>
          <Head>{`Looking at your ${n === 1 ? "screen" : `${n} screens`} for what you're working out`}</Head>
          <Shots shots={shots} />
          <p className="flex items-center gap-[6px] text-caption text-fg-muted">
            <Spinner size={12} /> {n === 1 ? "Keeping it with your screens, then looking" : "Keeping them with your screens, then looking"}
          </p>
        </>
      ) : l.state !== "done" ? (
        <>
          <Head>{n === 1 ? "Your screen" : "Your screens"}</Head>
          <Shots shots={shots} />
          <p className="text-caption text-fg-muted">{l.state === "failed" ? `I couldn't look at them: ${l.error ?? "something went wrong"}` : "You stopped the look at them."}</p>
          <ReplyChips>
            <button type="button" className={r.replyChip} onClick={() => lookAtScreensAgain(String(data.turn), l.id)}>
              Look again
            </button>
          </ReplyChips>
        </>
      ) : !review ? (
        <>
          <Head>{n === 1 ? "Kept with your screens" : `Kept ${n} screens with your screens`}</Head>
          <Shots shots={shots} />
        </>
      ) : (
        <Look review={review} shots={shots} />
      )}
    </div>
  );
}

/** Screenshots of their product dropped in the chat: kept as its screens, and looked at when there's something to look at them for. */
export function TakenScreensPart({ data }: { data: PartData }) {
  const j = useCanvasChat((s) => s.chat.turns.find((t) => t.id === data.turn)?.job);
  const screens = j?.kind === "take" ? j.screens : undefined;
  const review = useReview(screens?.review);
  if (!screens) return null;
  const shots = screens.shots.filter((s) => !screens.other?.includes(s.asset));
  const n = shots.length;
  const notOurs = (s: ShotRef) => void notAScreen(String(data.turn), s).catch(() => {});
  if (!n) return null;
  return (
    <div className="q-sheet flex flex-col gap-[10px] rounded-xl p-[12px]">
      {screens.state === "keeping" || screens.state === "looking" ? (
        <>
          <Head>{screens.state === "looking" ? `Looking at your ${n === 1 ? "screen" : `${n} screens`} for what you're working out` : `Keeping ${n === 1 ? "it" : "them"} with your screens`}</Head>
          <Shots shots={shots} />
          <p className="flex items-center gap-[6px] text-caption text-fg-muted">
            <Spinner size={12} /> {screens.state === "looking" ? `Keeping ${n === 1 ? "it" : "them"} with your screens, then looking` : `Reading what's on ${n === 1 ? "it" : "them"}`}
          </p>
        </>
      ) : screens.state === "failed" ? (
        <>
          <Head>{n === 1 ? "Your screen" : "Your screens"}</Head>
          <Shots shots={shots} onNotOurs={notOurs} />
          <p className="text-caption text-fg-muted" dir="auto">
            {screens.error ?? "Something went wrong as I looked at them."}
          </p>
          <ReplyChips>
            <button type="button" className={r.replyChip} onClick={() => void lookAtTakenAgain(String(data.turn))}>
              Look again
            </button>
          </ReplyChips>
        </>
      ) : review ? (
        <Look review={review} shots={shots} onNotOurs={notOurs} />
      ) : (
        <>
          <Head>{n === 1 ? "Kept with your screens" : `Kept ${n} screens with your screens`}</Head>
          <Shots shots={shots} onNotOurs={notOurs} />
          {screens.state === "kept" && <p className="text-caption text-fg-muted">Say what&apos;s going wrong on {n === 1 ? "it" : "them"}, and I&apos;ll look at {n === 1 ? "it" : "them"} for that.</p>}
        </>
      )}
    </div>
  );
}
