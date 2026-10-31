import type { Goal } from "@/goals/types";
import type { Project } from "@/projects/model";
import { inSpace, type Space } from "@/ui/frame/spaces";

/*
 * The boards a space's canvas holds (pure): the boards for the space's product (every board in the
 * organization's space), and the boards its goals are worked on, which may be another product's or
 * the organization's (shown in part: only that goal's tree). The window and the server read the
 * same list, so a space loads what it shows.
 */

export function boardsInSpace(projects: readonly Pick<Project, "id" | "type" | "product">[], goals: readonly Pick<Goal, "product" | "on">[], space: Space): string[] {
  const boards = projects.filter((p) => p.type === "discovery");
  const ids = new Set(boards.filter((p) => inSpace(p.product ?? null, space)).map((p) => p.id));
  const known = new Set(boards.map((p) => p.id));
  for (const g of goals) if (g.on && known.has(g.on.board) && inSpace(g.product, space)) ids.add(g.on.board);
  return boards.filter((p) => ids.has(p.id)).map((p) => p.id);
}
