import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { pageOf, panelMove } from "@/space/pages";
import { IconBtn } from "../controls";
import { panelDepth, replaceAddress, useAddress } from "../nav";

/*
 * A goal's or a topic page's page, open in a space's canvas panel: the canvas's address with
 * ?goal=<id> or ?page=<topic> (and `at`, a section to scroll to). Opening one is a step in history
 * (src/ui/nav.ts), so Back closes it; × goes back past every page opened over the canvas and closes the panel.
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

/** What a page hears from the canvas's panel: what × does (it closes what's under the page too), and the class its content enters with. */
const PanelPage = createContext<{ close: () => void; enter: string }>({ close: () => closePage(), enter: "" });
export const PanelPageProvider = PanelPage.Provider;
/** The class a page's root takes, so it enters once its content is there, not while it loads. */
export const usePanelEnter = () => useContext(PanelPage).enter;

/**
 * The class that moves the panel's content in as it changes, the way it went: deeper from the right, back
 * from the left. On an element that's new for the view, so it enters anew. `quiet` skips the next change,
 * for one the keyboard asked for.
 */
export function usePanelMove(view: string | null) {
  const last = useRef({ view, depth: panelDepth(), cls: "" });
  const quiet = useRef(false);
  if (last.current.view !== view) {
    const now = { view, depth: panelDepth() };
    const move = quiet.current ? null : panelMove(last.current, now);
    quiet.current = false;
    last.current = { ...now, cls: move ? `q-panel-${move}` : "" };
  }
  return { cls: last.current.cls, quiet };
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
  // Below the pinned head, which would otherwise cover the section.
  const head = root?.querySelector("[data-page-head]") ?? aside;
  aside.scrollTop += el.getBoundingClientRect().top - head.getBoundingClientRect().bottom - 8;
  return true;
}

/**
 * A page's head in the panel, pinned as the page scrolls: back (to the page that opened this one, else
 * to what's under it), its kind and title, its actions, and close. A direct child of the page's padded
 * root (16px, 14px), so it stays pinned all the way down and spans the panel.
 */
export function PanelPageHeader({ kind, title, actions }: { kind: string; title: string; actions?: ReactNode }) {
  const { close } = useContext(PanelPage);
  return (
    <div data-page-head className="q-glass-head sticky top-0 z-10 -mx-[16px] -mt-[14px] flex items-center gap-[8px] bg-app px-[16px] py-[14px]">
      <IconBtn size="sm" label="Back" onClick={() => (panelDepth() > 1 ? history.back() : closePage())}>
        <ArrowLeft size={14} absoluteStrokeWidth strokeWidth={1.25} />
      </IconBtn>
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-caption text-fg-subtle">{kind}</span>
        <h2 className="text-title font-medium text-fg" dir="auto">
          {title}
        </h2>
      </div>
      {actions}
      <IconBtn size="sm" label="Close the panel" onClick={close}>
        <X size={14} absoluteStrokeWidth strokeWidth={1.5} />
      </IconBtn>
    </div>
  );
}
