import type { ScreenSpec } from "@/design-system/builders";
import { studio, useStudio } from "@/doc/store";
import { nextBrief, resolveNext } from "@/proto/pending";
import { send, useChats } from "../ai/chats";
import { closePrototype } from "./store";

/**
 * Draw a page with Generate (in the chat, plan first when the designer has it on), then go to it
 * from where the screen went on to it. Closes the prototype: Generate asks and builds in the studio.
 */
export async function generateNext(screen: string, page: string) {
  const { doc } = studio();
  const text = nextBrief(doc, screen, page);
  if (!text) return;
  const spec = doc.nodes[screen]?.meta.spec as ScreenSpec | undefined;
  closePrototype();
  // A new screen, not a change to this one: nothing selected.
  studio().select([]);
  useStudio.setState({ chatOpen: true, aiTab: "generate" });
  let plan = true;
  try {
    plan = localStorage.getItem("qalam/plan-first/v1") !== "off";
  } catch {}
  const { chatId, turnId } = await send({ tool: "generate", text, lang: spec?.lang === "ar" ? "ar" : "en", platform: spec?.platform ?? "auto", plan });
  // Its screen placed (now, or once the designer has answered the plan's questions): the route goes to it.
  const settled = (): boolean => {
    const t = useChats.getState().chats.find((c) => c.id === chatId)?.turns.find((x) => x.id === turnId);
    if (!t) return true;
    const to = t.outcome?.kind === "generate" ? t.outcome.frameIds.find((id) => studio().doc.nodes[id]) : undefined;
    if (to) {
      if (studio().doc.proto?.routes?.[screen]?.next?.[page]) resolveNext(screen, page, to);
      return true;
    }
    return t.status === "error" || t.status === "stopped";
  };
  if (settled()) return;
  const stop = useChats.subscribe(() => {
    if (settled()) stop();
  });
}
