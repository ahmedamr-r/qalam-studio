import { useEffect, useRef, useState } from "react";
import TitleEditor from "./TitleEditor";
import CardBar from "./CardBar";
import StartSheet from "./StartSheet";
import DesignThis from "./DesignThis";
import ReviewLayer from "./ReviewLayer";
import BrainDump from "./BrainDump";
import WhyPrompt from "../decisions/WhyPrompt";
import CompareView from "./CompareView";
import { noticesStale, useNotices } from "../notices/useNotices";
import { useStudio } from "@/doc/store";
import { useProject } from "@/projects/session";
import { useDiscovery } from "./store";

/**
 * The Discovery board's DOM over the canvas: the title being typed, the bar over the selected
 * card, the start sheet (interview, sample, import, blank), the Design this card, Qalam AI's
 * proposals under review, the brain dump card, the needs compared side by side, and the why a big
 * decision asks for. Only in Discovery.
 * It also keeps what needs a look about the board's cards current (the canvas marks them).
 */
export default function DiscoveryLayer() {
  const board = useProject((s) => s.project?.id ?? null);
  const notices = useNotices(board);
  useEffect(() => useDiscovery.setState({ notices: notices?.notices ?? [] }), [notices]);
  // The board's own changes (a test's result, a new stage) aren't announced back to it: check again once they're saved.
  useEffect(() => useStudio.subscribe((s, prev) => void (s.doc !== prev.doc && noticesStale())), []);
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
          <CompareView />
        </>
      )}
    </div>
  );
}
