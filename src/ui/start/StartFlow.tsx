import { useState } from "react";
import clsx from "clsx";
import { orgsHref } from "@/projects/model";
import { r } from "../recipes";
import { StartBox, useStartBusy } from "./StartBox";
import { Stage } from "./Stage";

/*
 * The first run: the one box (./StartBox.tsx) on a page of its own, the researcher above it. Also a
 * new organization's (?new=1), with a way back to the organizations.
 */

/** What the researcher says, by what's going on. */
const LINES = {
  idle: "Tell me what you're making. I'll find the people it annoys.",
  reading: "Reading it now. Don't watch.",
  writing: "Making you a project. Try to look busy.",
  shrug: "I need a brain to borrow. Claude Code or Codex will do.",
} as const;

export function StartFlow() {
  const [sending, setSending] = useState(false);
  const { busy, reading, missing } = useStartBusy(sending);
  const fresh = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1";
  const pose = busy ? "writing" : missing ? "shrug" : reading ? "reading" : "idle";
  return (
    <Stage pose={pose} line={LINES[pose]} home={fresh ? orgsHref() : "/welcome"} title="What are you working on?" about="A product, an idea, or what your customers told you. Add files or screenshots as you go.">
      <StartBox search={typeof window === "undefined" ? "" : window.location.search} onBusy={setSending} />
      {fresh && (
        <a href={orgsHref()} className={clsx(r.buttonSm, r.buttonGhost, "self-center")}>
          Back to your projects
        </a>
      )}
    </Stage>
  );
}
