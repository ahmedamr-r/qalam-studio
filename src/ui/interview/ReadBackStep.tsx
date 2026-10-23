"use client";

import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { AXES, AXIS_POLES, DOMAINS, DOMAIN_LABEL, type AxisId, type Domain, type ReadBack } from "@/design-system/interview/knobs";
import { normalizeHex } from "@/design-system/resolve";
import { ErrorNote, Progress } from "../ai/common";
import { Button, Checkbox, Segmented, Select, Swatch, Tag } from "../controls";
import { r } from "../recipes";
import { runDirections } from "./ai";
import { StepHead } from "./InterviewApp";
import { busy, cancelBusy, interview, update, useInterview } from "./store";

/**
 * What Qalam AI heard, before anything is designed: the summary, the adjectives, where the brand
 * sits on each personality axis (with the designer's own words as evidence), and the practical
 * facts. Everything here is editable; the directions are built from what the designer confirms.
 */

const PLATFORMS = [
  { value: "mobile", label: "Phone" },
  { value: "web", label: "Web" },
  { value: "dashboard", label: "Dashboard" },
] as const;

function setRead(fn: (r: ReadBack) => ReadBack) {
  update((s) => (s.read ? { ...s, read: fn(s.read), directions: undefined } : s));
}

async function directions(sample?: boolean) {
  const read = interview().state.read;
  if (!read) return;
  const res = await busy("Designing three directions", (signal, onProgress) => runDirections(read, { signal, onProgress, sample: sample ?? interview().state.sample }));
  if (res) update((s) => ({ ...s, directions: res, stage: "directions" }));
}

