import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, Download, PenLine } from "lucide-react";
import { guideMarkdown, type ComponentGuide } from "@/design-system/docs";
import { Button } from "../controls";
import { download } from "../exporter";
import { r } from "../recipes";

/** Icon props for every lucide glyph here: 1.25px lines at any size. */
const ico = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/*
 * Prose, on the named scale: a 14px lead, 13/20 body in fg-muted with fg for terms, eyebrow captions
 * above each section, and a reading measure of about 72 characters.
 */
const prose = "max-w-[72ch] text-body leading-[20px] text-fg-muted";

/**
 * A component's design.md: read as a document, or switch to fields and edit it in place. Each
 * field saves when it loses focus.
 */

type Save = (patch: Partial<ComponentGuide>) => void;

const LISTS = [
  { key: "whenToUse", label: "When to use" },
  { key: "whenNotToUse", label: "When not to use" },
  { key: "anatomy", label: "Anatomy" },
  { key: "dos", label: "Do" },
  { key: "donts", label: "Don't" },
] as const;

const TEXTS = [
  { key: "content", label: "Content" },
  { key: "placement", label: "Placement" },
  { key: "states", label: "States" },
] as const;

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);

function Heading({ children }: { children: ReactNode }) {
  return <h4 className={clsx(r.eyebrow, "mb-[6px]")}>{children}</h4>;
}

function TextArea({ label, value, onSave, rows = 3, hint }: { label: string; value: string; onSave: (v: string) => void; rows?: number; hint?: string }) {
  const [draft, setDraft] = useState(value);
  // Follow the stored text (an undo, another field's save re-rendering the guide).
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="flex items-baseline justify-between">
        <span className="text-caption font-medium text-fg">{label}</span>
        {hint && <span className="text-micro text-fg-subtle">{hint}</span>}
      </span>
      <textarea className="ds-textarea" rows={rows} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onSave(draft)} />
    </label>
  );
}

/** `compact`: one column for a side panel (the two-column layout follows the window's width, not the panel's). */
export function GuideDoc({ guide, systemName, onSave, editable = true, compact = false }: { guide: ComponentGuide; systemName: string; onSave: Save; editable?: boolean; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const empty = !guide.whenToUse.length && !guide.variants.length && !guide.dos.length && !guide.anatomy.length && !guide.content;

  const actions = (
    <div className="flex shrink-0 gap-[8px]">
      {editable && (
        <Button size="sm" variant={editing ? "primary" : "secondary"} onClick={() => setEditing(!editing)}>
          {editing ? <Check size={12} {...ico} /> : <PenLine size={12} {...ico} />} {editing ? "Done" : "Edit"}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => download(`${guide.component}.design.md`, guideMarkdown(guide, systemName), "text/markdown")}>
        <Download size={12} {...ico} /> <span className="font-mono text-micro">design.md</span>
      </Button>
    </div>
  );

  if (editing) {
    return (
      <div className="q-fade flex flex-col gap-[16px]">
        <div className="flex items-center justify-between gap-[12px]">
          <span className="text-caption text-fg-subtle">One item per line in lists. Changes save as you leave a field.</span>
          {actions}
        </div>
        <TextArea label="Purpose" value={guide.purpose} rows={2} onSave={(v) => onSave({ purpose: v.trim() })} />
        <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-2">
          {LISTS.map((l) => (
            <TextArea key={l.key} label={l.label} value={guide[l.key].join("\n")} rows={4} onSave={(v) => onSave({ [l.key]: lines(v) })} />
          ))}
          <TextArea
            label="Variants"
            hint="name: when to use it"
            value={guide.variants.map((v) => `${v.name}: ${v.usage}`).join("\n")}
            rows={4}
            onSave={(v) =>
              onSave({
                variants: lines(v).map((l) => {
                  const i = l.indexOf(":");
                  return i < 0 ? { name: l, usage: "" } : { name: l.slice(0, i).trim(), usage: l.slice(i + 1).trim() };
                }),
              })
            }
          />
        </div>
        {TEXTS.map((t) => (
          <TextArea key={t.key} label={t.label} value={guide[t.key]} rows={2} onSave={(v) => onSave({ [t.key]: v.trim() })} />
        ))}
      </div>
    );
  }

  return (
    <article className={clsx("q-fade flex flex-col", compact ? "gap-[16px]" : "gap-[24px]")}>
      <div className={clsx("flex gap-[16px]", compact ? "flex-col items-start gap-[8px]" : "items-start justify-between")}>
        <p className={clsx("max-w-[64ch] text-fg", compact ? "text-body leading-[20px]" : "text-title leading-[22px]")}>{guide.purpose || <span className="text-fg-subtle">No purpose written yet.</span>}</p>
        {actions}
      </div>
      {empty && (
        <div className="rounded-lg border border-dashed border-line-strong px-[16px] py-[14px] text-body text-fg-muted">
          No usage guidance yet for {guide.component} in {systemName}.{" "}
          {editable && (
            <button type="button" className={clsx(r.link, "font-medium")} onClick={() => setEditing(true)}>
              Write it
            </button>
          )}
        </div>
      )}
      <div className={clsx("grid grid-cols-1 gap-x-[32px]", compact ? "gap-y-[16px]" : "gap-y-[24px] xl:grid-cols-2")}>
        {LISTS.map((l) =>
          guide[l.key].length ? (
            <section key={l.key}>
              <Heading>{l.label}</Heading>
              {/* Do / Don't markers carry meaning by colour and by the heading above them. */}
              <ul
                className={clsx(
                  prose,
                  "flex flex-col gap-[4px] marker:text-fg-faint",
                  l.key === "dos" && "marker:text-success",
                  l.key === "donts" && "marker:text-danger",
                )}
                style={{ listStyle: "disc", paddingLeft: 18 }}
              >
                {guide[l.key].map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
        {guide.variants.length > 0 && (
          <section>
            <Heading>Variants</Heading>
            <dl className={clsx(prose, "flex flex-col gap-[6px]")}>
              {guide.variants.map((v) => (
                <div key={v.name}>
                  <dt className="inline font-medium text-fg">{v.name}</dt>
                  {v.usage && <dd className="inline"> — {v.usage}</dd>}
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
      {TEXTS.map((t) =>
        guide[t.key] ? (
          <section key={t.key}>
            <Heading>{t.label}</Heading>
            <p className={prose}>{guide[t.key]}</p>
          </section>
        ) : null,
      )}
    </article>
  );
}
