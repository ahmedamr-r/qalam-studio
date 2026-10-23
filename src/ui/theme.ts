import { create } from "zustand";

/*
 * Studio appearance. Dark is the default; "system" follows the OS. The resolved theme lives on
 * <html data-theme> (+ color-scheme for native controls and scrollbars), where every --color-*
 * token switches. app/layout.tsx applies the stored choice before first paint with the same key.
 * Canvas code listens for the `qalam-theme` window event and re-reads its colours from CSS vars.
 */

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_KEY = "qalam.theme";
export const THEME_EVENT = "qalam-theme";

export interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
}

/** Detail of the `qalam-theme` event on `window`. */
export type ThemeEventDetail = ThemeState;

export const isThemeMode = (v: unknown): v is ThemeMode => v === "dark" || v === "light" || v === "system";

export const resolveTheme = (mode: ThemeMode, systemLight: boolean): ResolvedTheme =>
  mode === "system" ? (systemLight ? "light" : "dark") : mode;

const hasDOM = () => typeof window !== "undefined" && typeof document !== "undefined";
const lightQuery = () => (hasDOM() && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null);

function readMode(): ThemeMode {
  if (!hasDOM()) return "dark";
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemeMode(v) ? v : "dark";
  } catch {
    return "dark";
  }
}

function initial(): ThemeState {
  const mode = readMode();
  return { mode, resolved: resolveTheme(mode, !!lightQuery()?.matches) };
}

export const useTheme = create<ThemeState>(initial);

function apply({ resolved }: ThemeState) {
  if (!hasDOM()) return;
  const root = document.documentElement;
  if (root.dataset.theme === resolved) return;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

/** Choose dark, light or system. Persisted; applies at once. */
export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Private mode or blocked storage: the choice lasts for this session only.
  }
  useTheme.setState({ mode, resolved: resolveTheme(mode, !!lightQuery()?.matches) });
}

export const toggleTheme = () => setThemeMode(useTheme.getState().resolved === "dark" ? "light" : "dark");

/** Read a theme token (`--color-canvas`…) as the browser resolved it for the current theme. */
export function cssVar(name: string): string {
  if (!hasDOM()) return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

if (hasDOM()) {
  apply(useTheme.getState());
  useTheme.subscribe((s, prev) => {
    apply(s);
    if (s.resolved !== prev.resolved) window.dispatchEvent(new CustomEvent<ThemeEventDetail>(THEME_EVENT, { detail: s }));
  });
  lightQuery()?.addEventListener("change", (e) => {
    const { mode } = useTheme.getState();
    if (mode === "system") useTheme.setState({ resolved: resolveTheme(mode, e.matches) });
  });
  // Another tab changed the theme.
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY && isThemeMode(e.newValue)) useTheme.setState({ mode: e.newValue, resolved: resolveTheme(e.newValue, !!lightQuery()?.matches) });
  });
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __qalamTheme: unknown }).__qalamTheme = { set: setThemeMode, get: () => useTheme.getState(), toggle: toggleTheme };
  }
}
