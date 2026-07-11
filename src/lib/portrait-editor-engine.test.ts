import { describe, expect, it } from "vitest";

import {
  PORTRAIT_MAX_GLYPHS,
  PORTRAIT_MAX_LAYERS,
  PORTRAIT_MAX_NAME_LENGTH,
  assertValidPortraitBlueprint,
  packPortraitCell,
  TRANSPARENT_CELL,
} from "./portrait-blueprint";
import {
  PortraitEditorStore,
  type PortraitSelection,
} from "./portrait-editor-engine";

describe("PortraitEditorStore cell history", () => {
  it("surfaces paint through unlocked visible layers and restores them on undo", () => {
    const store = new PortraitEditorStore();
    const snapshot = store.getSnapshot();
    const bottom = snapshot.blueprint.layers[0];
    const top = snapshot.blueprint.layers[1];
    if (!bottom || !top) throw new Error("Expected the default layers");
    const index = 42;
    const topValue = packPortraitCell(5, 160);
    const paintValue = packPortraitCell(1, 238);

    store.setActiveLayer(bottom.id);
    store.applyCellEdits(
      [{ index, value: topValue, layerId: top.id }],
      "Seed covering cell",
    );
    store.applyPaintCellEdits([{ index, value: paintValue }], "Surface paint");

    expect(bottom.cells[index]).toBe(paintValue);
    expect(top.cells[index]).toBe(TRANSPARENT_CELL);
    expect(store.getComposite()[index]).toBe(paintValue);

    expect(store.undo()).toBe(true);
    expect(bottom.cells[index]).toBe(TRANSPARENT_CELL);
    expect(top.cells[index]).toBe(topValue);
    expect(store.getComposite()[index]).toBe(topValue);
  });

  it("records an entire pointer gesture as one undo command", () => {
    const store = new PortraitEditorStore();
    const layerId = store.getSnapshot().activeLayerId;
    const value = packPortraitCell(1, 232);

    store.beginGesture("Marker stroke");
    store.writeCell(10, value);
    store.writeCells([
      { index: 11, value },
      { index: 12, value },
    ]);
    expect(store.commitGesture()).toBe(true);

    expect(store.getDevSnapshot().undoDepth).toBe(1);
    expect(store.getSnapshot().blueprint.layers[0]?.cells[10]).toBe(value);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().blueprint.layers[0]?.cells[10]).toBe(TRANSPARENT_CELL);
    expect(store.getSnapshot().blueprint.layers[0]?.cells[11]).toBe(TRANSPARENT_CELL);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot().blueprint.layers[0]?.cells[12]).toBe(value);
    expect(store.getSnapshot().activeLayerId).toBe(layerId);
  });

  it("reverts cancelled gestures without adding history", () => {
    const store = new PortraitEditorStore();
    store.beginGesture("Cancelled stroke");
    store.writeCell(20, packPortraitCell(2, 180));
    expect(store.cancelGesture()).toBe(true);
    expect(store.getSnapshot().blueprint.layers[0]?.cells[20]).toBe(TRANSPARENT_CELL);
    expect(store.getDevSnapshot().undoDepth).toBe(0);
  });

  it("rejects cells that reference a material outside the document", () => {
    const store = new PortraitEditorStore();
    store.beginGesture();
    expect(() => store.writeCell(0, packPortraitCell(42, 100))).toThrow(
      "unknown material",
    );
    store.cancelGesture();
  });

  it("caches composite cells until the document changes", () => {
    const store = new PortraitEditorStore();
    const first = store.getComposite();
    expect(store.getComposite()).toBe(first);

    store.applyCellEdits([{ index: 3, value: packPortraitCell(3, 90) }]);
    const second = store.getComposite();
    expect(second).not.toBe(first);
    expect(store.getComposite()).toBe(second);
  });
});

