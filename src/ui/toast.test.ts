import { describe, expect, it } from "vitest";
import { MAX_TOASTS, SWIPE_DISMISS, closeToast, pushToast, removeToast, stackDepths, swipeOutcome, toastDuration, type ToastItem } from "./toast";

const f = (message: string, id = message, kind: "info" | "success" | "error" = "info") => ({ message, id, kind });

describe("toast queue", () => {
  it("replaces an open toast with the same id in place", () => {
    let l: ToastItem[] = [];
    l = pushToast(l, f("Opacity 40%", "opacity"), 1);
    l = pushToast(l, f("Opacity 45%", "opacity"), 2);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ key: 1, message: "Opacity 45%", rev: 1, open: true });
  });

  it("keeps one HUD slot for info messages", () => {
    let l = pushToast([], f("Rulers on", "view.rulers"), 1);
    l = pushToast(l, f("Outlines on", "view.outlines"), 2);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ key: 1, id: "view.outlines", message: "Outlines on" });
    l = pushToast(l, f("Copied as PNG", "edit.copy-png", "success"), 3);
    expect(l.map((t) => t.key)).toEqual([3, 1]);
  });

  it("stacks new ids in front and closes the overflow", () => {
    let l: ToastItem[] = [];
    for (let i = 1; i <= MAX_TOASTS + 1; i++) l = pushToast(l, f(`m${i}`, `m${i}`, "success"), i);
    expect(l.map((t) => t.key)).toEqual([4, 3, 2, 1]);
    expect(l.filter((t) => t.open)).toHaveLength(MAX_TOASTS);
    expect(l.find((t) => t.key === 1)?.open).toBe(false);
  });

  it("does not revive a closing toast with the same id", () => {
    let l = pushToast([], f("Saved"), 1);
    l = closeToast(l, 1);
    l = pushToast(l, f("Saved"), 2);
    expect(l.map((t) => [t.key, t.open])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(removeToast(l, 1).map((t) => t.key)).toEqual([2]);
  });

  it("gives open toasts consecutive depths", () => {
    let l: ToastItem[] = [];
    for (let i = 1; i <= 3; i++) l = pushToast(l, f(`m${i}`, `m${i}`, "success"), i);
    l = closeToast(l, 2);
    const d = stackDepths(l);
    expect([d.get(3), d.get(2), d.get(1)]).toEqual([0, 1, 1]);
  });

  it("keeps errors up longest", () => {
    expect(toastDuration(f("x", "x", "error"))).toBeGreaterThan(toastDuration(f("x", "x", "success")));
    expect(toastDuration(f("Rulers on"))).toBeLessThan(2000);
  });
});

describe("toast swipe", () => {
  it("dismisses past the threshold in either direction and springs back short of it", () => {
    expect(swipeOutcome(SWIPE_DISMISS)).toBe("end");
    expect(swipeOutcome(-SWIPE_DISMISS - 10)).toBe("end");
    expect(swipeOutcome(SWIPE_DISMISS - 1)).toBe("cancel");
    expect(swipeOutcome(-12)).toBe("cancel");
  });
});
