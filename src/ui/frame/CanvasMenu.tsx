import clsx from "clsx";
import { Cable, ChevronDown, Moon, Sun } from "lucide-react";
import { productOf, useOrgContext } from "@/org/context";
import { wordsFor } from "@/org/words";
import { spaceHref } from "@/projects/model";
import { runCommand } from "@/commands/registry";
import { Tip } from "../controls";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../menu";
import { r } from "../recipes";
import { useTheme } from "../theme";
import { editContext } from "../org/ContextEditor";
import { navigate } from "../nav";
import { addProduct, ConnectionsDot, SpaceTile } from "./OrgPlaces";
import type { Space } from "./spaces";
import { useCurrentOrg } from "./store";

/*
 * Where the canvases are, now that the left of the page is Qalam AI's chat: the top bar names the
 * canvas you're on after the organization, and its menu goes to another (the organization's own,
 * which shows all of it, or a product's), makes a product, or says what this one is about. With no
 * products there's only the organization's canvas, and the organization's menu has the rest.
 */

const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** The canvas crumb: the product's name, or All products on the organization's own; null with no products. */
export function CanvasMenu({ space }: { space: Space }) {
  const org = useCurrentOrg();
  const { products, about } = useOrgContext();
  if (!org || !products.length) return null;
  const name = space ? (productOf(space)?.name ?? "Product") : "All products";
  const aboutIt = () => {
    const p = space ? productOf(space) : undefined;
    void (p ? editContext({ kind: "product", product: p }) : editContext({ kind: "org", name: org.name, about }));
  };
  return (
    <>
      <span aria-hidden className={r.crumbSep}>
        /
      </span>
      <Menu
        label="Canvases"
        className="w-[260px]"
        trigger={
          <button type="button" className={clsx(r.button, r.buttonGhost, "gap-[6px] px-[8px] text-body font-medium")} aria-label={`Canvas: ${name}`}>
            <span className="max-w-[220px] truncate">{name}</span>
            <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="text-fg-subtle" />
          </button>
        }
      >
        <MenuLabel>Canvases</MenuLabel>
        <MenuItem checked={space === null} icon={<SpaceTile name={org.name || "·"} size="sm" />} onSelect={() => navigate(spaceHref(null))}>
          All products
        </MenuItem>
        {products.map((p) => (
          <MenuItem key={p.id} checked={p.id === space} icon={<SpaceTile name={p.name || "·"} size="sm" />} onSelect={() => navigate(spaceHref(p.id))}>
            {p.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => void addProduct(wordsFor(org.shape).org)}>New product…</MenuItem>
        <MenuItem onSelect={aboutIt}>About {space ? name : org.name}…</MenuItem>
      </Menu>
    </>
  );
}

/** The top bar's right end on every page: Connections (with a dot when something needs fixing) and the theme. */
export function FrameTools({ space }: { space: Space }) {
  const theme = useTheme((s) => s.resolved);
  return (
    <span className="flex items-center gap-[2px]">
      <Tip label="Connections">
        <a href={spaceHref(space, "connections")} aria-label="Connections" className={clsx(r.iconButton, "relative")}>
          <Cable {...ICON} />
          <ConnectionsDot className="absolute top-[6px] right-[6px] shadow-[0_0_0_2px_var(--color-app)]" />
        </a>
      </Tip>
      <Tip label={theme === "dark" ? "Light theme" : "Dark theme"}>
        <button type="button" aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} onClick={() => runCommand("view.theme-toggle", "toolbar")} className={r.iconButton}>
          {theme === "dark" ? <Moon {...ICON} /> : <Sun {...ICON} />}
        </button>
      </Tip>
    </span>
  );
}
