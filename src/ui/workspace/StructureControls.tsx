import { Fragment } from "react";
import type { TokenSet } from "@/design-system/resolve";
import { setValue } from "@/design-system/edit";
import { styleOf, stylesFor } from "@/design-system/styles";
import { OptionEditor } from "./TokenValue";
import type { Edit } from "./useEditor";

/**
 * How the shown system draws a component's structure (styles.ts): a floating or docked tab bar,
 * labels, title placement… One control per axis; every screen built with the system follows (the
 * built-in system forks into an editable copy on the first change, like any token edit).
 */
export default function StructureControls({ component, ts, edit }: { component: string; ts: TokenSet; edit: Edit }) {
  const axes = stylesFor(component);
  if (!axes.length) return null;
  return (
    <section className="flex flex-col gap-[10px] rounded-xl p-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" aria-label={`${component} structure`}>
      <div className="flex items-baseline justify-between gap-[12px]">
        <span className="text-caption font-semibold text-fg">Structure</span>
        <span className="text-micro text-fg-subtle">How this system draws {component}. Every screen follows.</span>
      </div>
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-[16px] gap-y-[8px]">
        {axes.map((a) => (
          <Fragment key={a.path}>
            <span className="text-caption text-fg-muted" title={a.description}>
              {a.label}
            </span>
            <OptionEditor path={a.path} value={styleOf(ts, a.path)} onSet={(v) => !!edit(`${component} · ${a.label}`, (tree) => setValue(tree, a.path, v))} />
          </Fragment>
        ))}
      </div>
    </section>
  );
}
