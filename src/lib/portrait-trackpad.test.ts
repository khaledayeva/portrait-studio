import { describe, expect, it, vi } from "vitest";
import {
  listenForPortraitTrackpad,
  portraitTrackpadGesture,
} from "./portrait-trackpad";

describe("portrait trackpad gestures", () => {
  it("maps two-finger vertical and horizontal scrolling to canvas panning", () => {
    expect(
      portraitTrackpadGesture(
        { deltaX: 18, deltaY: -32, deltaMode: 0, ctrlKey: false },
        800,
        600,
      ),
    ).toEqual({ kind: "pan", deltaX: -18, deltaY: 32 });
  });

  it("normalizes line and page wheel deltas", () => {
    expect(
      portraitTrackpadGesture(
        { deltaX: 2, deltaY: 3, deltaMode: 1, ctrlKey: false },
        800,
        600,
      ),
    ).toEqual({ kind: "pan", deltaX: -32, deltaY: -48 });
    expect(
      portraitTrackpadGesture(
        { deltaX: 0, deltaY: -1, deltaMode: 2, ctrlKey: false },
        800,
        600,
      ),
    ).toEqual({ kind: "pan", deltaX: 0, deltaY: 600 });
  });

  it("zooms out for pinch-in and in for pinch-expand without panning", () => {
    const pinchIn = portraitTrackpadGesture(
      { deltaX: 12, deltaY: 20, deltaMode: 0, ctrlKey: true },
      800,
      600,
    );
    const pinchExpand = portraitTrackpadGesture(
      { deltaX: -12, deltaY: -20, deltaMode: 0, ctrlKey: true },
      800,
      600,
    );
    expect(pinchIn.kind).toBe("zoom");
    expect(pinchExpand.kind).toBe("zoom");
    if (pinchIn.kind === "zoom" && pinchExpand.kind === "zoom") {
      expect(pinchIn.factor).toBeLessThan(1);
      expect(pinchExpand.factor).toBeGreaterThan(1);
    }
  });

  it("owns wheel events with a non-passive listener and cleans it up", () => {
    const stage = document.createElement("div");
    const addListener = vi.spyOn(stage, "addEventListener");
    const removeListener = vi.spyOn(stage, "removeEventListener");
    const handler = vi.fn((event: WheelEvent) => event.preventDefault());
    const stopListening = listenForPortraitTrackpad(stage, handler);

    expect(addListener).toHaveBeenCalledWith("wheel", handler, {
      passive: false,
    });
    const wheel = new WheelEvent("wheel", { cancelable: true });
    stage.dispatchEvent(wheel);
    expect(handler).toHaveBeenCalledOnce();
    expect(wheel.defaultPrevented).toBe(true);

    stopListening();
    expect(removeListener).toHaveBeenCalledWith("wheel", handler);
    stage.dispatchEvent(new WheelEvent("wheel", { cancelable: true }));
    expect(handler).toHaveBeenCalledOnce();
  });
});
