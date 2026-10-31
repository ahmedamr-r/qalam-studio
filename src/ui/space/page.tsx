import { useMemo, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { pageOf } from "@/space/pages";
import { IconBtn } from "../controls";
import { panelDepth, replaceAddress, useAddress } from "../nav";

/*
 * A goal's or a topic page's page, open in a space's canvas panel: the canvas's address with
 * ?goal=<id> or ?page=<topic> (and `at`, a section to scroll to). Opening one is a step in history
 * (src/ui/nav.ts), so Back closes it; × goes back past every page opened over the canvas.
 */

/** The page the address opens over the canvas, if any. */
export function usePanelPage() {
  const address = useAddress();
  return useMemo(() => {
    const i = address.indexOf("?");
    return pageOf(i < 0 ? "" : address.slice(i));
  }, [address]);
}

/** The canvas's address without the page (its other keys stay). */
function withoutPage(): string {
  const u = new URL(window.location.href);
  for (const k of ["goal", "page", "at"]) u.searchParams.delete(k);
  return `${u.pathname}${u.searchParams.size ? `?${u.searchParams}` : ""}${u.hash}`;
}

/** Close the page: back past the steps that opened it, or (opened by its address, or `gone`: deleted) off the address. */
export function closePage(o: { gone?: boolean } = {}) {
  const n = panelDepth();
  if (n > 0 && !o.gone) return history.go(-n);
  replaceAddress(withoutPage());
}

/** Drop `at` once its section is in view, so a later move doesn't scroll there again. */
export function doneWithAt() {
  const u = new URL(window.location.href);
  if (!u.searchParams.has("at")) return;
  u.searchParams.delete("at");
  replaceAddress(`${u.pathname}?${u.searchParams}${u.hash}`);
}

/** Scroll the panel to a section of the page (`data-at`), within the panel only. */
export function scrollToSection(root: HTMLElement | null, at: string) {
  const el = root?.querySelector<HTMLElement>(`[data-at="${CSS.escape(at)}"]`);
  const aside = root?.closest("aside");
  if (!el || !aside) return false;
  aside.scrollTop += el.getBoundingClientRect().top - aside.getBoundingClientRect().top - 8;
  return true;
}

/** A page's head in the panel: back (when a page opened this one), its kind and title, its actions, and close. */
export function PanelPageHeader({ kind, title, actions }: { kind: string; title: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start gap-[6px]">
      {panelDepth() > 1 && (
        <IconBtn size="sm" label="Back" onClick={() => history.back()} className="mt-[1px]">
          <ArrowLeft size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-caption text-fg-subtle">{kind}</span>
        <h2 className="text-title font-medium text-fg" dir="auto">
          {title}
        </h2>
      </div>
      {actions}
      <IconBtn size="sm" label="Close the page" onClick={() => closePage()} className="mt-[1px]">
        <X size={14} absoluteStrokeWidth strokeWidth={1.5} />
      </IconBtn>
    </div>
  );
}
