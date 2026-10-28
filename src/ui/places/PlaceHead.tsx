import type { ReactNode } from "react";
import { useOrgContext } from "@/org/context";
import type { Scope } from "../home/scope";

/** What a scope is called: Everything, Whole organization, or the product's name. */
export function useScopeName(scope: Scope): string {
  const products = useOrgContext((s) => s.products);
  return scope === "all" ? "Everything" : scope === "org" ? "Whole organization" : (products.find((p) => p.id === scope)?.name ?? "Everything");
}

/** A place's heading: its name, how many there are in this scope (once known), and anything else it needs beside it. */
export function PlaceHead({ title, count, scope, children }: { title: string; count: number | null; scope: Scope; children?: ReactNode }) {
  const name = useScopeName(scope);
  return (
    <div className="flex flex-wrap items-end justify-between gap-[12px]">
      <div className="flex flex-col gap-[2px]">
        <h1 className="text-heading font-semibold text-fg">{title}</h1>
        <p className="text-caption text-fg-subtle tnum">{[name, count === null ? null : String(count)].filter(Boolean).join(" · ")}</p>
      </div>
      {children}
    </div>
  );
}
