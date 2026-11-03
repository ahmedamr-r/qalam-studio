import clsx from "clsx";
import { Fragment, useState } from "react";
import { mdBlocks, mdInline, quoteItem, type MdBlock, type MdItem } from "./md";

/*
 * Markdown set for reading in a panel: a document's own rhythm rather than a chat's. Sections stand
 * apart, tasks read as tasks, each block finds its own direction, and a run of quotes shows the first
 * few as quotes with where each came from, the rest a click away.
 */

const QUOTES_SHOWN = 3;

function Words({ text }: { text: string }) {
  return (
    <>
      {mdInline(text).map((p, i) => {
        if (p.t === "strong") return <strong key={i} className="font-medium text-fg">{p.v}</strong>;
        if (p.t === "em") return <em key={i}>{p.v}</em>;
        if (p.t === "code") return <code key={i} className="rounded-sm bg-muted px-[4px] py-[1px] font-mono text-caption">{p.v}</code>;
        if (p.t === "link")
          return (
            <a key={i} href={p.href} target="_blank" rel="noreferrer" className="underline decoration-fg/25 underline-offset-2 hover:decoration-fg">
              {p.v}
            </a>
          );
        return <Fragment key={i}>{p.v}</Fragment>;
      })}
    </>
  );
}

function Quotes({ items }: { items: { words: string; from: string }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, QUOTES_SHOWN);
  return (
    <div className="flex flex-col gap-[10px]">
      {shown.map((q, i) => (
        <blockquote key={i} dir="auto" className="flex flex-col gap-[2px] border-s-2 border-line-subtle ps-[10px]">
          <p className="text-body leading-[20px] text-fg">“{q.words}”</p>
          <p className="truncate text-micro text-fg-subtle">
            <Words text={q.from} />
          </p>
        </blockquote>
      ))}
      {items.length > QUOTES_SHOWN && (
        <button type="button" className="self-start text-caption text-fg-muted underline decoration-fg/20 underline-offset-2 hover:text-fg" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show ${items.length - QUOTES_SHOWN} more`}
        </button>
      )}
    </div>
  );
}

function Task({ item }: { item: MdItem }) {
  return (
    <li dir="auto" className="flex items-start gap-[8px] text-body leading-[20px] text-fg">
      <span aria-hidden className={clsx("mt-[3px] grid size-[14px] shrink-0 place-items-center rounded-[3px] text-micro shadow-[inset_0_0_0_1px_var(--color-fg-subtle)]", item.task && "bg-active")}>
        {item.task ? "✓" : ""}
      </span>
      <span className="min-w-0">
        <Words text={item.text} />
      </span>
    </li>
  );
}

function List({ b }: { b: Extract<MdBlock, { t: "list" }> }) {
  const quotes = b.items.map((i) => quoteItem(i.text));
  if (quotes.every(Boolean)) return <Quotes items={quotes as { words: string; from: string }[]} />;
  if (b.items.every((i) => i.task !== undefined))
    return (
      <ul className="flex flex-col gap-[6px]">
        {b.items.map((it, i) => (
          <Task key={i} item={it} />
        ))}
      </ul>
    );
  const Tag = b.ordered ? "ol" : "ul";
  return (
    <Tag className={clsx("flex flex-col gap-[4px] ps-[18px] text-body leading-[20px] text-fg", b.ordered ? "list-decimal" : "list-disc")}>
      {b.items.map((it, i) => (
        <li key={i} dir="auto" className="ps-[2px]">
          <Words text={it.text} />
        </li>
      ))}
    </Tag>
  );
}

/** `hideTitle`: the first heading's already said by what's around it. */
export function Markdown({ text, hideTitle }: { text: string; hideTitle?: boolean }) {
  const blocks = mdBlocks(text);
  const shown = hideTitle && blocks[0]?.t === "heading" ? blocks.slice(1) : blocks;
  return (
    <div className="flex min-w-0 flex-col gap-[12px] break-words">
      {shown.map((b, i) => {
        switch (b.t) {
          case "heading":
            if (b.level <= 2)
              return (
                <h2 key={i} dir="auto" className={clsx("text-heading font-medium text-fg", i > 0 && "mt-[16px] border-t border-line-subtle pt-[20px]")}>
                  <Words text={b.text} />
                </h2>
              );
            return (
              <h3 key={i} dir="auto" className={clsx("text-title font-medium text-fg", i > 0 && "mt-[8px]")}>
                <Words text={b.text} />
              </h3>
            );
          case "p":
            return (
              <p key={i} dir="auto" className="text-body leading-[20px] text-fg-muted">
                <Words text={b.text} />
              </p>
            );
          case "list":
            return <List key={i} b={b} />;
          case "quote":
            return (
              <blockquote key={i} dir="auto" className="border-s-2 border-line-subtle ps-[10px] text-body leading-[20px] text-fg">
                <Words text={b.text} />
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} dir="ltr" className="overflow-x-auto rounded-md bg-muted p-[10px] font-mono text-caption text-fg">
                {b.text}
              </pre>
            );
          case "rule":
            return <hr key={i} className="border-line-subtle" />;
        }
      })}
    </div>
  );
}
