import { useCallback, useEffect, useState } from "react";
import { useOrgContext } from "@/org/context";
import { readScope, withScope, type Scope } from "./scope";

/**
 * The page's product scope, kept in the address as it changes (the sidebar's Products switch it
 * without a reload). A product deleted meanwhile, or a stale link, goes back to everything.
 */
export function useScope(): [Scope, (s: Scope) => void] {
  const [scope, set] = useState<Scope>(() => readScope());
  const { products, loaded } = useOrgContext();
  const setScope = useCallback((s: Scope) => {
    set(s);
    history.replaceState(null, "", `${window.location.pathname}${withScope(window.location.search, s)}${window.location.hash}`);
  }, []);
  useEffect(() => {
    if (loaded && scope !== "all" && scope !== "org" && !products.some((p) => p.id === scope)) setScope("all");
  }, [loaded, products, scope, setScope]);
  return [scope, setScope];
}
