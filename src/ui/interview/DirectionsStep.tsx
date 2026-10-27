import { useMemo } from "react";
import clsx from "clsx";
import { KNOB_SPECS, hueName, type Direction, type ReadBack } from "@/design-system/interview/knobs";
import { TokenSet } from "@/design-system/resolve";
import { pickDirection } from "@/projects/interview";
import { QalamAIGlyph } from "../brand";
import { ErrorNote, Progress } from "../ai/common";
import { Button, Swatch, Tag } from "../controls";
import { runDirections } from "./ai";
import { StepHead } from "./InterviewApp";
import { draftSystem, scenariosFor, useRender } from "./previewCache";
import { busy, cancelBusy, interview, update, useInterview } from "./store";

/**
 * Three directions side by side, the way a brand designer presents style tiles: each is a living
 * tile (the system's components) beside the product's home screen in it. Side by side suits big
 * differences; the finer choices happen in Refine, one screen at a time.
 */

const TILE_PX = 800;

async function again(sample?: boolean) {
  const read = interview().state.read;
  if (!read) return;
  const res = await busy("Designing three new directions", (signal, onProgress) => runDirections(read, { signal, onProgress, sample: sample ?? interview().state.sample }));
  if (res) update((s) => ({ ...s, directions: res }));
}

export function DirectionsStep() {
  const read = useInterview((s) => s.state.read);
  const dirs = useInterview((s) => s.state.directions);
  const working = useInterview((s) => s.busy);
  const error = useInterview((s) => s.error);
  if (!read || !dirs) return null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-[20px] px-[16px] py-[32px]">
        <div className="flex flex-wrap items-end justify-between gap-[12px]">
          <StepHead eyebrow="Design system · Directions" title="Three directions for your system">
            Each one is true to your brief; they differ where your answers left room. Pick the closest. You&apos;ll fine-tune it next.
          </StepHead>
          <div className="flex items-center gap-[8px]">
            <Button variant="ghost" onClick={() => update((s) => ({ ...s, stage: "read" }))}>
              Back
            </Button>
            <Button variant="secondary" onClick={() => void again()} disabled={!!working}>
              <QalamAIGlyph size={14} /> New directions
            </Button>
          </div>
        </div>
        {working && (
          <div className="flex flex-col gap-[8px]">
            <Progress tokens={working.tokens} started={working.started} label={working.label} />
            <Button variant="ghost" size="sm" className="self-start" onClick={cancelBusy}>
              Stop
            </Button>
          </div>
        )}
        {error && <ErrorNote message={error} onSample={() => void again(true)} />}
        <ul className="grid gap-[16px] lg:grid-cols-3">
          {dirs.list.map((d, i) => (
            <li key={`${d.name}-${i}`}>
              <Tile d={d} i={i} read={read} recommended={i === dirs.recommended} picked={dirs.picked === i} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Tile({ d, i, read, recommended, picked }: { d: Direction; i: number; read: ReadBack; recommended: boolean; picked: boolean }) {
  const list = scenariosFor(read);
  const hero = list.find((s) => s.id === "hero");
  const strip = list.find((s) => s.id === "strip");
  const heroImg = useRender(d.knobs, read, hero, TILE_PX, "commit");
  const stripImg = useRender(d.knobs, read, strip, TILE_PX, "prefetch");
  const swatches = useMemo(() => {
    const ts = new TokenSet(draftSystem(d.knobs, read).ds.tree);
    return ["bg.brand-strong", "bg.brand", "bg.brand-subtle", "bg.surface", "text.primary"].map((p) => ts.color(p) ?? "#000000");
  }, [d.knobs, read]);
  const k = d.knobs;
  const facts = [k.font, KNOB_SPECS.radius.phrase(k.radius), k.density, KNOB_SPECS.elevation.phrase(k.elevation)];
  return (
    <article
      className={clsx(
        "flex h-full flex-col gap-[12px] rounded-xl bg-panel p-[14px]",
        recommended ? "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ai)_45%,transparent)]" : "shadow-[inset_0_0_0_1px_var(--color-line-subtle)]",
      )}
    >
      <header className="flex flex-col gap-[6px]">
        <div className="flex items-center justify-between gap-[8px]">
          <h2 className="text-title font-semibold text-fg">{d.name}</h2>
          {recommended && <Tag tone="ai">Qalam AI recommends</Tag>}
        </div>
        <p className="min-h-[40px] text-caption text-fg-muted" dir="auto">
          {d.rationale}
        </p>
      </header>
      <div className="grid grid-cols-2 gap-[8px]">
        <Shot url={heroImg?.url} label={`${d.name}: home screen`} />
        <Shot url={stripImg?.url} label={`${d.name}: components`} />
      </div>
      <div className="flex items-center gap-[6px]">
        {swatches.map((c, j) => (
          <Swatch key={j} color={c} size={18} />
        ))}
        <span className="ml-[4px] truncate text-caption text-fg-muted">{k.brandHex ? "Your brand colour" : `${hueName(k.hue)}, ${k.chroma}`}</span>
      </div>
      <p className="text-caption text-fg-subtle">{facts.join(" · ")}</p>
      {d.hueReason && <p className="text-caption text-fg-subtle">{d.hueReason}</p>}
      <div className="mt-auto pt-[4px]">
        <Button variant={recommended || picked ? "primary" : "secondary"} className="w-full" onClick={() => update((s) => pickDirection(s, i))}>
          {picked ? "Continue refining this one" : "Refine this direction"}
        </Button>
      </div>
    </article>
  );
}

function Shot({ url, label }: { url?: string; label: string }) {
  return (
    <div className="grid aspect-[390/844] place-items-center overflow-hidden rounded-lg bg-stage shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      {url ? (
        <img src={url} alt={label} className="h-full w-full object-contain object-top" />
      ) : (
        <span className="q-skeleton h-full w-full" aria-label={`Drawing ${label}`} />
      )}
    </div>
  );
}
