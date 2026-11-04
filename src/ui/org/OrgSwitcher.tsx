import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { listOrgs, openOrgFolder, OrgRequestError, renameOrg, type OrgRef } from "@/org/client";
import { openOrgHref, orgsHref, spaceHref, welcomeHref } from "@/projects/model";
import { useOrgContext } from "@/org/context";
import { wordsFor } from "@/org/words";
import { addProduct } from "../frame/OrgPlaces";
import { placeShown } from "../frame/places";
import { lastSpace } from "../frame/useSpace";
import { navigate } from "../nav";
import { editContext } from "./ContextEditor";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../menu";
import { r } from "../recipes";
import { promptDialog } from "../surfaces/dialog";

/** Opening an organization: its last canvas, in a full page load (it's another organization's window). */
export const openOrg = (o: OrgRef) => window.location.assign(openOrgHref(o.id));

/** Any folder as an organization: picked in the system's dialog where there is one, else its path typed. */
export async function openFolderAsOrg() {
  try {
    const o = await openOrgFolder();
    if (o) openOrg(o);
  } catch (e) {
    if (e instanceof OrgRequestError && e.status === 400 && /path/i.test(e.message)) {
      const path = await promptDialog({ title: "Open a folder", body: "Qalam keeps the organization's files in it, next to whatever is there.", label: "The folder's path", placeholder: "~/Projects/basket", confirmLabel: "Open" });
      if (path) {
        try {
          openOrg((await openOrgFolder(path))!);
        } catch (e2) {
          feedback(e2 instanceof Error ? e2.message : String(e2), { kind: "error", id: "org.open" });
        }
      }
    } else feedback(e instanceof Error ? e.message : String(e), { kind: "error", id: "org.open" });
  }
}

/**
 * Which organization this window works in, and the others on this computer: switch to one, see
 * them all, make a new one (a folder in ~/Qalam), use any folder as one, or rename this one; say
 * what it is (its About), make a product, and go to its Decisions where they're on (src/lab.ts).
 */
export function OrgSwitcher({ org, onRenamed }: { org: OrgRef; onRenamed: (o: OrgRef) => void }) {
  const [orgs, setOrgs] = useState<OrgRef[]>([]);
  const about = useOrgContext((c) => c.about);
  useEffect(() => void listOrgs().then((j) => setOrgs(j.orgs), () => {}), []);

  // A new organization goes through the welcome: Qalam AI checked, the name, then telling Qalam AI about it.
  const create = () => window.location.assign(welcomeHref("new"));

  const rename = async () => {
    const name = await promptDialog({ title: "Rename organization", defaultValue: org.name, confirmLabel: "Rename", validate: (v) => (v.trim() ? null : "Name can't be empty") });
    if (name && name !== org.name) onRenamed(await renameOrg(name));
  };

  return (
    <Menu
      label="Organizations"
      className="w-[260px]"
      trigger={
        <button type="button" className={clsx(r.button, r.buttonGhost, "gap-[6px] px-[8px] text-body font-medium")} aria-label={`Organization: ${org.name}`}>
          {org.name}
          <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="text-fg-subtle" />
        </button>
      }
    >
      <MenuLabel>Organizations</MenuLabel>
      {(orgs.length ? orgs : [org]).map((o) => (
        <MenuItem key={o.id} checked={o.id === org.id} title={o.dir} onSelect={() => o.id !== org.id && openOrg(o)}>
          {o.name}
        </MenuItem>
      ))}
      <MenuItem onSelect={() => window.location.assign(orgsHref())}>All organizations</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={create}>New organization…</MenuItem>
      <MenuItem onSelect={() => void openFolderAsOrg()}>Open a folder as an organization…</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => void rename()}>Rename “{org.name}”…</MenuItem>
      <MenuItem onSelect={() => void editContext({ kind: "org", name: org.name, about })}>About “{org.name}”…</MenuItem>
      <MenuItem onSelect={() => void addProduct(wordsFor(org.shape).org)}>New product…</MenuItem>
      {placeShown("decisions") && (
        <>
          <MenuSeparator />
          <MenuItem onSelect={() => navigate(spaceHref(lastSpace() ?? null, "decisions"))}>Decisions</MenuItem>
        </>
      )}
    </Menu>
  );
}
