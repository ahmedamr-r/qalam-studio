import { useEffect, useRef, useState } from "react";
import { installVoice, parakeetSize, useVoice } from "@/org/voice";
import { Button } from "../controls";

/*
 * Parakeet, offered where the Mac has no Apple engine (macOS before 26): how big it is, Install
 * with its progress and Stop. Nothing downloads until they click; a stopped download goes on from
 * where it was next time.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const megabytes = (n: number) => `${Math.round(n / 1e6)} MB`;

export function ParakeetInstall({ onDone }: { onDone?: () => void }) {
  const installed = useVoice((v) => v.view?.parakeet.installed ?? false);
  const [size, setSize] = useState<number | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    void parakeetSize().then(setSize, () => {});
    return () => ctrl.current?.abort();
  }, []);
  if (installed) return null;

  const install = () => {
    const c = new AbortController();
    ctrl.current = c;
    setError(null);
    setDone(0);
    void installVoice("parakeet", (l) => l.t === "progress" && setDone(l.done), c.signal)
      .then(() => onDone?.())
      .catch((e) => setError(c.signal.aborted ? "Stopped. Install goes on from where it was." : message(e)))
      .finally(() => {
        ctrl.current = null;
        setDone(null);
      });
  };

  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-caption text-fg-muted">Apple&apos;s speech engine needs macOS 26. Parakeet, NVIDIA&apos;s English model, runs on this Mac instead: {size ? megabytes(size) : "about 465 MB"}, downloaded once from Hugging Face.</p>
      {done !== null ? (
        <div className="flex items-center gap-[10px]" role="status">
          <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-ai transition-[width] duration-quick" style={{ width: `${Math.round(done * 100)}%` }} />
          </div>
          <span className="w-[96px] text-right text-caption text-fg-subtle tnum">{size ? `${megabytes(done * size)} of ${megabytes(size)}` : `${Math.round(done * 100)}%`}</span>
          <Button size="sm" variant="ghost" onClick={() => ctrl.current?.abort()}>
            Stop
          </Button>
        </div>
      ) : (
        <Button size="sm" className="self-start" onClick={install}>
          Install Parakeet
        </Button>
      )}
      {error && <p className="text-caption text-danger">{error}</p>}
    </div>
  );
}
