export type PortraitTrackpadGesture =
  | { kind: "pan"; deltaX: number; deltaY: number }
  | { kind: "zoom"; factor: number };

export interface PortraitWheelInput {
  deltaX: number;
  deltaY: number;
  /** WheelEvent.DOM_DELTA_PIXEL, LINE, or PAGE as 0, 1, or 2. */
  deltaMode: number;
  /** Chromium and Safari expose trackpad pinch gestures as ctrl+wheel. */
  ctrlKey: boolean;
}

const LINE_PIXELS = 16;
const PINCH_SENSITIVITY = 0.01;
const MIN_EVENT_ZOOM_FACTOR = 0.5;
const MAX_EVENT_ZOOM_FACTOR = 2;

/** Register the wheel handler as non-passive so pinch never zooms the page. */
export function listenForPortraitTrackpad(
  target: HTMLElement,
  handler: (event: WheelEvent) => void,
): () => void {
  target.addEventListener("wheel", handler, { passive: false });
  return () => target.removeEventListener("wheel", handler);
}

function normalizeDelta(value: number, mode: number, pageExtent: number): number {
  if (!Number.isFinite(value)) return 0;
  if (mode === 1) return value * LINE_PIXELS;
  if (mode === 2) return value * Math.max(1, pageExtent);
  return value;
}

/**
 * Map native wheel events to a macOS-style canvas gesture. Ordinary two-finger
 * scrolling pans the document. Browser-native trackpad pinch events zoom.
 */
export function portraitTrackpadGesture(
  input: PortraitWheelInput,
  viewportWidth: number,
  viewportHeight: number,
): PortraitTrackpadGesture {
  const deltaX = normalizeDelta(input.deltaX, input.deltaMode, viewportWidth);
  const deltaY = normalizeDelta(input.deltaY, input.deltaMode, viewportHeight);

  if (input.ctrlKey) {
    const factor = Math.min(
      MAX_EVENT_ZOOM_FACTOR,
      Math.max(
        MIN_EVENT_ZOOM_FACTOR,
        Math.exp(-deltaY * PINCH_SENSITIVITY),
      ),
    );
    return { kind: "zoom", factor };
  }

  return {
    kind: "pan",
    deltaX: deltaX === 0 ? 0 : -deltaX,
    deltaY: deltaY === 0 ? 0 : -deltaY,
  };
}
