import { useEffect, useState } from "react";
import clsx from "clsx";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { ComponentSpec, PropSpec } from "@/design-system/components";
import { Checkbox, IconBtn, Segmented, Select } from "../controls";
import { IconPicker } from "../IconPicker";
import { tokenSetFor, useActiveSystem } from "@/design-system/registry";
import { r } from "../recipes";

/** Icon props for every lucide glyph here: 1.25px lines at any size. */
const ico = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * The component's properties as live controls (Figma's instance panel): every prop in the catalog
 * spec gets an editor for its type, with its limits shown underneath.
 */

type Props = Record<string, unknown>;

export function propSummary(p: PropSpec): string {
  switch (p.type) {
    case "string":
      return `Text, up to ${p.maxChars} characters${p.required ? ", required" : ""}`;
    case "number":
      return `Number${p.min !== undefined ? `, ${p.min}–${p.max}` : ""}${p.required ? ", required" : ""}`;
    case "boolean":
      return "On or off";
    case "enum":
      return `One of ${p.values.length}, default “${p.default}”`;
    case "icon":
      return `Icon${p.required ? ", required" : ""}`;
    case "strings":
      return `List of up to ${p.maxItems}, ${p.maxChars} characters each`;
    case "numbers":
      return `List of up to ${p.maxItems} numbers`;
    case "items":
      return `Up to ${p.maxItems} items`;
    case "path":
      return `Vector path data, up to ${p.maxChars} characters`;
    case "image":
      return "Picture: a crop of the source screenshot, or a placeholder";
  }
}

function TextProp({ value, max, onChange, label }: { value: string; max: number; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative">
      <input className="ds-input pr-[48px]" aria-label={label} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} />
      <span className={clsx("pointer-events-none absolute top-1/2 right-[8px] -translate-y-1/2 text-micro tnum", value.length >= max ? "text-warning" : "text-fg-subtle")}>
        {value.length}/{max}
      </span>
    </div>
  );
}

function NumberProp({ value, spec, onChange, label }: { value: unknown; spec: Extract<PropSpec, { type: "number" }>; onChange: (v: number | undefined) => void; label: string }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => setDraft(value === undefined ? "" : String(value)), [value]);
  return (
    <input
      type="number"
      className="ds-input tnum"
      aria-label={label}
      value={draft}
      min={spec.min}
      max={spec.max}
      step={spec.max !== undefined && spec.max <= 5 ? 0.1 : 1}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseFloat(e.target.value);
        if (e.target.value === "") onChange(undefined);
        else if (Number.isFinite(n)) onChange(Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n)));
      }}
    />
  );
}

/** A list of numbers, typed comma- or line-separated; the list updates as each entry parses. */
function NumbersProp({ value, max, onChange, label }: { value: unknown; max: number; onChange: (v: number[]) => void; label: string }) {
  const text = Array.isArray(value) ? value.join(", ") : "";
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return (
    <input
      className="ds-input tnum"
      aria-label={label}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const nums = e.target.value
          .split(/[,\n]/)
          .map((x) => x.trim())
          .filter(Boolean)
          .map(Number);
        if (nums.every(Number.isFinite)) onChange(nums.slice(0, max));
      }}
    />
  );
}

function IconProp({ value, required, onChange, label }: { value: unknown; required?: boolean; onChange: (v: string | undefined) => void; label: string }) {
  const system = useActiveSystem();
  return <IconPicker ariaLabel={label} value={typeof value === "string" && value ? value : undefined} allowNone={!required} set={tokenSetFor(system.id).iconSet} onChange={onChange} />;
}

