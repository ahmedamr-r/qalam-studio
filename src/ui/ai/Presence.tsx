import clsx from "clsx";
import { MessageCircleQuestion, MousePointer2, Network, Palette, PenTool, type LucideIcon } from "lucide-react";
import { studio } from "@/doc/store";
import { Tip } from "../controls";
import { r } from "../recipes";
import { AGENT_PROFILE, useAgents, type Agent, type AgentKind } from "./agents";
import { openChat } from "./chats";
import { followAgent, unfollow } from "./follow";

/**
 * Who's in the file, top right like Figma: an avatar per agent at work, then yours. Click an
 * agent to follow its cursor (the canvas is framed in its colour); click again to stop. An agent
 * with nothing on the canvas yet opens its chat instead. Avatars sit on the top bar's colour (a
 * 2px app ring); an agent's own colour is a thin ring around it, never its fill. You are the
 * selection blue (your selection on the canvas), shown only while agents share the file: alone,
 * the cluster and its separator step aside.
 */

const ICON: Record<AgentKind, LucideIcon> = { designer: PenTool, systems: Palette, critic: MessageCircleQuestion, strategist: Network };

const agentVar = (i: number) => `var(--color-agent-${(i % 4) + 1})`;

const avatar = "relative grid size-[24px] shrink-0 place-items-center rounded-full bg-raised text-fg-muted shadow-[0_0_0_2px_var(--color-app),inset_0_0_0_1px_var(--color-line)]";

export default function Presence() {
  const agents = useAgents((s) => s.agents);
  const following = useAgents((s) => s.following);
  if (!agents.length) return null;
  return (
    <>
      <div className="q-fade flex items-center gap-[8px] pr-[4px]">
        <div className="flex items-center -space-x-[4px]" role="group" aria-label="Agents at work">
          {agents.map((a) => (
            <AgentAvatar key={a.turnId} agent={a} followed={following === a.turnId} />
          ))}
        </div>
        <Tip label="You">
          <span className={avatar} aria-label="You" role="img">
            <MousePointer2 size={12} absoluteStrokeWidth strokeWidth={1.25} className="text-selection" />
            <span aria-hidden className="pointer-events-none absolute -inset-[1.5px] rounded-full shadow-[0_0_0_1.5px_var(--color-selection)]" />
          </span>
        </Tip>
      </div>
      <span aria-hidden className={r.vsep} />
    </>
  );
}

function AgentAvatar({ agent: a, followed }: { agent: Agent; followed: boolean }) {
  const Icon = ICON[a.kind];
  const c = agentVar(a.color);
  const action = followed ? "Click to stop following" : a.target ? "Click to follow" : "Click to open its chat";
  const click = () => {
    if (followed) return unfollow();
    if (a.target) return followAgent(a.turnId);
    openChat(a.chatId);
    studio().setChatOpen(true);
  };
  return (
    <Tip label={`${a.name} · ${a.activity}${a.task ? ` — ${a.task}` : ""}. ${action}.`}>
      <button
        type="button"
        onClick={click}
        aria-pressed={followed}
        aria-label={`${a.name}, ${AGENT_PROFILE[a.kind].role.toLowerCase()}. ${action}`}
        className={clsx(avatar, "q-press q-press-icon hover:z-10 hover:text-fg", followed && "z-[5]")}
      >
        <Icon size={12} absoluteStrokeWidth strokeWidth={1.25} style={{ color: c }} />
        {/* The agent's colour: a 1.5px ring just outside the avatar, doubled while you follow it. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-[1.5px] rounded-full"
          style={{ boxShadow: followed ? `0 0 0 1.5px ${c}, 0 0 0 3.5px var(--color-app), 0 0 0 5px ${c}` : `0 0 0 1.5px ${c}` }}
        />
        {a.phase === "thinking" && <span aria-hidden className="q-breathe absolute -right-[1px] -bottom-[1px] size-[7px] rounded-full shadow-[0_0_0_2px_var(--color-app)]" style={{ background: c }} />}
      </button>
    </Tip>
  );
}
