import { useMemo, useState } from "react";
import type { SourceRecord } from "@/discovery/sources";
import { speakerName, type SpeakerRole, type TranscriptMeta } from "@/discovery/transcript";
import { Button, Select } from "../controls";
import { confirmSpeakers } from "./import";

/*
 * Who is who in an interview, before Qalam AI reads it. Code counts who asks the questions and who
 * talks, and proposes the interviewer; the builder checks a few of each speaker's lines and
 * confirms. Qalam AI quotes participants only, and code drops any quote outside their turns.
 */

const ROLES: { value: SpeakerRole; label: string }[] = [
  { value: "interviewer", label: "Interviewer" },
  { value: "participant", label: "Participant" },
  { value: "other", label: "Not quoted" },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, max = 140) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** A speaker's longest turns, as lines to recognise them by. */
function linesOf(source: SourceRecord, t: TranscriptMeta, id: string, n = 2): string[] {
  return t.turns
    .filter((x) => x.speaker === id)
    .map((x) => source.text.slice(x.span[0], x.span[1]))
    .sort((a, b) => b.length - a.length)
    .slice(0, n);
}

export function SpeakersStep({ source, onDone }: { source: SourceRecord; onDone?: () => void }) {
  const t = source.transcript!;
  const [roles, setRoles] = useState<Record<string, SpeakerRole>>(() => Object.fromEntries(t.speakers.map((s) => [s.id, s.role ?? "participant"])));
  const lines = useMemo(() => Object.fromEntries(t.speakers.map((s) => [s.id, linesOf(source, t, s.id)])), [source, t]);
  const proposed = t.speakers.find((s) => s.id === t.proposal.interviewer);
  const participants = Object.values(roles).filter((r) => r === "participant").length;
  const first = !t.rolesConfirmed;
  return (
    <section aria-label="Who is who" className="flex flex-col gap-[10px] rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex flex-col gap-[2px]">
        <h4 className="text-body font-semibold text-fg">Who is who?</h4>
        <p className="text-caption leading-[18px] text-fg-muted" dir="auto">
          {!proposed
            ? "Pick the interviewer, from the lines below."
            : t.proposal.confidence === "clear"
              ? `Qalam proposes ${speakerName(proposed)} as the interviewer: ${t.proposal.reasons.join(", ")}.`
              : `Qalam isn't sure who asked the questions. It proposes ${speakerName(proposed)}: ${t.proposal.reasons.join(", ")}. Check the lines below.`}
        </p>
      </div>
      <div role="list" className="flex flex-col gap-[8px]">
        {t.speakers.map((s) => (
          <div key={s.id} role="listitem" className="flex flex-col gap-[6px] rounded-lg bg-muted px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-caption font-medium text-fg" dir="auto">
                {s.name ? `${s.label} · ${s.name}` : s.label}
              </span>
              <span className="text-micro text-fg-subtle">
                Talks {pct(s.stats.talkShare)} · {plural(s.stats.turns, "turn")} · asks {plural(s.stats.questions, "question")}
              </span>
            </span>
            <span aria-hidden className="block h-[3px] overflow-hidden rounded-full bg-active">
              <span className="block h-full rounded-full bg-fg-subtle" style={{ width: pct(s.stats.talkShare) }} />
            </span>
            <Select ariaLabel={`${speakerName(s)}'s role`} className="w-full" value={roles[s.id]} options={ROLES} onChange={(v) => setRoles((r) => ({ ...r, [s.id]: v }))} />
            {lines[s.id].map((l, i) => (
              <p key={i} className="text-caption leading-[18px] text-fg-muted" dir="auto">
                “{clip(l)}”
              </p>
            ))}
          </div>
        ))}
      </div>
      <p className="text-micro text-fg-subtle">Qalam AI quotes participants only. Code drops any quote outside their turns{first ? "" : ", including ones already picked"}.</p>
      <div className="flex gap-[6px]">
        <Button
          size="sm"
          disabled={!participants}
          onClick={() => {
            void confirmSpeakers(source.id, roles);
            onDone?.();
          }}
        >
          {first ? "Confirm and find quotes" : "Save"}
        </Button>
        {!first && onDone && (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  );
}

/** Who is who, once confirmed: one line, with a way back to change it. */
export function SpeakersLine({ t, onChange }: { t: TranscriptMeta; onChange: () => void }) {
  const role = (r?: SpeakerRole) => ROLES.find((x) => x.value === r)?.label.toLowerCase() ?? "participant";
  return (
    <p className="flex flex-wrap items-baseline gap-x-[6px] text-micro text-fg-subtle">
      <span dir="auto">{t.speakers.map((s) => `${s.name ? `${s.label} ${s.name}` : s.label}: ${role(s.role)}`).join(" · ")}</span>
      <button type="button" className="font-medium underline decoration-fg/20 underline-offset-2 hover:text-fg" onClick={onChange}>
        Change
      </button>
    </p>
  );
}