function PropField({ name, spec, value, onChange }: { name: string; spec: PropSpec; value: unknown; onChange: (v: unknown) => void }) {
  switch (spec.type) {
    case "string":
      return <TextProp label={name} value={typeof value === "string" ? value : ""} max={spec.maxChars} onChange={(v) => onChange(v || undefined)} />;
    case "number":
      return <NumberProp label={name} value={value} spec={spec} onChange={onChange} />;
    case "boolean":
      return <Checkbox checked={value === true} onChange={(v) => onChange(v || undefined)} label={name} />;
    case "enum": {
      const v = typeof value === "string" ? value : spec.default;
      const short = spec.values.length <= 4 && spec.values.every((x) => x.length <= 10);
      return short ? (
        <Segmented label={name} value={v} onChange={onChange} options={spec.values.map((x) => ({ value: x, label: x }))} />
      ) : (
        <Select ariaLabel={name} value={v} options={spec.values.map((x) => ({ value: x, label: x }))} onChange={onChange} />
      );
    }
    case "icon":
      return <IconProp label={name} value={value} required={spec.required} onChange={onChange} />;
    case "strings": {
      const list = Array.isArray(value) ? value.map(String) : [];
      return (
        <textarea
          className="ds-textarea"
          aria-label={name}
          rows={Math.min(spec.maxItems, Math.max(2, list.length))}
          value={list.join("\n")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split("\n")
                .slice(0, spec.maxItems)
                .map((s) => s.slice(0, spec.maxChars)),
            )
          }
        />
      );
    }
    case "numbers":
      return <NumbersProp label={name} value={value} max={spec.maxItems} onChange={onChange} />;
    case "image":
      return <input className="ds-input font-mono text-caption" aria-label={name} value={typeof value === "string" ? value : ""} placeholder="crop:x,y,w,h" spellCheck={false} onChange={(e) => onChange(e.target.value || undefined)} />;
    case "path":
      return (
        <textarea
          className="ds-textarea font-mono text-caption"
          aria-label={name}
          rows={2}
          spellCheck={false}
          value={typeof value === "string" ? value : ""}
          maxLength={spec.maxChars}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case "items": {
      const items = (Array.isArray(value) ? value : []) as Props[];
      const set = (i: number, k: string, v: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
      return (
        <div className="flex flex-col gap-[8px]">
          {items.map((it, i) => (
            <div key={i} className="flex flex-col gap-[6px] rounded-lg bg-muted p-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              <div className="flex items-center justify-between">
                <span className="text-micro font-medium text-fg-subtle tnum">Item {i + 1}</span>
                <IconBtn size="sm" label="Remove item" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <Minus size={14} {...ico} />
                </IconBtn>
              </div>
              {Object.entries(spec.fields).map(([k, f]) => (
                <label key={k} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-[8px]">
                  <span className="truncate text-caption text-fg-subtle">{k}</span>
                  <PropField name={`${name} ${i + 1} ${k}`} spec={f} value={it[k]} onChange={(v) => set(i, k, v)} />
                </label>
              ))}
            </div>
          ))}
          {items.length < spec.maxItems && (
            <button
              type="button"
              onClick={() => onChange([...items, { ...(items[items.length - 1] ?? {}) }])}
              className="q-item q-press flex h-[28px] items-center justify-center gap-[4px] rounded-md border border-dashed border-line-strong text-caption text-fg-muted hover:border-fg-subtle hover:bg-hover hover:text-fg"
            >
              <Plus size={12} {...ico} /> Add item
            </button>
          )}
        </div>
      );
    }
  }
}

export function PropsEditor({ spec, props, onChange, onReset }: { spec: ComponentSpec; props: Props; onChange: (p: Props) => void; onReset: () => void }) {
  const entries = Object.entries(spec.props);
  return (
    <div className="flex flex-col">
      <div className={clsx(r.panelHeader, "border-b border-line-subtle")}>
        <h3 className={r.panelTitle}>Properties</h3>
        <IconBtn size="sm" label="Reset to the example" onClick={onReset}>
          <RotateCcw size={14} {...ico} />
        </IconBtn>
      </div>
      {entries.length === 0 && <p className="px-[16px] py-[12px] text-caption text-fg-subtle">{spec.name} has no properties: the system&apos;s tokens decide everything about it.</p>}
      <div className="flex flex-col gap-[16px] px-[16px] py-[12px]">
        {entries.map(([name, p]) => (
          <div key={name} className="flex flex-col gap-[6px]">
            {p.type !== "boolean" && (
              <div className="flex items-baseline justify-between gap-[8px]">
                <span className="text-caption font-medium text-fg">{name}</span>
                {"required" in p && p.required && <span className="text-micro text-fg-subtle">Required</span>}
              </div>
            )}
            <PropField
              name={name}
              spec={p}
              value={props[name]}
              onChange={(v) => {
                const next = { ...props };
                if (v === undefined) delete next[name];
                else next[name] = v;
                onChange(next);
              }}
            />
            <span className="text-micro text-fg-subtle">{p.description ?? propSummary(p)}</span>
          </div>
        ))}
        {spec.container && <p className="rounded-lg bg-muted px-[10px] py-[8px] text-caption text-fg-muted">Accepts other components inside it. The preview shows the example children.</p>}
      </div>
    </div>
  );
}
