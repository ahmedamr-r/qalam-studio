import clsx from "clsx";
import { nanoid } from "nanoid";
import type { Topic } from "@/hub/topics";
import { useOrgContext } from "@/org/context";
import { topicsDb } from "@/org/topics";
import { topicHref } from "@/projects/model";
import { Menu, MenuItem } from "../menu";
import { r } from "../recipes";
import { promptDialog } from "../surfaces/dialog";
import { PageFrame } from "../frame/PageFrame";
import { inScope } from "../home/scope";
import { useScope } from "../home/useScope";
import { TopicsList } from "../org/TopicsList";
import { useOrgData } from "../org/useOrgData";
import { useTopics } from "../topics/list";
import { PlaceHead } from "./PlaceHead";

/** The organization's topic pages (one per need, kind of customer and product), for the product in view. */
export default function TopicsPage() {
  const [scope, setScope] = useScope();
  const { sources, refresh } = useOrgData();
  const topics = useTopics();
  const products = useOrgContext((s) => s.products);
  const product = scope !== "all" && scope !== "org" ? products.find((p) => p.id === scope) : undefined;
  const scopedTopics = topics?.filter((t) => (scope === "all" ? true : scope === "org" ? !t.products.length : t.products.includes(scope))) ?? null;
  const scopedSources = sources.filter((s) => inScope(s.product, scope));

  /** A page started by hand: a need or a kind of customer, for the product in view. */
  const newPage = async (kind: "need" | "segment") => {
    const title = await promptDialog({
      title: kind === "need" ? "New need" : "New segment",
      body: kind === "need" ? "In the customer's words: what they need, struggle with or wish for." : "A kind of customer the team tells apart.",
      label: "Title",
      placeholder: kind === "need" ? "I can't plan my day around the delivery window" : "Parents of young children",
      confirmLabel: "Add page",
      validate: (v) => (v.trim() ? null : "Name it"),
    });
    if (!title) return;
    const now = Date.now();
    const t: Topic = { id: nanoid(10), kind, title: title.trim().replace(/\s+/g, " ").slice(0, 100), products: product ? [product.id] : [], createdAt: now, updatedAt: now, lines: [], history: [] };
    await topicsDb.put(t, null);
    window.location.assign(topicHref(t.id));
  };

  return (
    <PageFrame place="topics" crumbs={[{ label: "Topics" }]} scope={scope} onScope={setScope}>
      <div className={clsx(r.pageMain, "max-w-[880px]")}>
        <PlaceHead title="Topics" count={scopedTopics ? scopedTopics.length : null} scope={scope}>
          <Menu
            label="New page"
            align="end"
            className="w-[180px]"
            trigger={
              <button type="button" className={clsx(r.buttonSm, r.buttonSecondary)}>
                New page
              </button>
            }
          >
            <MenuItem onSelect={() => void newPage("need")}>A need…</MenuItem>
            <MenuItem onSelect={() => void newPage("segment")}>A kind of customer…</MenuItem>
          </Menu>
        </PlaceHead>
        <TopicsList topics={scopedTopics} sources={scopedSources} products={products} onFiled={refresh} />
      </div>
    </PageFrame>
  );
}
