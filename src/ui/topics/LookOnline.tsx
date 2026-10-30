import { useState } from "react";
import clsx from "clsx";
import { callAI } from "@/ai/client";
import { lookedOnlineLine, type LookedOnline } from "@/discovery/ingest/posts";
import { feedback } from "@/commands/feedback";
import { orgPath } from "@/org/client";
import { QalamAIGlyph } from "../brand";
import { r } from "../recipes";

/*
 * "Look online" on a problem's page (server/org/posts.ts): the web searched for public pages where
 * people describe it, each read by code and taken in as people online's words. They back the
 * problem below its own customers' and alone leave it Assumed.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** An activity label as a status: its own "…" when it has none. */
const going = (label: string) => (label.endsWith("…") ? label : `${label}…`);

export function LookOnline({ topic }: { topic: string }) {
  const [working, setWorking] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const look = async () => {
    setWorking("Looking for where people talk about it");
    setSaid(null);
    try {
      const { data } = await callAI<LookedOnline>(await orgPath(`/topics/${encodeURIComponent(topic)}/online`), {}, undefined, undefined, (e) => e.type === "activity" && setWorking(e.label));
      setSaid(lookedOnlineLine(data));
    } catch (e) {
      feedback(`Couldn't look online: ${message(e)}`, { kind: "error", id: "topic.online" });
    } finally {
      setWorking(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px]">
      <button type="button" disabled={!!working} onClick={() => void look()} className={clsx(r.buttonSm, r.buttonSecondary)}>
        <QalamAIGlyph size={12} />
        {working ? "Looking…" : "Look online"}
      </button>
      <span role="status" className="text-caption text-fg-muted">
        {working ? going(working) : (said ??"What people say in public: Reddit, reviews, forums. It backs the problem, below what your own customers say.")}
      </span>
    </div>
  );
}