describe("PortraitEditorStore document operations", () => {
  it("keeps the pointer anchor fixed while zooming and respects zoom limits", () => {
    const store = new PortraitEditorStore();
    store.zoomAt(2, { x: 100, y: 50 });
    expect(store.getSnapshot().zoom).toBe(2);
    expect(store.getSnapshot().pan).toEqual({ x: -100, y: -50 });

    const localX = (100 - store.getSnapshot().pan.x) / store.getSnapshot().zoom;
    const localY = (50 - store.getSnapshot().pan.y) / store.getSnapshot().zoom;
    expect(localX * store.getSnapshot().zoom + store.getSnapshot().pan.x).toBe(100);
    expect(localY * store.getSnapshot().zoom + store.getSnapshot().pan.y).toBe(50);

    store.zoomAt(100, { x: 100, y: 50 });
    expect(store.getSnapshot().zoom).toBe(16);
    expect(store.getSnapshot().pan).toEqual({ x: -1500, y: -750 });
  });

  it("supports layer creation, duplication, ordering, metadata, and deletion", () => {
    const store = new PortraitEditorStore();
    const added = store.addLayer("Highlights");
    expect(store.renameLayer(added, "Rim light")).toBe(true);
    expect(store.setLayerVisibility(added, false)).toBe(true);
    expect(store.setLayerLocked(added, true)).toBe(true);

    const duplicate = store.duplicateLayer(added);
    expect(duplicate).not.toBeNull();
    if (duplicate === null) return;
    expect(store.reorderLayer(duplicate, 0)).toBe(true);
    expect(store.getSnapshot().blueprint.layers[0]?.id).toBe(duplicate);
    expect(store.renameDocument("Final portrait")).toBe(true);
    expect(store.setSourceImage(null)).toBe(true);
    expect(store.deleteLayer(added)).toBe(true);
    expect(store.getSnapshot().blueprint.metadata).toEqual({
      name: "Final portrait",
      sourceImage: null,
    });
  });

  it("round-trips replacement JSON and resets non-recorded import history", () => {
    const first = new PortraitEditorStore();
    first.applyCellEdits([{ index: 44, value: packPortraitCell(5, 155) }]);
    const json = first.exportJson();

    const second = new PortraitEditorStore();
    second.importJson(json, { recordHistory: false });
    expect(second.getSnapshot().blueprint.layers[0]?.cells[44]).toBe(
      packPortraitCell(5, 155),
    );
    expect(second.getSnapshot().canUndo).toBe(false);
  });

  it("copies selection masks before publishing them", () => {
    const store = new PortraitEditorStore();
    const mask = new Uint8Array(
      store.getSnapshot().blueprint.width * store.getSnapshot().blueprint.height,
    );
    mask[8] = 1;
    const selection: PortraitSelection = {
      kind: "lasso",
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      mask,
    };
    store.setSelection(selection);
    mask[8] = 0;
    expect(store.getSnapshot().selection?.mask?.[8]).toBe(1);
  });

  it("keeps editor mutations inside exported schema limits", () => {
    const store = new PortraitEditorStore();
    while (store.getSnapshot().blueprint.layers.length < PORTRAIT_MAX_LAYERS) {
      expect(store.addLayer()).not.toBe("");
    }
    const activeLayerId = store.getSnapshot().activeLayerId;
    expect(store.addLayer()).toBe("");
    expect(store.duplicateLayer(activeLayerId)).toBeNull();
    expect(store.getSnapshot().blueprint.layers).toHaveLength(PORTRAIT_MAX_LAYERS);

    expect(store.renameDocument("x".repeat(PORTRAIT_MAX_NAME_LENGTH + 1))).toBe(false);
    expect(store.renameLayer(activeLayerId, "x".repeat(PORTRAIT_MAX_NAME_LENGTH + 1))).toBe(false);
    expect(store.setSourceImage("x".repeat(2049))).toBe(false);
    expect(
      store.updateMaterial(1, { glyphs: "@".repeat(PORTRAIT_MAX_GLYPHS + 1) }),
    ).toBe(false);
    expect(() => assertValidPortraitBlueprint(store.getSnapshot().blueprint)).not.toThrow();
  });
});
