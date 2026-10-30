import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ORG_SEEN } from "@/seen/types";
import { seenHref, spaceHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand";
import { ChatComposer, ChatThread } from "../chat/ChatThread";
import { Panel, PanelLayout, StepList, useWide, WIDE } from "../chat/Panels";
import { PageFrame } from "../frame/PageFrame";
import { useFrame } from "../frame/store";
import { useSpaceName } from "../frame/useSpace";
import { r } from "../recipes";
import { answer, closeSeen, dropReading, openSeen, sendAnswers, useSeen } from "./client";
import { FlowsSoFar } from "./FlowsSoFar";
import { PARTS } from "./parts";
import { ShotZoom } from "./Shot";
import { readingAsk, readingSteps, readingThread, type ReadingInput } from "./thread";

/*
 * Reading a batch of screenshots for a product, as a conversation in panels (like the first run):
 * the steps down the left (Add · Read · Place · Notes), Qalam AI in the middle, asking where it
 * can't tell and showing the screens each question is about, and the flows taking shape on the
 * right, where they're accepted. The thread is read from the reading the core keeps (./thread.ts),
 * so leaving and coming back shows it as it was.
 */

export default function SeenReading({ seenKey }: { seenKey: string }) {
  const space = seenKey === ORG_SEEN ? null : seenKey;
  const productName = useSpaceName(space) || "the product";
  const s = useSeen();
  const wide = useWide(WIDE);
  const [soFar, setSoFar] = useState(false);

  useEffect(() => {
    void openSeen(seenKey);
    return () => closeSeen();
  }, [seenKey]);
  // The sidebar folds to its rail here, so the three panels fit.
  useEffect(() => {
    useFrame.setState({ sidebar: "rail" });
  }, []);
  useEffect(() => {
    const was = document.title;
    document.title = `Add screenshots · ${productName} · Qalam`;
    return () => void (document.title = was);
  }, [productName]);

  const input: ReadingInput = { productName, reading: s.view?.reading ?? null, map: s.view?.map ?? null, words: s.view?.words ?? true, adding: s.adding, answers: s.answers, decided: s.decided, error: s.error };
  const messages = useMemo(() => readingThread(input), [JSON.stringify(input)]);
  const steps = readingSteps(input);
  const ask = readingAsk(input);
  const phase = s.view?.reading?.phase;
  const running = phase === "reading" || phase === "placing" || !!s.adding;
  // The review happens on the right: on a narrow window it opens by itself.
  useEffect(() => {
    if (phase === "review") setSoFar(true);
  }, [phase]);

  const crumbs = [
    { label: "Evidence", href: spaceHref(space, "evidence") },
    { label: "What people see", href: seenHref(seenKey) },
    { label: "Add screenshots" },
  ];
  return (
    <PageFrame place="evidence" crumbs={crumbs} space={space} fill>
      <PanelLayout
        left={
          <Panel title="Screenshots" body={false}>
            <StepList
              steps={steps}
              foot={
                phase && phase !== "done" ? (
                  <div className="flex flex-col gap-[4px] p-[8px]">
                    {phase === "asking" && (
                      <button type="button" className={clsx(r.buttonSm, r.buttonGhost, "justify-start")} onClick={() => void sendAnswers(true)}>
                        Stop asking, show what you have
                      </button>
                    )}
                    {phase !== "reading" && phase !== "placing" && (
                      <button type="button" className={clsx(r.buttonSm, r.buttonGhost, "justify-start text-fg-subtle")} onClick={() => void dropReading()}>
                        Leave these out
                      </button>
                    )}
                  </div>
                ) : undefined
              }
            />
          </Panel>
        }
        center={
          <Panel
            label="Qalam AI"
            title={
              <span className="flex items-center gap-[8px]">
                <QalamAIGlyph size={14} /> Qalam AI
              </span>
            }
            actions={
              !wide && (
                <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={() => setSoFar(!soFar)} aria-expanded={soFar}>
                  So far
                </button>
              )
            }
            body={false}
          >
            <div className="min-h-0 flex-1">
              <ChatThread
                messages={messages}
                running={running}
                parts={PARTS}
                footer={
                  <ChatComposer
                    label="Your answer"
                    placeholder={ask.placeholder}
                    submit="enter"
                    disabled={ask.kind === "none"}
                    running={false}
                    draftKey={ask.kind === "answer" ? ask.question : "none"}
                    onSend={(t) => {
                      if (ask.kind !== "answer") return false;
                      answer(ask.question, t);
                      return true;
                    }}
                  />
                }
              />
            </div>
          </Panel>
        }
        right={<FlowsSoFar productName={productName} />}
        rightOpen={soFar}
        onRightOpen={setSoFar}
      />
      <ShotZoom />
    </PageFrame>
  );
}
