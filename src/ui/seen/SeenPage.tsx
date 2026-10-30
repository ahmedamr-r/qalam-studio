import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ImagePlus, MoreHorizontal, X } from "lucide-react";
import { useGoals } from "@/goals/client";
import { goalHref, seenHref, spaceHref } from "@/projects/model";
import { ORG_SEEN, type SeenFlow, type SeenScreen } from "@/seen/types";
import { Button, IconBtn } from "../controls";
import { PageFrame } from "../frame/PageFrame";
import { useSpaceName } from "../frame/useSpace";
import { Menu, MenuItem } from "../menu";
import { r } from "../recipes";
import { confirmDialog, promptDialog } from "../surfaces/dialog";
import { ago } from "../time";
import { closeSeen, editSeen, openSeen, useSeen } from "./client";
import { FlowStrip } from "./FlowStrip";
import { Shot, ShotZoom } from "./Shot";

/*
 * What people see in a product: each flow as a row of its screenshots in order, the control that
 * leads on between them, the branches and what's not shown yet; then the screens in no flow.
 * A screen opens on its notes (what it's for, what's on it, what you can do, where it comes from
 * and leads to, its states), all a person's to reword or take out. Pictures are their screenshots.
 */

const panel = "rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";

function FlowRow({ flow, screens, onScreen }: { flow: SeenFlow; screens: Map<string, SeenScreen>; onScreen: (key: string) => void }) {
  const goals = useGoals((g) => g.goals);
  const goal = flow.goal ? goals.find((g) => g.id === flow.goal) : undefined;
  return (
    <section className={clsx(panel, "flex flex-col gap-[10px] px-[16px] py-[14px]")} aria-label={flow.name}>
      <header className="flex items-start gap-[8px]">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-title font-medium text-fg" dir="auto">
            {flow.name}
            {flow.aim && <span className="font-normal text-fg-muted"> · {flow.aim}</span>}
          </h2>
          <p className="text-caption text-fg-subtle">
            {[flow.entry ? `Starts from ${flow.entry}` : null, `${flow.steps.length} screens`, flow.by === "you" ? "worded by you" : null].filter(Boolean).join(" · ")}
            {goal && (
              <>
                {" · "}
                <a href={goalHref(goal.id)} className="text-fg-muted hover:text-fg hover:underline">
                  serves “{goal.title}”
                </a>
              </>
            )}
          </p>
        </div>
        <Menu
          trigger={
            <IconBtn size="sm" label="More">
              <MoreHorizontal size={14} />
            </IconBtn>
          }
        >
          <MenuItem
            onSelect={async () => {
              const name = await promptDialog({ title: "Rename the flow", defaultValue: flow.name });
              if (name) await editSeen({ flow: flow.key, name });
            }}
          >
            Rename…
          </MenuItem>
          <MenuItem
            onSelect={async () => {
              const aim = await promptDialog({ title: "What is the person trying to do?", defaultValue: flow.aim, placeholder: "to pay for the basket" });
              if (aim !== null) await editSeen({ flow: flow.key, aim });
            }}
          >
            Change its aim…
          </MenuItem>
          <MenuItem
            onSelect={async () => {
              if (await confirmDialog({ title: `Take “${flow.name}” out?`, body: "Its screens stay. Qalam AI won't propose it again.", confirmLabel: "Take it out", danger: true })) await editSeen({ removeFlow: flow.key });
            }}
          >
            Take it out
          </MenuItem>
        </Menu>
      </header>
      <FlowStrip flow={flow} screens={screens} w={84} onScreen={onScreen} />
      {flow.notShown.length > 0 && <p className="text-caption text-fg-muted">Not shown yet: {flow.notShown.join("; ")}</p>}
      {flow.note && (
        <p className="text-caption text-fg-subtle" dir="auto">
          {flow.note}
        </p>
      )}
    </section>
  );
}

function Note({ label, text, onEdit }: { label: string; text?: string; onEdit?: () => void }) {
  if (!text && !onEdit) return null;
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="flex items-center gap-[6px] text-micro font-semibold uppercase tracking-[0.04em] text-fg-subtle">
        {label}
        {onEdit && (
          <button type="button" onClick={onEdit} className="text-micro font-medium normal-case tracking-normal text-fg-muted hover:text-fg">
            Edit
          </button>
        )}
      </span>
      <p className={clsx("text-body", text ? "text-fg" : "text-fg-faint")} dir="auto">
        {text || "Nothing yet"}
      </p>
    </div>
  );
}

