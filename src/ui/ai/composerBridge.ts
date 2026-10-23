import { useStudio } from "@/doc/store";

/**
 * Ways into the chat composer from elsewhere in the studio, while it's mounted (the chat may only
 * just be opening): example briefs, and a screenshot to add as a component.
 */

function bridge<T extends unknown[]>() {
  let setter: ((...args: T) => void) | null = null;
  return { set: (...args: T) => setter?.(...args), bind: (fn: ((...args: T) => void) | null) => void (setter = fn), ready: () => setter !== null };
}

/** Text the composer's box takes (example briefs, a request drafted for the designer to send). */
export const composerDraft = bridge<[text: string]>();

/** A screenshot for Add component, to join this system (the library's own, when started there). */
export const composerAttach = bridge<[file: File, systemId?: string]>();

/**
 * Open the chat on Add component with this screenshot attached (from the component library or
 * Assets): the designer can name it or say what changes from one use to the next, then send.
 */
export function attachComponentShot(file: File, systemId?: string) {
  useStudio.getState().setAITab("component");
  // The chat mounts the composer when it opens.
  let tries = 0;
  const deliver = () => {
    if (composerAttach.ready()) composerAttach.set(file, systemId);
    else if (tries++ < 50) setTimeout(deliver, 30);
  };
  deliver();
}
