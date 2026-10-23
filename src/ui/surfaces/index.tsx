import "@/commands";
import "./commands";
import CommandPalette from "./CommandPalette";
import ShortcutsPanel from "./ShortcutsPanel";
import ContextMenu from "./ContextMenu";
import { DialogHost, confirmDialog, promptDialog } from "./dialog";

/*
 * Command surfaces over the studio: the ⌘K Actions palette, the ⌃⇧? shortcuts panel, the right-click
 * menu and the dialog host behind confirmDialog / promptDialog. Studio mounts <CommandSurfaces /> once.
 */

export { confirmDialog, promptDialog, type ConfirmOptions, type PromptOptions } from "./dialog";

export function CommandSurfaces() {
  return (
    <>
      <CommandPalette />
      <ShortcutsPanel />
      <ContextMenu />
      <DialogHost />
    </>
  );
}

export default CommandSurfaces;

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __qalamDialogs: unknown }).__qalamDialogs = { confirm: confirmDialog, prompt: promptDialog };
}
