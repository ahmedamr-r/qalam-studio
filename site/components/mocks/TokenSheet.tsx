/* Tovi's token sheet as the System builder lays it out on the canvas: colours, type, corners, space. */
export const TOVI_SWATCHES = ["#16181d", "#1f2a37", "#0a7570", "#f6f4f0", "#5a5e66"];

export function TokenSheet({ scale = 1 }: { scale?: number }) {
  return (
    <div className="token-sheet" style={{ scale, transformOrigin: "0 0" }} dir="ltr" lang="en">
      <div className="ts-swatches">
        {TOVI_SWATCHES.map((hex) => (
          <span key={hex} className="ts-swatch" data-swatch={hex}>
            <i style={{ background: hex }} />
            <code>{hex.toUpperCase()}</code>
          </span>
        ))}
      </div>
      <div className="ts-row">
        <span className="ts-type" data-ts="type">
          Aa
        </span>
        <span className="ts-type-meta">
          Cubit Sans
          <code>32 / 16 / 13</code>
        </span>
        <span className="ts-radii" data-ts="radii">
          {[8, 12, 16].map((r) => (
            <span key={r}>
              <i style={{ borderTopLeftRadius: r * 1.6 }} />
              <code>{r}</code>
            </span>
          ))}
        </span>
      </div>
      <div className="ts-space" data-ts="space">
        {[4, 8, 12, 16, 24, 32].map((v) => (
          <i key={v} style={{ width: v * 1.25 }} />
        ))}
      </div>
    </div>
  );
}