export function ReadBackStep() {
  const read = useInterview((s) => s.state.read);
  const working = useInterview((s) => s.busy);
  const error = useInterview((s) => s.error);
  const hasDirections = useInterview((s) => !!s.state.directions);
  if (!read) return null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-[20px] px-[16px] py-[40px]">
        <StepHead eyebrow="Design system · What I heard" title="Here's what I heard">
          Check it before anything is designed. Change whatever doesn&apos;t sound like your brand: the directions are built from this.
        </StepHead>

        <Panel title="In short">
          <textarea
            value={read.summary}
            onChange={(e) => setRead((x) => ({ ...x, summary: e.target.value.slice(0, 600) }))}
            rows={3}
            dir="auto"
            aria-label="Summary"
            className="w-full resize-none rounded-md bg-field px-[10px] py-[8px] text-body text-fg outline-none focus:shadow-focus-field"
          />
          <Adjectives read={read} />
        </Panel>

        <Panel title="Personality" note="Where your brand sits between each pair. Open ones are where the three directions differ.">
          <div className="flex flex-col gap-[14px]">
            {AXES.map((a) => (
              <AxisRow key={a} axis={a} read={read} />
            ))}
          </div>
        </Panel>

        <Panel title="The product">
          <div className="grid gap-[12px] sm:grid-cols-2">
            <Field label="Kind of product">
              <Select<Domain> value={read.domain} options={DOMAINS.map((d) => ({ value: d, label: DOMAIN_LABEL[d] }))} onChange={(domain) => setRead((x) => ({ ...x, domain }))} ariaLabel="Kind of product" />
            </Field>
            <Field label="Mainly used on">
              <Segmented
                value={PLATFORMS.some((p) => p.value === read.platform) ? (read.platform as "mobile" | "web" | "dashboard") : null}
                options={PLATFORMS.map((p) => ({ value: p.value, label: p.label }))}
                onChange={(platform) => setRead((x) => ({ ...x, platform }))}
                label="Mainly used on"
              />
            </Field>
            <Field label="Brand colour">
              <BrandColour read={read} />
            </Field>
            <Field label="Languages">
              <Checkbox
                checked={read.scripts.includes("arabic")}
                onChange={(on) => setRead((x) => ({ ...x, scripts: on ? ["latin", "arabic"] : ["latin"] }))}
                label="Arabic too (adds a right-to-left preview)"
              />
            </Field>
          </div>
        </Panel>

        {working ? (
          <div className="flex flex-col gap-[8px]">
            <Progress tokens={working.tokens} started={working.started} label={working.label} />
            <Button variant="ghost" size="sm" className="self-start" onClick={cancelBusy}>
              Stop
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-[8px]">
            <Button variant="ghost" onClick={() => update((s) => ({ ...s, stage: "brief" }))}>
              Back to the brief
            </Button>
            <span className="flex-1" />
            {hasDirections && (
              <Button variant="secondary" onClick={() => update((s) => ({ ...s, stage: "directions" }))}>
                See the directions again
              </Button>
            )}
            <Button variant="primary" onClick={() => void directions()}>
              {hasDirections ? "Design new directions" : "Show me three directions"}
            </Button>
          </div>
        )}
        {error && <ErrorNote message={error} onSample={() => void directions(true)} />}
      </div>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[12px] rounded-xl bg-panel p-[16px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex flex-col gap-[2px]">
        <h2 className="text-body font-semibold text-fg">{title}</h2>
        {note && <p className="text-caption text-fg-subtle">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** A caption over a control (a group, not a <label>: some controls are several buttons). */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-[6px]">
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Adjectives({ read }: { read: ReadBack }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const w = draft.trim().toLowerCase().slice(0, 24);
    if (w && !read.adjectives.includes(w) && read.adjectives.length < 6) setRead((x) => ({ ...x, adjectives: [...x.adjectives, w] }));
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {read.adjectives.map((a) => (
        <span key={a} className="inline-flex h-[26px] items-center gap-[4px] rounded-md bg-active pl-[10px] pr-[4px] text-caption font-medium text-fg">
          {a}
          <button type="button" aria-label={`Remove ${a}`} onClick={() => setRead((x) => ({ ...x, adjectives: x.adjectives.filter((y) => y !== a) }))} className="grid size-[18px] place-items-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg">
            <X size={12} />
          </button>
        </span>
      ))}
      {read.adjectives.length < 6 && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Add a word"
          aria-label="Add an adjective"
          className="h-[26px] w-[110px] rounded-md bg-field px-[10px] text-caption text-fg outline-none placeholder:text-fg-faint focus:shadow-focus-field"
        />
      )}
    </div>
  );
}

function AxisRow({ axis, read }: { axis: AxisId; read: ReadBack }) {
  const a = read.axes[axis];
  const [lo, hi] = AXIS_POLES[axis];
  const open = a.confidence < 0.5;
  return (
    <div className="flex flex-col gap-[4px]">
      <div className="grid grid-cols-[88px_1fr_88px] items-center gap-[10px]">
        <span className={a.value <= 0.4 ? "text-caption font-medium text-fg" : "text-caption text-fg-subtle"}>{lo}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={a.value}
          aria-label={`${lo} to ${hi}`}
          onChange={(e) => setRead((x) => ({ ...x, axes: { ...x.axes, [axis]: { ...x.axes[axis], value: Number(e.target.value), confidence: Math.max(x.axes[axis].confidence, 0.9) } } }))}
          className="h-[16px] w-full cursor-pointer"
          style={{ accentColor: "var(--color-fg)" }}
        />
        <span className={a.value >= 0.6 ? "text-right text-caption font-medium text-fg" : "text-right text-caption text-fg-subtle"}>{hi}</span>
      </div>
      <div className="flex min-h-[18px] flex-wrap items-center gap-[6px] pl-[98px]">
        {open && <Tag tone="ai">Open: the directions explore this</Tag>}
        {a.evidence.map((q) => (
          <span key={q} className="text-caption italic text-fg-muted" dir="auto">
            “{q}”
          </span>
        ))}
      </div>
    </div>
  );
}

function BrandColour({ read }: { read: ReadBack }) {
  const [text, setText] = useState(read.brandHex ?? "");
  const commit = (v: string) => {
    const hex = v.trim() ? (normalizeHex(v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`)?.slice(0, 7) ?? null) : null;
    if (v.trim() && !hex) return;
    setRead((x) => ({ ...x, brandHex: hex }));
    setText(hex ?? "");
  };
  return (
    <div className={r.field}>
      {read.brandHex ? <Swatch color={read.brandHex} size={14} /> : <span className="size-[14px] rounded-sm shadow-[inset_0_0_0_1px_var(--color-line)]" />}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
        placeholder="None: Qalam AI suggests"
        aria-label="Brand colour"
        className={r.fieldInput}
      />
    </div>
  );
}
