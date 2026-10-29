import { kb, registerCommands } from "@/commands/registry";
import { toggleDictationHere } from "./MicButton";

/*
 * Talk from the keyboard: in a box with a mic, ⌃⌥D starts listening and ⌃⌥D again puts what was
 * said at the cursor (Esc drops it). Global, so it runs from the field it's typed in. Registered by
 * the pages (src/commands/pages.ts) and by Studio's chat (src/ui/ai/Composer.tsx).
 */

registerCommands([
  {
    id: "voice.talk",
    label: "Talk instead of typing",
    category: "edit",
    keys: [kb("⌃⌥D")],
    context: "global",
    run: () => void toggleDictationHere(),
    keywords: ["dictate", "dictation", "voice", "speak", "mic", "microphone"],
  },
]);
