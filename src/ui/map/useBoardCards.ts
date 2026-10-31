import { useEffect, useState } from "react";
import type { MapBoard } from "@/discovery/board-cards";
import { orgJson } from "@/org/client";
import { onOrgChange } from "@/org/live";

/**
 * Every board's cards, for the space's map (null while loading): read again when a board changes,
 * here or elsewhere, once things settle.
 */
export function useBoardCards(): MapBoard[] | null {
  const [boards, setBoards] = useState<MapBoard[] | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void orgJson<MapBoard[]>("/boards/cards").then(
        (b) => alive && setBoards(b),
        () => alive && setBoards((b) => b ?? []),
      );
    load();
    const off = onOrgChange((c) => {
      if (c.kind !== "project") return;
      clearTimeout(timer);
      timer = setTimeout(load, 600);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      off();
    };
  }, []);
  return boards;
}
