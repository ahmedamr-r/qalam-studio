import type { Controller } from "@/engine/controller";

/**
 * The mounted canvas, for commands that move the camera or read the pointer. The controller
 * registers itself while it lives; commands that need it are disabled without one.
 */
let current: Controller | null = null;

export const setCommandCanvas = (c: Controller | null) => void (current = c);
export const commandCanvas = (): Controller | null => current;
