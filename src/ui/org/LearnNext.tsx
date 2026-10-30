import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { feedback } from "@/commands/feedback";
import type { LearnItem, LearnKind, LearnPlan } from "@/hub/learn";
import { orgJson } from "@/org/client";
import { onOrgChange } from "@/org/live";
import { projectHref, topicHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button, Spinner } from "../controls";
import { r } from "../recipes";

/**
 * What to learn next: what code finds the organization doesn't know yet and is betting on (free,
 * always shown), and Qalam AI's plan to close it: who to talk to, what to ask them, what to test.
 * The plan can be kept as a page in research/, to share and edit.
 */

interface Result {
  items: LearnItem[];
  plan: LearnPlan | null;
  markdown: string | null;
  title: string;
}

const KIND: Record<LearnKind, string> = { "thin-target": "Thin target", risky: "Untested risk", assumed: "Assumed need", open: "Open question", unheard: "Not heard from" };
const cardHref = (board: string, card: string) => `${projectHref({ id: board, type: "discovery" })}?card=${encodeURIComponent(card)}`;

export function LearnNext({ product }: { product: string | null }) {
  const [gaps, setGaps] = useState<LearnItem[] | null>(null);
  const [plan, setPlan] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => void orgJson<Result>("/learn", { method: "POST", json: { product } }).then((x) => setGaps(x.items), () => setGaps([])), [product]);
  useEffect(() => {
    load();
    // A board being edited elsewhere saves often: read the gaps again once changes settle.
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onOrgChange((c) => {
      if (c.kind !== "project" && c.kind !== "topic" && c.kind !== "source" && c.kind !== "person" && c.kind !== "product" && c.kind !== "about") return;
      clearTimeout(t);
      t = setTimeout(load, 1500);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [load]);
  useEffect(() => {
    setPlan(null);
    setSaved(null);
  }, [product]);

  const ask = async () => {
    setBusy(true);
    setSaved(null);
    try {
      const x = await orgJson<Result>("/learn", { method: "POST", json: { product, plan: true } });
      setPlan(x);
      setGaps(x.items);
      setOpen(true);
    } catch (e) {
      feedback(`Qalam AI couldn't plan it: ${e instanceof Error ? e.message : String(e)}`, { kind: "error", id: "learn" });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!plan?.markdown) return;
    const { file } = await orgJson<{ file: string }>("/research", { method: "POST", json: { title: plan.title, markdown: plan.markdown } });
    setSaved(file);
  };

  if (!gaps) return null;
  const p = plan?.plan;
  return (
    <section aria-labelledby="learn" className="flex flex-col gap-[8px]">
      <div className="flex items-center justify-between gap-[12px]">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-[6px] text-left">
          <ChevronRight size={14} absoluteStrokeWidth strokeWidth={1.25} className={clsx("text-fg-subtle transition-transform", open && "rotate-90")} />
          <h2 id="learn" className="text-title font-medium">
            What to learn next
          </h2>
          <span className="text-caption text-fg-subtle">{gaps.length ? `${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}` : "nothing open"}</span>
        </button>
        {gaps.length > 0 && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void ask()}>
            {busy ? <Spinner size={12} /> : <QalamAIGlyph size={12} />} {p ? "Plan again" : "Plan it with Qalam AI"}
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-[12px]">
          {!gaps.length && <p className="text-body text-fg-muted">Nothing the boards bet on is unknown: every target rests on customers' words, every risky assumption has a test.</p>}
          {gaps.length > 0 && (
            <ul className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              {gaps.map((g) => {
                const href = g.board && g.card ? cardHref(g.board, g.card) : g.topic ? topicHref(g.topic) : null;
                return (
                  <li key={g.id} className="flex items-start gap-[10px] px-[12px] py-[8px]">
                    <span className="w-[104px] shrink-0 text-caption text-fg-subtle">{KIND[g.kind]}</span>
                    {href ? (
                      <a href={href} className="text-body text-fg hover:underline">
                        {g.text}
                      </a>
                    ) : (
                      <span className="text-body text-fg">{g.text}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {plan && !p && <p className="text-body text-fg-muted">Qalam AI's plan didn't hold up against the gaps it cited, so it isn't shown. Plan again.</p>}
          {p && (
            <div className="flex flex-col gap-[10px] rounded-lg bg-panel p-[14px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              {p.focus && <p className="text-body text-fg">{p.focus}</p>}
              {p.talkTo.length > 0 && (
                <div className="flex flex-col gap-[4px]">
                  <h3 className="text-caption font-semibold text-fg">Who to talk to</h3>
                  {p.talkTo.map((x) => (
                    <p key={x.who} className="text-caption text-fg-muted">
                      <span className="font-medium text-fg">{x.who}</span>: {x.why}
                    </p>
                  ))}
                </div>
              )}
              {p.questions.length > 0 && (
                <div className="flex flex-col gap-[4px]">
                  <h3 className="text-caption font-semibold text-fg">What to ask</h3>
                  <ol className="flex list-decimal flex-col gap-[4px] pl-[18px]">
                    {p.questions.map((x) => (
                      <li key={x.question} className="text-caption text-fg">
                        {x.question} <span className="text-fg-muted">· {x.learns}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {p.tests.length > 0 && (
                <div className="flex flex-col gap-[4px]">
                  <h3 className="text-caption font-semibold text-fg">What to test</h3>
                  {p.tests.map((x) => (
                    <p key={x.what} className="text-caption text-fg-muted">
                      <span className="font-medium text-fg">{x.what}</span>: {x.method}. Passes if {x.passIf.replace(/^passes? if /i, "")}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-[8px]">
                <button type="button" onClick={() => void save()} disabled={!!saved} className={clsx(r.buttonSm, r.buttonSecondary)}>
                  {saved ? "Saved" : "Keep it as a page"}
                </button>
                <button type="button" onClick={() => void navigator.clipboard.writeText(plan!.markdown ?? "").then(() => feedback("Copied as Markdown", { id: "learn.copy" }))} className={clsx(r.buttonSm, r.buttonGhost)}>
                  Copy as Markdown
                </button>
                {saved && <span className="text-caption text-fg-subtle">In {saved}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
