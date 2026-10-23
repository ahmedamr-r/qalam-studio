import { setThemeMode, useTheme } from "@/ui/theme";
import { registerCommands, type Command } from "./registry";
import { feedback } from "./feedback";

/**
 * Appearance commands (palette and View menu; Figma has no keys for these).
 * Wired from ./index once src/ui/theme.ts exists: `import "./theme";`.
 */

const MODES = [
  ["dark", "Dark theme", ["night", "appearance"]],
  ["light", "Light theme", ["day", "appearance"]],
  ["system", "Match system theme", ["auto", "os", "appearance"]],
] as const;

export const THEME_COMMANDS: Command[] = [
  ...MODES.map(
    ([mode, label, keywords]): Command => ({
      id: `view.theme-${mode}`,
      label,
      category: "view",
      run: () => setThemeMode(mode),
      checked: () => useTheme.getState().mode === mode,
      keywords: [...keywords],
    }),
  ),
  {
    id: "view.theme-toggle",
    label: "Toggle dark and light",
    category: "view",
    run: () => {
      const next = useTheme.getState().resolved === "dark" ? "light" : "dark";
      setThemeMode(next);
      feedback(next === "dark" ? "Dark theme" : "Light theme", { id: "view.theme" });
    },
    keywords: ["theme", "appearance", "dark mode", "light mode"],
  },
];

registerCommands(THEME_COMMANDS);
