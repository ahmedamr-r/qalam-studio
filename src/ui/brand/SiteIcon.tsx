import { useState } from "react";
import clsx from "clsx";
import { Globe } from "lucide-react";
import { faviconHref, hostOf } from "@/discovery/favicon";

/*
 * A website's own icon beside what was read there (the core fetches it from the site,
 * server/favicon.ts). On a small light tile, since most icons are drawn for a light browser tab and
 * a dark one vanishes on the panel; a globe where a site has none.
 */

const none = new Set<string>();

export function SiteIcon({ url, size = 16, round, className }: { url?: string; size?: number; round?: boolean; className?: string }) {
  const host = url ? hostOf(url) : null;
  const [missed, setMissed] = useState<string | null>(null);
  const bare = !host || none.has(host) || missed === host;
  const inner = Math.round(size * 0.75);
  return (
    <span aria-hidden="true" className={clsx("grid shrink-0 place-items-center overflow-hidden", round ? "rounded-full" : "rounded-[4px]", bare ? "bg-hover text-fg-subtle" : "bg-white shadow-[0_0_0_1px_var(--color-line-subtle)]", className)} style={{ width: size, height: size }}>
      {bare ? (
        <Globe size={inner} strokeWidth={1.75} />
      ) : (
        <img
          src={faviconHref(host)}
          alt=""
          width={inner}
          height={inner}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => {
            none.add(host);
            setMissed(host);
          }}
        />
      )}
    </span>
  );
}

/** A few sites' icons, overlapping, as a fold's summary shows where it read. */
export function SiteStack({ urls, max = 3, size = 18 }: { urls: readonly string[]; max?: number; size?: number }) {
  const hosts = [...new Map(urls.map((u) => [hostOf(u), u] as const).filter(([h]) => h)).values()].slice(0, max);
  if (!hosts.length) return null;
  return (
    <span className="flex shrink-0 items-center">
      {hosts.map((u, i) => (
        <SiteIcon key={u} url={u} size={size} round className={clsx("ring-2 ring-(--color-panel)", i > 0 && "-ml-[6px]")} />
      ))}
    </span>
  );
}
