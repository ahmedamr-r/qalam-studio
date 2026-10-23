import { BookOpen, X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { BRIEF_TOPICS, TOPIC_LABEL, removeAnswer } from "@/doc/brief";
import { runCommand } from "@/commands/registry";
import { Button, IconBtn } from "../controls";
import { r } from "../recipes";

/**
 * Library on a Discovery board: what the builder said about the product in the interview (the
 * document's brief, outside undo history). It goes along when a solution is sent to design.
 */
export default function ContextPanel() {
  const brief = useStudio((s) => s.doc.brief);
  const answers = brief?.answers ?? [];
  return (
    <div className="flex flex-col gap-[16px] px-[12px] pt-[4px] pb-[16px]">
      <p className="rounded-lg bg-muted px-[10px] py-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        What you told Qalam AI about the product. It shapes the tree and goes with every solution you send to design.
      </p>
      {!answers.length ? (
        <div className="flex flex-col items-center gap-[8px] px-[8px] py-[24px] text-center">
          <span className="grid size-[36px] place-items-center rounded-lg bg-muted text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            <BookOpen size={18} absoluteStrokeWidth strokeWidth={1.25} />
          </span>
          <p className="max-w-[220px] text-caption text-fg-muted">Answer six short questions about your product and Qalam AI drafts the first tree.</p>
          <Button size="sm" onClick={() => runCommand("discovery.redo-interview", "toolbar")}>
            Answer the questions…
          </Button>
        </div>
      ) : (
        <>
          {brief?.summary && <p className="text-body leading-[20px] text-fg">{brief.summary}</p>}
          {BRIEF_TOPICS.filter((t) => answers.some((a) => a.topic === t)).map((t) => (
            <section key={t} className="flex flex-col gap-[6px]">
              <h3 className={r.sectionTitle}>{TOPIC_LABEL[t]}</h3>
              {answers
                .filter((a) => a.topic === t)
                .map((a) => (
                  <div key={a.id} className="group relative flex flex-col gap-[2px] rounded-lg py-[8px] pr-[28px] pl-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
                    <span className="text-micro text-fg-subtle">{a.question}</span>
                    <span className="text-caption leading-[18px] text-fg" dir="auto">
                      {a.answer}
                    </span>
                    <span className="absolute top-[4px] right-[4px] hidden group-hover:block">
                      <IconBtn
                        size="sm"
                        label="Remove"
                        onClick={() => {
                          const b = studio().doc.brief;
                          if (b) studio().mutate((d) => void (d.brief = removeAnswer(b, a.id, Date.now())), { history: false });
                        }}
                      >
                        <X size={12} absoluteStrokeWidth strokeWidth={1.25} />
                      </IconBtn>
                    </span>
                  </div>
                ))}
            </section>
          ))}
          <Button size="sm" variant="secondary" className="self-start" onClick={() => runCommand("discovery.redo-interview", "toolbar")}>
            Redo the interview…
          </Button>
        </>
      )}
    </div>
  );
}
