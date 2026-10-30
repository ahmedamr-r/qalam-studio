import clsx from "clsx";
import type { SourceRecord } from "@/discovery/sources";
import { speakersOf, type SourceWho } from "@/hub/people";
import { knownSegments, usePeople } from "@/org/people";
import { Select } from "../controls";
import { r } from "../recipes";
import { editPerson } from "../org/PersonEditor";

/*
 * Who said what's in a source, and when: each speaker as a person the organization knows (or a
 * new one), or one person or one segment for all of it. Code counts people from it, not quotes,
 * and tells segments apart (src/hub/people.ts).
 */

const NONE = "_none";
const NEW = "_new";

const day = (at: number | undefined) => (at ? new Date(at).toISOString().slice(0, 10) : "");

export function WhoSection({ source, onChange }: { source: SourceRecord; onChange: (who: SourceWho | undefined) => void }) {
  const people = usePeople((s) => s.people);
  const who = source.who ?? {};
  const speakers = speakersOf(source);
  const segments = knownSegments(source.product);
  const set = (patch: Partial<SourceWho>) => {
    const next: SourceWho = { ...who, ...patch };
    for (const k of Object.keys(next) as (keyof SourceWho)[]) if (next[k] === undefined || next[k] === "" || (k === "speakers" && !Object.keys(next.speakers ?? {}).length)) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const personOptions = [{ value: NONE, label: "Not known" }, ...people.map((p) => ({ value: p.id, label: p.segments.length ? `${p.name} · ${p.segments.join(", ")}` : p.name })), { value: NEW, label: "New person…" }];
  /** A person picked (or made) for a speaker, or for all of it. */
  const pick = async (v: string, name: string | undefined, apply: (id: string | undefined) => void) => {
    if (v === NEW) {
      const p = await editPerson(null, { name, product: source.product });
      if (p) apply(p.id);
      return;
    }
    apply(v === NONE ? undefined : v);
  };
  const plainName = (label: string) => label.split(" · ")[1] ?? (/^S\d+$/.test(label) ? undefined : label);

  return (
    <section aria-label="Who said it" className="flex flex-col gap-[8px] rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex flex-col gap-[2px]">
        <h4 className="text-caption font-semibold text-fg">Who said it</h4>
        <p className="text-micro text-fg-subtle">So Qalam counts people, not quotes, and tells segments apart.</p>
      </div>
      {speakers.length ? (
        speakers.map((s) => (
          <label key={s.key} className="grid grid-cols-[96px_1fr] items-center gap-[8px]">
            <span className="truncate text-caption text-fg-muted" dir="auto">
              {s.label}
            </span>
            <Select
              ariaLabel={`Who ${s.label} is`}
              value={who.speakers?.[s.key] ?? NONE}
              options={personOptions}
              onChange={(v) => void pick(v, plainName(s.label), (id) => set({ speakers: { ...Object.fromEntries(Object.entries(who.speakers ?? {}).filter(([k]) => k !== s.key)), ...(id ? { [s.key]: id } : {}) } }))}
            />
          </label>
        ))
      ) : (
        <label className="grid grid-cols-[96px_1fr] items-center gap-[8px]">
          <span className="text-caption text-fg-muted">All of it from</span>
          <Select ariaLabel="Who it's all from" value={who.person ?? NONE} options={personOptions} onChange={(v) => void pick(v, undefined, (id) => set({ person: id }))} />
        </label>
      )}
      <label className="grid grid-cols-[96px_1fr] items-center gap-[8px]">
        <span className="text-caption text-fg-muted">Segment</span>
        <Select
          ariaLabel="The segment it's from"
          value={who.segment ?? NONE}
          options={[{ value: NONE, label: speakers.length || who.person ? "As each person's" : "Not known" }, ...[...new Set([...segments, ...(who.segment ? [who.segment] : [])])].map((s) => ({ value: s, label: s }))]}
          onChange={(v) => set({ segment: v === NONE ? undefined : v })}
        />
      </label>
      <label className="grid grid-cols-[96px_1fr] items-center gap-[8px]">
        <span className="text-caption text-fg-muted">Said on</span>
        <span className={clsx(r.field, "h-(--field-h)")}>
          <input
            type="date"
            aria-label="When it was said"
            value={day(who.saidAt)}
            max={day(Date.now())}
            onChange={(e) => {
              const t = e.target.value ? Date.parse(`${e.target.value}T12:00:00Z`) : NaN;
              set({ saidAt: Number.isFinite(t) ? t : undefined });
            }}
            className={clsx(r.fieldInput, "text-caption")}
          />
        </span>
      </label>
    </section>
  );
}
