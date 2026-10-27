import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ImagePlus, Plus, X } from "lucide-react";
import { useStudio, studio } from "@/doc/store";
import { assetURL } from "@/doc/assets";
import { MAX_EXTRACT_IMAGES } from "@/design-system/extract-options";
import { r } from "../recipes";
import { SAMPLE_DS_IMAGE, type ShotInput } from "./extract";
import { pill } from "./Composer";

/** The Extract tool's composer: up to 8 screenshots of one product, from files, the canvas or the sample. */

export interface Shot {
  key: string;
  name: string;
  url: string | null;
  blob?: Blob;
  src?: string;
  nodeId?: string;
  /** The object URL is ours to revoke. */
  own?: boolean;
}

export interface Shots {
  items: Shot[];
  /** The bundled sample screenshot (replayed from a recording). */
  sample: boolean;
  addFiles: (files: File[]) => void;
  addNodes: (ids: string[]) => void;
  addSample: () => Promise<void>;
  remove: (key: string) => void;
  clear: () => void;
  toInput: () => ShotInput[];
}

let seq = 0;

export function useShots(): Shots {
  const [items, setItems] = useState<Shot[]>([]);
  const [sample, setSample] = useState(false);
  /** The list as last set (object URLs of canvas images arrive later and only matter for display). */
  const live = useRef<Shot[]>([]);
  useEffect(() => () => live.current.forEach((s) => s.own && s.url && URL.revokeObjectURL(s.url)), []);

  const drop = (list: Shot[]) => list.forEach((s) => s.own && s.url && URL.revokeObjectURL(s.url));
  const put = (next: Shot[], isSample: boolean) => {
    live.current = next;
    setItems(next);
    setSample(isSample);
  };
  /** What new images join: the sample makes way for real screenshots. */
  const base = () => {
    if (!sample) return live.current;
    drop(live.current);
    return [];
  };
  const addFiles = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const cur = base();
    const room = Math.max(0, MAX_EXTRACT_IMAGES - cur.length);
    put([...cur, ...imgs.slice(0, room).map((f) => ({ key: `f${++seq}`, name: f.name.replace(/\.[a-z]+$/i, ""), url: URL.createObjectURL(f), blob: f, own: true }))], false);
  };
  const addNodes = (ids: string[]) => {
    const { doc } = studio();
    const cur = base();
    const added: Shot[] = [];
    for (const id of ids) {
      const n = doc.nodes[id];
      if (n?.type !== "image" || cur.some((s) => s.nodeId === id) || cur.length + added.length >= MAX_EXTRACT_IMAGES) continue;
      added.push({ key: `n${n.id}`, name: n.name, url: null, src: n.src, nodeId: n.id });
    }
    put([...cur, ...added], false);
    for (const s of added) void assetURL(s.src!).then((url) => setItems((now) => now.map((x) => (x.key === s.key ? { ...x, url } : x))));
  };
  const addSample = async () => {
    const blob = await (await fetch(SAMPLE_DS_IMAGE)).blob();
    drop(live.current);
    put([{ key: `s${++seq}`, name: "Lumen Wallet (sample)", url: URL.createObjectURL(blob), blob, own: true }], true);
  };
  const remove = (key: string) => {
    drop(live.current.filter((s) => s.key === key));
    const next = live.current.filter((s) => s.key !== key);
    put(next, next.length ? sample : false);
  };
  const clear = () => {
    drop(live.current);
    put([], false);
  };
  const toInput = (): ShotInput[] => live.current.map((s) => ({ blob: s.blob, src: s.src, name: s.name, nodeId: s.nodeId }));
  return { items, sample, addFiles, addNodes, addSample, remove, clear, toInput };
}

/** Image nodes selected on the canvas that aren't attached yet. */
function useSelectedImages(items: Shot[]): string[] {
  const ids = useStudio((s) => s.selection.filter((id) => s.doc.nodes[id]?.type === "image").join(","));
  return ids ? ids.split(",").filter((id) => !items.some((s) => s.nodeId === id)) : [];
}

export function ShotsRow({ shots }: { shots: Shots }) {
  const selected = useSelectedImages(shots.items);
  const room = MAX_EXTRACT_IMAGES - (shots.sample ? 0 : shots.items.length);
  return (
    <div className="flex flex-col gap-[6px] px-[10px] pt-[10px]">
      {shots.items.length > 0 && (
        <div className="flex flex-wrap items-end gap-[8px]">
          {shots.items.map((s) => (
            <div key={s.key} className="q-fade relative shrink-0" title={s.name}>
              {/* Screenshots are user content: a light stage behind them in both themes. */}
              {s.url ? <img src={s.url} alt={s.name} className="h-[56px] w-[40px] rounded-md bg-stage object-cover object-top shadow-swatch" /> : <div className="q-skeleton h-[56px] w-[40px] rounded-md" />}
              <button type="button" aria-label={`Remove ${s.name}`} onClick={() => shots.remove(s.key)} className="q-press q-press-icon absolute -top-[6px] -right-[6px] grid size-[16px] place-items-center rounded-full bg-inverse text-fg-inverse shadow-raised">
                <X size={10} strokeWidth={2} />
              </button>
            </div>
          ))}
          <span className="pb-[2px] text-micro text-fg-subtle tnum">{shots.sample ? "Sample: replays a recorded run" : `${shots.items.length} of ${MAX_EXTRACT_IMAGES}`}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-[4px]">
        {selected.length > 0 && room > 0 && (
          <button type="button" onClick={() => shots.addNodes(selected)} className={pill} title="Attach the images selected on the canvas">
            <Plus size={12} absoluteStrokeWidth strokeWidth={1.25} /> Use {selected.length > 1 ? `${Math.min(selected.length, room)} selected images` : "the selected image"}
          </button>
        )}
        {!shots.items.length && <span className="text-caption text-fg-subtle">Attach up to {MAX_EXTRACT_IMAGES} screenshots of one product: drop, paste or pick them.</span>}
      </div>
    </div>
  );
}

export function ShotsButtons({ shots }: { shots: Shots }) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          shots.addFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <button type="button" onClick={() => file.current?.click()} className={pill} title="Attach screenshots">
        <ImagePlus size={12} absoluteStrokeWidth strokeWidth={1.25} /> Screenshots
      </button>
      {!shots.items.length && (
        <button type="button" onClick={() => void shots.addSample()} title="Try the bundled sample screenshot (replays a recorded run)" className={clsx(r.buttonSm, r.buttonGhost)}>
          Sample
        </button>
      )}
    </>
  );
}
