import { getCommand, registerCommands, type Command } from "@/commands";

/*
 * Commands the surfaces finish: ⌘-right-click on the canvas opens a menu of every layer under the
 * pointer (ContextMenu handles the gesture; the entry lists it in the shortcuts panel).
 */

const base = getCommand("select.layer-menu");

const layerMenu: Command = {
  ...(base ?? { id: "select.layer-menu", label: "Select layer menu", category: "selection", run: () => {} }),
  gesture: ["⌘", "Right-click"],
  hidden: true,
  unavailable: undefined,
};

registerCommands([layerMenu]);
