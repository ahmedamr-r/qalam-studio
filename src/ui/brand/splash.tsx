import type { ReactNode } from "react";
import { QalamMark, Wordmark } from "./mark";
import { NuqtaLoader } from "./loader";

/**
 * Boot splash: mark + wordmark over the shell colour, with the nuqta loader (or an error) below.
 * StudioLoader shows it while the studio's code downloads and Studio while the engines start, so
 * the hand-off is seamless. Kept free of studio imports so it can render before they load.
 */
export function Splash({ children, error }: { children?: ReactNode; error?: ReactNode }) {
  return (
    <div className="flex w-[280px] flex-col items-center gap-[20px] text-center">
      <div className="flex items-center gap-[10px]">
        <QalamMark size={20} className="text-accent" />
        <Wordmark />
      </div>
      {error ? (
        <p className="text-body text-fg-muted" role="alert">
          {error}
        </p>
      ) : (
        <>
          <NuqtaLoader label="Loading Qalam Studio" />
          <div className="min-h-[38px]">{children}</div>
        </>
      )}
    </div>
  );
}
