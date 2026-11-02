import { useEffect, useState } from "react";
import { assetURL } from "@/doc/assets";
import { LEFT_WORDS, pagesLine, picturesLine, UNREAD_WORDS } from "@/discovery/ingest/pictures";
import type { SourcePicture, SourcePictures } from "@/discovery/sources";

/*
 * What came of a PDF's pictures, above its text: which pages were read, what was left out and why,
 * and each page as a picture beside it. Code checks a row's words are printed on its page; which
 * label goes with which number is Qalam AI's reading, so the person can compare.
 */

const KIND: Record<SourcePicture["kind"], string> = { scan: "Scanned page", chart: "Chart", table: "Table", figure: "Figure", words: "Words in a picture" };

function PagePicture({ asset, page }: { asset: string; page: number }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void assetURL(`asset:${asset}`).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [open, asset]);
  return (
    <>
      <button type="button" className="text-fg underline decoration-fg/30 underline-offset-2" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide the page" : "See the page"}
      </button>
      {open && url && <img src={url} alt={`Page ${page}, as read`} className="mt-[4px] w-full rounded-md shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" />}
    </>
  );
}

export function PicturesNote({ pictures }: { pictures: SourcePictures | undefined }) {
  const line = picturesLine(pictures);
  if (!pictures || !line) return null;
  const pages = [...new Set(pictures.read.map((p) => p.page))].map((page) => ({ page, parts: pictures.read.filter((p) => p.page === page) }));
  return (
    <details className="mb-[10px] rounded-md px-[8px] py-[6px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <summary className="cursor-pointer">{line}</summary>
      <div className="mt-[6px] flex flex-col gap-[8px]">
        {pictures.read.some((p) => p.kind !== "scan" && p.span) && <p>Every word and number kept is printed on its page. Which label goes with which number is Qalam AI's reading, so compare it with the page.</p>}
        {pages.map(({ page, parts }) => {
          const asset = parts.find((p) => p.asset)?.asset;
          return (
            <div key={page} className="flex flex-col gap-[2px]">
              <p>
                <span className="text-fg">Page {page}</span> · {[...new Set(parts.map((p) => KIND[p.kind]))].join(", ")}
              </p>
              {parts.flatMap((p) => p.left ?? []).map((l, i) => (
                <p key={i} dir="auto">
                  Left out: “{l.words}” {LEFT_WORDS[l.why]}.
                </p>
              ))}
              {asset && (
                <div>
                  <PagePicture asset={asset} page={page} />
                </div>
              )}
            </div>
          );
        })}
        {(pictures.unread ?? []).map((u) => (
          <p key={u.why}>
            {pagesLine(u.pages)} weren't read. {UNREAD_WORDS[u.why]}
          </p>
        ))}
      </div>
    </details>
  );
}