/** A screen's notes beside its picture, its states and how it's reached. */
function ScreenSheet({ s, flows, screens, onClose }: { s: SeenScreen; flows: SeenFlow[]; screens: Map<string, SeenScreen>; onClose: () => void }) {
  const from = flows.flatMap((f) => f.moves.filter((m) => m.to === s.key).map((m) => ({ m, f })));
  const to = flows.flatMap((f) => f.moves.filter((m) => m.from === s.key).map((m) => ({ m, f })));
  const reword = (field: "does" | "on" | "design", title: string) => async () => {
    const text = await promptDialog({ title, defaultValue: s[field] ?? "" });
    if (text !== null) await editSeen({ screen: s.key, [field]: text });
  };
  return (
    <section className={clsx(panel, "grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-[18px] p-[16px]")} aria-label={s.name}>
      <div className="flex flex-col gap-[8px]">
        <Shot shot={s.shots[0]} label={s.name} w={220} />
        {s.shots.length > 1 && (
          <div className="flex flex-col gap-[6px]">
            <span className="text-micro font-semibold uppercase tracking-[0.04em] text-fg-subtle">Other states</span>
            {s.shots.slice(1).map((shot) => (
              <div key={shot} className="flex items-start gap-[8px]">
                <Shot shot={shot} label={`${s.name}, another state`} w={40} />
                <span className="text-caption text-fg-muted" dir="auto">
                  {s.states[shot] ?? "Another state"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-[12px]">
        <header className="flex items-start gap-[8px]">
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="text-title font-medium text-fg" dir="auto">
              {s.name}
            </h2>
            <p className="text-caption text-fg-subtle">{[s.kind, s.by === "you" ? "worded by you" : `read ${ago(s.at)}`, s.step ? `the step ${s.step.split("/").pop()} in the code` : null].filter(Boolean).join(" · ")}</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const name = await promptDialog({ title: "Rename the screen", defaultValue: s.name });
              if (name) await editSeen({ screen: s.key, name });
            }}
          >
            Rename
          </Button>
          <IconBtn size="sm" label="Close" onClick={onClose}>
            <X size={14} />
          </IconBtn>
        </header>
        <Note label="What it's for" text={s.does} onEdit={reword("does", "What is the screen for?")} />
        <Note label="On it" text={s.on} onEdit={reword("on", "What's on it?")} />
        {s.can.length > 0 && (
          <div className="flex flex-col gap-[4px]">
            <span className="text-micro font-semibold uppercase tracking-[0.04em] text-fg-subtle">You can</span>
            <ul className="flex flex-wrap gap-[4px]">
              {s.can.map((c) => (
                <li key={c.label} className="rounded-sm bg-active px-[6px] py-[2px] text-caption text-fg" dir="auto" title={c.does}>
                  “{c.label}”{c.does ? <span className="text-fg-muted"> · {c.does}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
        {s.nav.length > 0 && <Note label="Navigation" text={s.nav.map((n) => `“${n}”`).join(", ")} />}
        {(from.length > 0 || to.length > 0) && (
          <div className="flex flex-col gap-[2px]">
            <span className="text-micro font-semibold uppercase tracking-[0.04em] text-fg-subtle">Comes from · leads to</span>
            {from.map(({ m, f }) => (
              <p key={`f${f.key}${m.from}`} className="text-caption text-fg-muted" dir="auto">
                ← {screens.get(m.from)?.name}
                {m.via ? `, on “${m.via}”` : ""} <span className="text-fg-subtle">· {f.name}</span>
              </p>
            ))}
            {to.map(({ m, f }) => (
              <p key={`t${f.key}${m.to}`} className="text-caption text-fg-muted" dir="auto">
                → {screens.get(m.to)?.name}
                {m.via ? `, on “${m.via}”` : ""} <span className="text-fg-subtle">· {f.name}</span>
              </p>
            ))}
          </div>
        )}
        <Note label="Design" text={s.design} onEdit={reword("design", "How is it laid out?")} />
        <button
          type="button"
          className="self-start text-caption text-fg-subtle hover:text-danger"
          onClick={async () => {
            if (await confirmDialog({ title: `Take “${s.name}” out?`, body: "Its screenshots stay kept, and flows lose this step. Qalam AI won't bring it back unless you add it again.", confirmLabel: "Take it out", danger: true })) {
              await editSeen({ removeScreen: s.key });
              onClose();
            }
          }}
        >
          Take this screen out
        </button>
      </div>
    </section>
  );
}

export default function SeenPage({ seenKey }: { seenKey: string }) {
  const space = seenKey === ORG_SEEN ? null : seenKey;
  const productName = useSpaceName(space) || "the product";
  const view = useSeen((s) => s.view);
  const error = useSeen((s) => s.error);
  const [open, setOpen] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  // A screen opens where its notes show, above the flows: bring them into view.
  useEffect(() => {
    if (open) sheet.current?.scrollIntoView({ block: "start" });
  }, [open]);
  useEffect(() => {
    void openSeen(seenKey);
    return () => closeSeen();
  }, [seenKey]);
  useEffect(() => {
    const was = document.title;
    document.title = `What people see · ${productName} · Qalam`;
    return () => void (document.title = was);
  }, [productName]);

  const map = view?.map ?? null;
  const screens = new Map((map?.screens ?? []).map((s) => [s.key, s]));
  const placed = new Set((map?.flows ?? []).flatMap((f) => [...f.steps, ...f.moves.flatMap((m) => [m.from, m.to])]));
  const loose = (map?.screens ?? []).filter((s) => !placed.has(s.key));
  const shown = open ? screens.get(open) : undefined;
  const reading = view?.reading;
  const waiting = reading && reading.phase !== "done";

  return (
    <PageFrame place="evidence" crumbs={[{ label: "Evidence", href: spaceHref(space, "evidence") }, { label: "What people see" }]} space={space}>
      <div className={clsx(r.pageMain, "max-w-[1100px]")}>
        <div className="flex flex-wrap items-end justify-between gap-[12px]">
          <div className="flex flex-col gap-[2px]">
            <h1 className="text-heading font-semibold text-fg">What people see in {productName}</h1>
            <p className="text-caption text-fg-subtle tnum">{map ? `${map.screens.length} screens · ${map.flows.length} flows · read ${ago(map.readAt)}` : "From your screenshots"}</p>
          </div>
          <a href={seenHref(seenKey, { add: true })} className={clsx(r.button, waiting ? r.buttonSecondary : r.buttonPrimary)}>
            <ImagePlus size={14} /> {waiting ? "Back to the screenshots" : map ? "Add more" : "Add screenshots"}
          </a>
        </div>
        {error && <p className="text-caption text-danger">{error}</p>}
        {view && !map && <p className="max-w-[560px] text-body text-fg-muted">Add screenshots of {productName} and Qalam AI puts them into flows: each screen in order, the control that leads to the next, and notes it can refer to when you work on goals and problems. Their words are read on this Mac.</p>}
        {shown && (
          <div ref={sheet} className="scroll-mt-[16px]">
            <ScreenSheet s={shown} flows={map?.flows ?? []} screens={screens} onClose={() => setOpen(null)} />
          </div>
        )}
        {map?.flows.map((f) => <FlowRow key={f.key} flow={f} screens={screens} onScreen={setOpen} />)}
        {loose.length > 0 && (
          <section className="flex flex-col gap-[8px]" aria-label="Not in a flow">
            <h2 className="text-title font-medium">
              Not in a flow <span className="font-normal text-fg-subtle tnum">{loose.length}</span>
            </h2>
            <div className="flex flex-wrap gap-[12px]">
              {loose.map((s) => (
                <button key={s.key} type="button" onClick={() => setOpen(s.key)} className="q-item flex w-[84px] flex-col gap-[4px] rounded-md text-left">
                  <Shot shot={s.shots[0]} label={s.name} w={84} open={false} />
                  <span className="truncate text-micro text-fg" dir="auto">
                    {s.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      <ShotZoom />
    </PageFrame>
  );
}
