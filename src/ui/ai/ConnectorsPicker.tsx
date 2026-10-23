import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, Globe, Plug, Search } from "lucide-react";
import type { ConnectorInfo } from "@/ai/research-shared";
import { r } from "../recipes";
import { Menu } from "../menu";
import { menuRow } from "./menuRow";
import { setConnector, useAvailableConnectors, useConnectorPrefs } from "./connectors";
import { pill } from "./Composer";

const ICON: Record<ConnectorInfo["kind"], typeof Globe> = { web: Globe, tavily: Search, mcp: Plug };

/** The composer's connectors menu: what Qalam AI may look up before it answers. Rows toggle in place (the menu stays open). */
export function ConnectorsPicker() {
  const [open, setOpen] = useState(false);
  // Only a toggle draws the tick (like Checkbox); rows that open already checked show it at once.
  const [drawn, setDrawn] = useState<string | null>(null);
  const list = useAvailableConnectors();
  const enabled = useConnectorPrefs((s) => s.enabled);
  if (!list.length) return null;
  const on = list.filter((c) => enabled.includes(c.id));
  const short = (c: ConnectorInfo) => (c.kind === "web" ? "Web" : c.label);
  const label = !on.length ? "No lookups" : on.length === 1 ? short(on[0]) : `${short(on[0])} +${on.length - 1}`;
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      side="top"
      label="Look things up first"
      className="w-[304px]"
      trigger={
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`Connectors: ${on.length ? on.map((c) => c.label).join(", ") : "off"}`}
          title="What Qalam AI may look up before answering"
          className={clsx(pill, !on.length && "text-fg-subtle")}
        >
          <Globe size={12} absoluteStrokeWidth strokeWidth={1.25} /> {label} <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
        </button>
      }
    >
      <div className="px-[8px] pt-[6px] pb-[6px]">
        <div className="text-caption font-semibold text-fg">Look things up first</div>
        <p className="mt-[2px] text-caption text-fg-subtle">When a request needs real facts (prices, names, rules, guidelines, how other apps do it), Qalam AI checks these before it answers, and lists its sources.</p>
      </div>
      <div className={r.menuSeparator} />
      {list.map((c) => {
        const Icon = ICON[c.kind];
        const checked = enabled.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={checked}
            {...menuRow(c.label)}
            onClick={() => {
              setDrawn(checked ? null : c.id);
              setConnector(c.id, !checked);
            }}
            className="q-item flex w-full items-start gap-[8px] rounded-md px-[8px] py-[6px] text-left outline-none focus-visible:outline-none data-[highlighted]:bg-active"
          >
            <span aria-hidden data-state={checked ? "checked" : "unchecked"} className={clsx(r.checkbox, "mt-[2px]")}>
              {checked && (
                <span className="contents">
                  <svg className="q-check" data-on={drawn === c.id || undefined} onAnimationEnd={() => setDrawn(null)} width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                    <path pathLength={1} d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-[6px] text-body font-medium text-fg">
                <Icon size={14} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-fg-subtle" /> {c.label}
              </span>
              <span className="block text-caption text-fg-subtle">{c.hint}</span>
            </span>
          </button>
        );
      })}
      {!list.some((c) => c.kind !== "web") && <p className="px-[8px] pt-[4px] pb-[6px] text-micro text-fg-subtle">Add Tavily or MCP servers in .env.local (see .env.example).</p>}
    </Menu>
  );
}
