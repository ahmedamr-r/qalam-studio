import type { ReactNode, RefObject } from "react";

export type Caption = { title: string; body: string; extra?: ReactNode };

/**
 * A tall section whose stage sticks while its captions scroll past (the Apple product-page
 * pattern: no scroll hijacking, just a stage that holds). `beats` is the section's height in
 * viewports; the stage holds for `beats - 1` of them, which is the scene timeline's 0 → 1.
 * The first caption carries the step marker that the thread fills as it passes.
 */
export function Scene({
  id,
  sceneRef,
  beats,
  step,
  captions,
  children,
  wide,
  interactive,
}: {
  id: string;
  sceneRef: RefObject<HTMLElement | null>;
  beats: number;
  step?: number;
  captions: Caption[];
  children: ReactNode;
  /** Give the stage more of the row (dense mocks). */
  wide?: boolean;
  /** The stage holds real controls. Otherwise it is an illustration of the captions and is hidden
      from screen readers, which would read every mock label out of order. */
  interactive?: boolean;
}) {
  return (
    <section
      ref={sceneRef}
      id={id}
      className={`scene ${wide ? "scene-wide" : ""}`}
      style={{ ["--beats" as string]: beats }}
      aria-labelledby={`${id}-title`}
    >
      <div className="scene-grid container">
        <div className="captions">
          {captions.map((c, i) => (
            <div className="caption" key={i}>
              <div className="caption-inner">
                {i === 0 && step !== undefined && (
                  <span className="step" aria-hidden>
                    <span>{step}</span>
                  </span>
                )}
                {i === 0 ? (
                  <h2 id={`${id}-title`} className="caption-title">
                    {c.title}
                  </h2>
                ) : (
                  <h3 className="caption-title">{c.title}</h3>
                )}
                <p className="caption-body">{c.body}</p>
                {c.extra}
              </div>
            </div>
          ))}
        </div>
        <div className="stage-col">
          <div className="stage" aria-hidden={interactive ? undefined : true}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
