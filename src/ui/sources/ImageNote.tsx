import { useEffect, useState } from "react";
import { assetURL } from "@/doc/assets";
import { imageUnreadLine } from "@/discovery/ingest/image";
import type { SourceImage } from "@/discovery/sources";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { useLatestReviewOn } from "@/org/screens";
import { Shot } from "../seen/Shot";

/*
 * A picture kept as a source, above its words: the picture, then Qalam AI's reading of it, said to
 * be its reading. Its printed words are the source's text below, which is all a quote rests on; who
 * said which line is Qalam AI's pairing of them, so the person can compare with the picture.
 */

const SHOWS: Record<SourceImage["shows"], string> = { screen: "A product's screen", reviews: "Reviews", chat: "A conversation", chart: "A chart", table: "A table", document: "A document", photo: "A photo", other: "A picture" };

/** What the latest look at their screens found on this one: the screen with its numbered marks, and the findings, a line each. */
function SeenOnIt({ shot, about }: { shot: string; about?: string }) {
  const review = useLatestReviewOn(shot);
  const found = review ? review.findings.flatMap((f, i) => (f.shot === shot ? [{ f, n: i + 1 }] : [])) : [];
  if (!review || !found.length) return null;
  return (
    <section aria-label="What Qalam AI saw on it" className="flex flex-col gap-[8px]">
      <Shot shot={`asset:${shot}`} label={about ?? "The screen"} w={220} marks={found.flatMap(({ f, n }) => (f.on ? [{ box: f.on.box, label: String(n) }] : []))} />
      <div className="q-sheet flex flex-col gap-[6px] rounded-lg px-[10px] py-[8px]">
        <p className="flex items-center gap-[6px] text-micro font-medium text-fg-muted">
          <QalamAIGlyph size={12} />
          What Qalam AI saw on it, for “{review.focus.length > 80 ? `${review.focus.slice(0, 79)}…` : review.focus}”
        </p>
        <ol className="flex flex-col gap-[6px]">
          {found.map(({ f, n }) => (
            <li key={f.key} className="flex gap-[6px] text-caption leading-[18px]">
              <span className="font-medium text-fg-muted tnum">{n}</span>
              <span className="min-w-0" dir="auto">
                <span className="text-fg">{f.title}</span>
                {f.change && <span className="block text-fg-muted">Change: {f.change.what}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ImageNote({ image, about, hasText }: { image: SourceImage | undefined; about?: string; hasText: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const review = useLatestReviewOn(image?.shows === "screen" ? image.asset : null);
  const seen = !!review?.findings.some((f) => f.shot === image?.asset);
  useEffect(() => {
    if (!image) return;
    let live = true;
    void assetURL(`asset:${image.asset}`).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [image?.asset]);
  if (!image) return null;
  const unread = imageUnreadLine(image, hasText);
  return (
    <div className="mb-[12px] flex flex-col gap-[10px]">
      {seen ? <SeenOnIt shot={image.asset} about={about} /> : url && <img src={url} alt={about ?? "The picture"} className="max-h-[360px] w-full rounded-lg object-contain shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" style={image.w && image.h ? { aspectRatio: `${image.w} / ${image.h}` } : undefined} />}
      {(about || image.reading.length > 0) && (
        <section aria-label="Qalam AI's reading of it" className="q-sheet flex flex-col gap-[6px] rounded-lg px-[10px] py-[8px]">
          <p className="flex items-center gap-[6px] text-micro font-medium text-fg-muted">
            <QalamAIGlyph size={12} />
            Qalam AI&apos;s reading · {SHOWS[image.shows]}
            {image.product && <span className="font-normal">· {image.product}</span>}
          </p>
          {about && (
            <p className="text-caption leading-[18px] text-fg" dir="auto">
              {about}
            </p>
          )}
          {image.reading.length > 0 && (
            <ul className="flex list-disc flex-col gap-[2px] pl-[16px] text-caption leading-[18px] text-fg-muted">
              {image.reading.map((l) => (
                <li key={l} dir="auto">
                  {l}
                </li>
              ))}
            </ul>
          )}
          <p className="text-micro text-fg-subtle">{image.paired ? "Its printed words are below; who said which is Qalam AI's pairing, so compare it with the picture." : "A description, never something a card rests on: only the words printed in it, below, can be."}</p>
        </section>
      )}
      {unread && <p className="text-caption text-fg-muted">{unread}</p>}
      {image.left?.length ? (
        <details className="rounded-md px-[8px] py-[6px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <summary className="cursor-pointer">Left out of Qalam AI&apos;s reading ({image.left.length})</summary>
          <ul className="mt-[6px] flex flex-col gap-[4px]">
            {image.left.map((l, i) => (
              <li key={i} dir="auto">
                “{l.said}”: {l.why.charAt(0).toLowerCase() + l.why.slice(1)}.
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
