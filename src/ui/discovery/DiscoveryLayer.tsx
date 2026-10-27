import { useEffect, useRef, useState } from "react";
import TitleEditor from "./TitleEditor";
import CardBar from "./CardBar";
import StartSheet from "./StartSheet";
import DesignThis from "./DesignThis";
import ReviewLayer from "./ReviewLayer";
import BrainDump from "./BrainDump";
import WhyPrompt from "../decisions/WhyPrompt";

/**
 * The Discovery board's DOM over the canvas: the title being typed, the bar over the selected
 * card, the start sheet (interview, sample, import, blank), the Design this card, Qalam AI's
 * proposals under review, the brain dump card, and the why a big decision asks for. Only in Discovery.
 */
export default function DiscoveryLayer() {
  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[7] overflow-hidden">
      <TitleEditor />
      {vp.w > 0 && (
        <>
          <CardBar vp={vp} />
          <DesignThis vp={vp} />
          <ReviewLayer vp={vp} />
          <BrainDump vp={vp} />
          <WhyPrompt />
          <StartSheet />
        </>
      )}
    </div>
  );
}
