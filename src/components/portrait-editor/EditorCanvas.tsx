"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CUTOUT_CELL,
  TRANSPARENT_CELL,
  packPortraitCell,
  portraitCellIntensity,
  portraitCellMaterialId,
} from "@/lib/portrait-blueprint";
import type {
  PortraitEditorSnapshot,
  PortraitEditorStore,
  PortraitEditorTool,
} from "@/lib/portrait-editor-engine";
import {
  floodFill4,
  polygonLassoMask,
  rasterBrushEdits,
  rasterBrushLine,
  rasterEllipse,
  rasterRectangle,
  type RasterPoint,
} from "@/lib/portrait-raster";
import {
  materialMap,
  portraitGlyphForCell,
} from "@/lib/portrait-sampling";
import {
  createPortraitRuntimeGrid,
  portraitRuntimeAppearance,
  portraitRuntimeLayout,
} from "@/lib/portrait-runtime";
import {
  listenForPortraitTrackpad,
  portraitTrackpadGesture,
} from "@/lib/portrait-trackpad";
import styles from "./PortraitEditor.module.css";

const MASTER_CELL_PIXELS = 4;

interface EditorCanvasProps {
  store: PortraitEditorStore;
  snapshot: PortraitEditorSnapshot;
  referenceSrc: string;
  onCursorChange?: (position: RasterPoint | null) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

interface PointerGesture {
  tool: PortraitEditorTool;
  start: RasterPoint;
  last: RasterPoint;
  points: RasterPoint[];
  clientX: number;
  clientY: number;
  panX: number;
  panY: number;
  movingSelection?: boolean;
  compositeErase?: boolean;
}

function samePoint(a: RasterPoint, b: RasterPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toolCursor(tool: PortraitEditorTool): string {
  if (tool === "hand") return "grab";
  if (tool === "eyedropper") return "copy";
  if (tool === "select" || tool === "lasso") return "default";
  return "crosshair";
}

function rasterForShape(
  tool: PortraitEditorTool,
  width: number,
  height: number,
  start: RasterPoint,
  end: RasterPoint,
  value: number,
  fillMode: PortraitEditorSnapshot["shapeFillMode"],
  brushSize: number,
): Uint16Array {
  const empty = new Uint16Array(width * height);
  if (tool === "line") {
    return rasterBrushLine(empty, width, height, start, end, value, {
      radius: Math.max(0, (brushSize - 1) / 2),
      hardness: 1,
      density: 1,
    });
  }
  const filled = fillMode !== "stroke";
  const shape =
    tool === "rectangle"
      ? rasterRectangle(empty, width, height, start, end, value, { fill: filled })
      : tool === "ellipse"
        ? rasterEllipse(empty, width, height, start, end, value, { fill: filled })
        : empty;
  if (fillMode !== "both") return shape;

  const materialId = portraitCellMaterialId(value);
  const outlineValue =
    value === TRANSPARENT_CELL || value === CUTOUT_CELL
      ? value
      : packPortraitCell(materialId, 255);
  const outline =
    tool === "rectangle"
      ? rasterRectangle(empty, width, height, start, end, outlineValue, {
          fill: false,
        })
      : rasterEllipse(empty, width, height, start, end, outlineValue, {
          fill: false,
        });
  for (let index = 0; index < outline.length; index++) {
    if (outline[index] !== TRANSPARENT_CELL) shape[index] = outline[index];
  }
  return shape;
}

function boundsFromPoints(points: readonly RasterPoint[]) {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function selectionIncludesPoint(
  selection: NonNullable<PortraitEditorSnapshot["selection"]>,
  point: RasterPoint,
  width: number,
) {
  if (selection.mask) return selection.mask[point.y * width + point.x] !== 0;
  return (
    point.x >= selection.x &&
    point.x < selection.x + selection.width &&
    point.y >= selection.y &&
    point.y < selection.y + selection.height
  );
}

export default function EditorCanvas({
  store,
  snapshot,
  referenceSrc,
  onCursorChange,
  onCanvasReady,
}: EditorCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<PointerGesture | null>(null);
  const hoverRef = useRef<RasterPoint | null>(null);
  const keyboardAnchorRef = useRef<RasterPoint | null>(null);
  const animationFrameRef = useRef(0);
  const gesturePreviewFrameRef = useRef<number | null>(null);
  const sampledCacheRef = useRef<{
    documentRevision: number;
    columns: number;
    rows: number;
    cells: Uint16Array;
  } | null>(null);
  const [overlayRevision, setOverlayRevision] = useState(0);
  const [runtimeViewport, setRuntimeViewport] = useState({
    width: 1280,
    height: 1200,
  });
  const materialsById = useMemo(
    () => materialMap(snapshot.blueprint.materials),
    [snapshot.blueprint.materials],
  );
  const runtimeGridLayout = useMemo(
    () => portraitRuntimeLayout(runtimeViewport.width, runtimeViewport.height),
    [runtimeViewport.height, runtimeViewport.width],
  );
  const canvasRevision = snapshot.isGesturing
    ? snapshot.revision
    : snapshot.documentRevision;

  useEffect(() => {
    const syncViewport = () => {
      setRuntimeViewport({
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight),
      });
    };
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  const pointFromEvent = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): RasterPoint | null => {
      const canvas = overlayRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const x = Math.floor(
        ((event.clientX - rect.left) / rect.width) * snapshot.blueprint.width,
      );
      const y = Math.floor(
        ((event.clientY - rect.top) / rect.height) * snapshot.blueprint.height,
      );
      if (
        x < 0 ||
        x >= snapshot.blueprint.width ||
        y < 0 ||
        y >= snapshot.blueprint.height
      ) {
        return null;
      }
      return { x, y };
    },
    [snapshot.blueprint.height, snapshot.blueprint.width],
  );

  const writeBrushSegment = useCallback(
    (
      start: RasterPoint,
      end: RasterPoint,
      erasing: boolean,
      compositeErase = false,
    ) => {
      const { width, height } = snapshot.blueprint;
      const rasterValue = erasing ? CUTOUT_CELL : store.getPaintCellValue();
      const footprint = rasterBrushEdits(
        width,
        height,
        start,
        end,
        rasterValue,
        {
          radius: Math.max(0, (snapshot.brush.size - 1) / 2),
          density: snapshot.brush.density,
          hardness: snapshot.brush.hardness,
          seed: snapshot.documentRevision + 41,
        },
      );
      const edits = footprint.map((edit) => ({
        index: edit.index,
        value: erasing
          ? compositeErase
            ? CUTOUT_CELL
            : TRANSPARENT_CELL
          : edit.value,
      }));
      if (!erasing || compositeErase) {
        store.writePaintCells(edits);
      } else {
        store.writeCells(edits);
      }
      if (gesturePreviewFrameRef.current === null) {
        gesturePreviewFrameRef.current = window.requestAnimationFrame(() => {
          gesturePreviewFrameRef.current = null;
          store.refreshGesturePreview();
        });
      }
    },
    [snapshot.blueprint, snapshot.brush, snapshot.documentRevision, store],
  );

  const commitShape = useCallback(
    (gesture: PointerGesture, end: RasterPoint) => {
      const { width, height } = snapshot.blueprint;
      const raster = rasterForShape(
        gesture.tool,
        width,
        height,
        gesture.start,
        end,
        store.getPaintCellValue(),
        snapshot.shapeFillMode,
        snapshot.brush.size,
      );
      const edits = [];
      for (let index = 0; index < raster.length; index++) {
        if (raster[index] !== TRANSPARENT_CELL) {
          edits.push({ index, value: raster[index] });
        }
      }
      store.applyPaintCellEdits(edits, `Draw ${gesture.tool}`);
    },
    [snapshot.blueprint, snapshot.brush.size, snapshot.shapeFillMode, store],
  );

  const applyFill = useCallback(
    (point: RasterPoint) => {
      const layer = snapshot.blueprint.layers.find(
        (candidate) => candidate.id === snapshot.activeLayerId,
      );
      if (!layer || layer.locked) return;
      const next = floodFill4(
        layer.cells,
        snapshot.blueprint.width,
        snapshot.blueprint.height,
        point,
        store.getPaintCellValue(),
      );
      const edits = [];
      for (let index = 0; index < next.length; index++) {
        if (next[index] !== layer.cells[index]) {
          edits.push({ index, value: next[index] });
        }
      }
      store.applyPaintCellEdits(edits, "Fill region");
    },
    [snapshot.activeLayerId, snapshot.blueprint, store],
  );

  const finishSelection = useCallback(
    (gesture: PointerGesture, end: RasterPoint) => {
      if (gesture.tool === "lasso") {
        const points = gesture.points.length >= 3 ? gesture.points : [gesture.start, end];
        const mask = polygonLassoMask(
          snapshot.blueprint.width,
          snapshot.blueprint.height,
          points,
        );
        store.setSelection({
          kind: "lasso",
          ...boundsFromPoints(points),
          mask,
        });
        return;
      }
      const x = Math.min(gesture.start.x, end.x);
      const y = Math.min(gesture.start.y, end.y);
      store.setSelection({
        kind: "rectangle",
        x,
        y,
        width: Math.abs(end.x - gesture.start.x) + 1,
        height: Math.abs(end.y - gesture.start.y) + 1,
      });
    },
    [snapshot.blueprint.height, snapshot.blueprint.width, store],
  );

  const moveSelection = useCallback(
    (gesture: PointerGesture, end: RasterPoint) => {
      const selection = snapshot.selection;
      const layer = snapshot.blueprint.layers.find(
        (candidate) => candidate.id === snapshot.activeLayerId,
      );
      if (!selection || !layer || layer.locked) return;
      const deltaX = end.x - gesture.start.x;
      const deltaY = end.y - gesture.start.y;
      if (deltaX === 0 && deltaY === 0) return;

      const source = new Uint16Array(layer.cells);
      const selected: number[] = [];
      for (let y = 0; y < snapshot.blueprint.height; y++) {
        for (let x = 0; x < snapshot.blueprint.width; x++) {
          if (selectionIncludesPoint(selection, { x, y }, snapshot.blueprint.width)) {
            selected.push(y * snapshot.blueprint.width + x);
          }
        }
      }
      const edits = selected.map((index) => ({ index, value: TRANSPARENT_CELL }));
      for (const index of selected) {
        const value = source[index];
        if (value === TRANSPARENT_CELL) continue;
        const x = index % snapshot.blueprint.width;
        const y = Math.floor(index / snapshot.blueprint.width);
        const targetX = x + deltaX;
        const targetY = y + deltaY;
        if (
          targetX < 0 ||
          targetX >= snapshot.blueprint.width ||
          targetY < 0 ||
          targetY >= snapshot.blueprint.height
        ) {
          continue;
        }
        edits.push({
          index: targetY * snapshot.blueprint.width + targetX,
          value,
        });
      }
      store.applyCellEdits(edits, "Move selection");
      let movedMask: Uint8Array | undefined;
      if (selection.mask) {
        movedMask = new Uint8Array(selection.mask.length);
        for (let y = 0; y < snapshot.blueprint.height; y++) {
          for (let x = 0; x < snapshot.blueprint.width; x++) {
            if (!selection.mask[y * snapshot.blueprint.width + x]) continue;
            const targetX = x + deltaX;
            const targetY = y + deltaY;
            if (
              targetX >= 0 &&
              targetX < snapshot.blueprint.width &&
              targetY >= 0 &&
              targetY < snapshot.blueprint.height
            ) {
              movedMask[targetY * snapshot.blueprint.width + targetX] = 1;
            }
          }
        }
      }
      store.setSelection({
        ...selection,
        x: selection.x + deltaX,
        y: selection.y + deltaY,
        mask: movedMask,
      });
    },
    [snapshot.activeLayerId, snapshot.blueprint, snapshot.selection, store],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      const point = pointFromEvent(event);
      if (!point) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const gesture: PointerGesture = {
        tool: snapshot.activeTool,
        start: point,
        last: point,
        points: [point],
        clientX: event.clientX,
        clientY: event.clientY,
        panX: snapshot.pan.x,
        panY: snapshot.pan.y,
        movingSelection:
          snapshot.activeTool === "select" &&
          snapshot.selection !== null &&
          selectionIncludesPoint(snapshot.selection, point, snapshot.blueprint.width),
        compositeErase: snapshot.activeTool === "eraser" && event.altKey,
      };
      gestureRef.current = gesture;
      hoverRef.current = point;
      onCursorChange?.(point);

      if (snapshot.activeTool === "brush" || snapshot.activeTool === "eraser") {
        store.beginGesture(snapshot.activeTool === "eraser" ? "Erase stroke" : "Brush stroke");
        writeBrushSegment(
          point,
          point,
          snapshot.activeTool === "eraser",
          gesture.compositeErase,
        );
      } else if (snapshot.activeTool === "fill") {
        applyFill(point);
        gestureRef.current = null;
      } else if (snapshot.activeTool === "eyedropper") {
        const index = point.y * snapshot.blueprint.width + point.x;
        const materialId = portraitCellMaterialId(store.getComposite()[index]);
        if (materialId > 0) {
          store.setActiveMaterial(materialId);
          store.setActiveTool("brush");
        }
        gestureRef.current = null;
      }
      setOverlayRevision((value) => value + 1);
    },
    [
      applyFill,
      onCursorChange,
      pointFromEvent,
      snapshot.activeTool,
      snapshot.blueprint.width,
      snapshot.pan.x,
      snapshot.pan.y,
      snapshot.selection,
      store,
      writeBrushSegment,
    ],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = pointFromEvent(event);
      hoverRef.current = point;
      onCursorChange?.(point);
      const gesture = gestureRef.current;
      if (!gesture) {
        setOverlayRevision((value) => value + 1);
        return;
      }

      if (gesture.tool === "hand") {
        store.setPan({
          x: gesture.panX + event.clientX - gesture.clientX,
          y: gesture.panY + event.clientY - gesture.clientY,
        });
        return;
      }
      if (!point) return;
      if ((gesture.tool === "brush" || gesture.tool === "eraser") && !samePoint(point, gesture.last)) {
        writeBrushSegment(
          gesture.last,
          point,
          gesture.tool === "eraser",
          gesture.compositeErase,
        );
      }
      if (gesture.tool === "lasso" && !samePoint(point, gesture.last)) {
        gesture.points.push(point);
      }
      gesture.last = point;
      setOverlayRevision((value) => value + 1);
    },
    [onCursorChange, pointFromEvent, store, writeBrushSegment],
  );

  const finishPointerGesture = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const point = pointFromEvent(event) ?? gesture.last;
      if (gesture.tool === "brush" || gesture.tool === "eraser") {
        store.commitGesture();
      } else if (["line", "rectangle", "ellipse"].includes(gesture.tool)) {
        commitShape(gesture, point);
      } else if (gesture.tool === "select" && gesture.movingSelection) {
        moveSelection(gesture, point);
      } else if (gesture.tool === "select" || gesture.tool === "lasso") {
        finishSelection(gesture, point);
      }
      gestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setOverlayRevision((value) => value + 1);
    },
    [commitShape, finishSelection, moveSelection, pointFromEvent, store],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (snapshot.isGesturing) store.cancelGesture();
      gestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setOverlayRevision((value) => value + 1);
    },
    [snapshot.isGesturing, store],
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      const viewportElement = stageRef.current;
      if (!viewportElement) return;
      event.preventDefault();
      const viewport = viewportElement.getBoundingClientRect();
      const gesture = portraitTrackpadGesture(
        event,
        viewport.width,
        viewport.height,
      );
      if (gesture.kind === "pan") {
        store.panBy(gesture.deltaX, gesture.deltaY);
        return;
      }
      store.zoomAt(gesture.factor, {
        x: event.clientX - (viewport.left + viewport.width / 2),
        y: event.clientY - (viewport.top + viewport.height / 2),
      });
    },
    [store],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    return listenForPortraitTrackpad(stage, handleWheel);
  }, [handleWheel]);

  const handleCanvasKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
      const { width, height } = snapshot.blueprint;
      const current = hoverRef.current ?? {
        x: Math.floor(width / 2),
        y: Math.floor(height / 2),
      };
      const step = event.shiftKey ? 10 : 1;
      const movement: Record<string, RasterPoint> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      };
      const delta = movement[event.key];
      if (delta) {
        event.preventDefault();
        event.stopPropagation();
        if (snapshot.activeTool === "hand") {
          store.panBy(-delta.x * 8, -delta.y * 8);
          return;
        }
        hoverRef.current = {
          x: clamp(current.x + delta.x, 0, width - 1),
          y: clamp(current.y + delta.y, 0, height - 1),
        };
        onCursorChange?.(hoverRef.current);
        setOverlayRevision((value) => value + 1);
        return;
      }
      if (event.key === "Escape") {
        keyboardAnchorRef.current = null;
        store.clearSelection();
        setOverlayRevision((value) => value + 1);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();

      if (snapshot.activeTool === "brush" || snapshot.activeTool === "eraser") {
        store.beginGesture(
          snapshot.activeTool === "eraser" ? "Keyboard erase" : "Keyboard brush",
        );
        writeBrushSegment(
          current,
          current,
          snapshot.activeTool === "eraser",
          event.altKey,
        );
        store.commitGesture();
        return;
      }
      if (snapshot.activeTool === "fill") {
        applyFill(current);
        return;
      }
      if (snapshot.activeTool === "eyedropper") {
        const index = current.y * width + current.x;
        const materialId = portraitCellMaterialId(store.getComposite()[index]);
        if (materialId > 0) store.setActiveMaterial(materialId);
        return;
      }
      if (
        snapshot.activeTool === "line" ||
        snapshot.activeTool === "rectangle" ||
        snapshot.activeTool === "ellipse" ||
        snapshot.activeTool === "select" ||
        snapshot.activeTool === "lasso"
      ) {
        const anchor = keyboardAnchorRef.current;
        if (!anchor) {
          keyboardAnchorRef.current = current;
          setOverlayRevision((value) => value + 1);
          return;
        }
        const gesture: PointerGesture = {
          tool: snapshot.activeTool,
          start: anchor,
          last: current,
          points:
            snapshot.activeTool === "lasso"
              ? [
                  anchor,
                  { x: current.x, y: anchor.y },
                  current,
                  { x: anchor.x, y: current.y },
                ]
              : [anchor, current],
          clientX: 0,
          clientY: 0,
          panX: snapshot.pan.x,
          panY: snapshot.pan.y,
        };
        if (["line", "rectangle", "ellipse"].includes(snapshot.activeTool)) {
          commitShape(gesture, current);
        } else {
          finishSelection(gesture, current);
        }
        keyboardAnchorRef.current = null;
        setOverlayRevision((value) => value + 1);
      }
    },
    [
      applyFill,
      commitShape,
      finishSelection,
      onCursorChange,
      snapshot.activeTool,
      snapshot.blueprint,
      snapshot.pan.x,
      snapshot.pan.y,
      store,
      writeBrushSegment,
    ],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onCanvasReady?.(canvas);
    const { width, height } = snapshot.blueprint;
    canvas.width = width * MASTER_CELL_PIXELS;
    canvas.height = height * MASTER_CELL_PIXELS;
    const context = canvas.getContext("2d");
    if (!context) return;

    const drawBlueprint = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      const composite = store.getComposite();
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `${MASTER_CELL_PIXELS}px var(--font-geist-mono), monospace`;
      for (let index = 0; index < composite.length; index++) {
        const cell = composite[index];
        if (cell === TRANSPARENT_CELL || cell === CUTOUT_CELL) continue;
        const material = materialsById.get(portraitCellMaterialId(cell));
        if (!material) continue;
        const x = index % width;
        const y = Math.floor(index / width);
        const intensity = portraitCellIntensity(cell) / 255;
        context.fillStyle = `rgba(244,244,240,${0.16 + intensity * 0.84})`;
        const glyph = portraitGlyphForCell(cell, material, index, 0);
        context.fillText(
          glyph,
          x * MASTER_CELL_PIXELS + MASTER_CELL_PIXELS / 2,
          y * MASTER_CELL_PIXELS + MASTER_CELL_PIXELS / 2 + 0.25,
        );
      }

      if (snapshot.gridVisible) {
        context.save();
        context.lineWidth = 1;
        for (let x = 0; x <= width; x += 4) {
          context.strokeStyle = x % 16 === 0 ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.045)";
          context.beginPath();
          context.moveTo(x * MASTER_CELL_PIXELS + 0.5, 0);
          context.lineTo(x * MASTER_CELL_PIXELS + 0.5, canvas.height);
          context.stroke();
        }
        for (let y = 0; y <= height; y += 4) {
          context.strokeStyle = y % 16 === 0 ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.045)";
          context.beginPath();
          context.moveTo(0, y * MASTER_CELL_PIXELS + 0.5);
          context.lineTo(canvas.width, y * MASTER_CELL_PIXELS + 0.5);
          context.stroke();
        }
        context.restore();
      }
    };

    const drawAnimated = (timeMs: number, animated: boolean) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      const animatedColumns = runtimeGridLayout.portraitColumns;
      const animatedRows = runtimeGridLayout.portraitRows;
      if (
        sampledCacheRef.current === null ||
        sampledCacheRef.current.documentRevision !== snapshot.documentRevision ||
        sampledCacheRef.current.columns !== animatedColumns ||
        sampledCacheRef.current.rows !== animatedRows
      ) {
        sampledCacheRef.current = {
          documentRevision: snapshot.documentRevision,
          columns: animatedColumns,
          rows: animatedRows,
          cells: createPortraitRuntimeGrid(snapshot.blueprint, runtimeGridLayout),
        };
      }
      const sampled = sampledCacheRef.current.cells;
      const cellWidth = canvas.width / animatedColumns;
      const cellHeight = canvas.height / animatedRows;
      const cellSize = Math.min(cellWidth, cellHeight);
      context.textAlign = "center";
      context.textBaseline = "middle";
      let currentFontSize = -1;
      for (let index = 0; index < sampled.length; index++) {
        const cell = sampled[index];
        if (cell === TRANSPARENT_CELL || cell === CUTOUT_CELL) continue;
        const material = materialsById.get(portraitCellMaterialId(cell));
        if (!material) continue;
        const column = index % animatedColumns;
        const row = Math.floor(index / animatedColumns);
        const appearance = portraitRuntimeAppearance(
          cell,
          material,
          index,
          timeMs,
          (column + 0.5) / animatedColumns,
          (row + 0.5) / animatedRows,
          cellSize,
          animated,
        );
        const fontSize = Math.max(1, Math.round(cellSize * appearance.scale * 100) / 100);
        if (fontSize !== currentFontSize) {
          currentFontSize = fontSize;
          context.font = `500 ${fontSize}px var(--font-geist-mono), monospace`;
        }
        context.fillStyle = `rgba(244,244,240,${appearance.alpha})`;
        context.fillText(
          appearance.glyph,
          (column + 0.5) * cellWidth + appearance.offsetX,
          (row + 0.5) * cellHeight + appearance.offsetY,
        );
      }
    };

    if (snapshot.previewMode === "blueprint") {
      drawBlueprint();
      return () => {
        onCanvasReady?.(null);
      };
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!snapshot.flickerEnabled || reducedMotion) {
      drawAnimated(0, false);
      return () => {
        onCanvasReady?.(null);
      };
    }

    let request = 0;
    let previous = 0;
    const animate = (time: number) => {
      if (time - previous >= 1000 / 12) {
        previous = time;
        animationFrameRef.current = time;
        drawAnimated(time, true);
      }
      request = requestAnimationFrame(animate);
    };
    drawAnimated(performance.now(), true);
    request = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(request);
      onCanvasReady?.(null);
    };
  }, [
    canvasRevision,
    materialsById,
    onCanvasReady,
    snapshot.blueprint,
    snapshot.documentRevision,
    snapshot.flickerEnabled,
    snapshot.gridVisible,
    snapshot.previewMode,
    runtimeGridLayout,
    store,
  ]);

  useEffect(
    () => () => {
      if (gesturePreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(gesturePreviewFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const { width, height } = snapshot.blueprint;
    canvas.width = width * MASTER_CELL_PIXELS;
    canvas.height = height * MASTER_CELL_PIXELS;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 1.5;
    context.strokeStyle = "rgba(255,255,255,.96)";

    const selection = snapshot.selection;
    if (selection) {
      context.save();
      context.setLineDash([5, 4]);
      context.strokeRect(
        selection.x * MASTER_CELL_PIXELS + 0.75,
        selection.y * MASTER_CELL_PIXELS + 0.75,
        selection.width * MASTER_CELL_PIXELS - 1.5,
        selection.height * MASTER_CELL_PIXELS - 1.5,
      );
      context.restore();
    }

    const gesture = gestureRef.current;
    if (gesture && ["line", "rectangle", "ellipse"].includes(gesture.tool)) {
      const raster = rasterForShape(
        gesture.tool,
        width,
        height,
        gesture.start,
        gesture.last,
        CUTOUT_CELL,
        snapshot.shapeFillMode,
        snapshot.brush.size,
      );
      context.fillStyle = "rgba(255,255,255,.46)";
      for (let index = 0; index < raster.length; index++) {
        if (raster[index] === TRANSPARENT_CELL) continue;
        const x = index % width;
        const y = Math.floor(index / width);
        context.fillRect(
          x * MASTER_CELL_PIXELS,
          y * MASTER_CELL_PIXELS,
          MASTER_CELL_PIXELS,
          MASTER_CELL_PIXELS,
        );
      }
    }

    if (gesture?.tool === "select" && !gesture.movingSelection) {
      context.save();
      context.setLineDash([5, 4]);
      const x = Math.min(gesture.start.x, gesture.last.x) * MASTER_CELL_PIXELS;
      const y = Math.min(gesture.start.y, gesture.last.y) * MASTER_CELL_PIXELS;
      const selectionWidth = (Math.abs(gesture.start.x - gesture.last.x) + 1) * MASTER_CELL_PIXELS;
      const selectionHeight = (Math.abs(gesture.start.y - gesture.last.y) + 1) * MASTER_CELL_PIXELS;
      context.strokeRect(x + 0.75, y + 0.75, selectionWidth - 1.5, selectionHeight - 1.5);
      context.restore();
    }

    if (gesture?.tool === "lasso" && gesture.points.length > 1) {
      context.beginPath();
      gesture.points.forEach((point, index) => {
        const x = (point.x + 0.5) * MASTER_CELL_PIXELS;
        const y = (point.y + 0.5) * MASTER_CELL_PIXELS;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }

    const hover = hoverRef.current;
    if (hover && (snapshot.activeTool === "brush" || snapshot.activeTool === "eraser")) {
      const diameter = Math.max(1, snapshot.brush.size) * MASTER_CELL_PIXELS;
      context.beginPath();
      context.arc(
        (hover.x + 0.5) * MASTER_CELL_PIXELS,
        (hover.y + 0.5) * MASTER_CELL_PIXELS,
        diameter / 2,
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.beginPath();
      context.moveTo((hover.x + 0.5) * MASTER_CELL_PIXELS - 3, (hover.y + 0.5) * MASTER_CELL_PIXELS);
      context.lineTo((hover.x + 0.5) * MASTER_CELL_PIXELS + 3, (hover.y + 0.5) * MASTER_CELL_PIXELS);
      context.moveTo((hover.x + 0.5) * MASTER_CELL_PIXELS, (hover.y + 0.5) * MASTER_CELL_PIXELS - 3);
      context.lineTo((hover.x + 0.5) * MASTER_CELL_PIXELS, (hover.y + 0.5) * MASTER_CELL_PIXELS + 3);
      context.stroke();
    }
  }, [overlayRevision, snapshot.activeTool, snapshot.blueprint, snapshot.brush.size, snapshot.selection, snapshot.shapeFillMode]);

  return (
    <div
      ref={stageRef}
      className={styles.stageScroll}
      aria-label="Portrait canvas viewport"
    >
      <div
        className={styles.canvasFrame}
        style={{
          transform: `translate(${snapshot.pan.x}px, ${snapshot.pan.y}px) scale(${snapshot.zoom})`,
        }}
      >
        <p id="portrait-canvas-instructions" className={styles.srOnly}>
          Use the arrow keys to move the cell cursor. Hold Shift for ten-cell
          steps. Press Enter or Space to paint, fill, sample, or set shape and
          selection endpoints. Choose Hand and use arrow keys to pan. Two-finger
          swipes pan the canvas, and trackpad pinches zoom around the pointer.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.referenceImage}
          src={referenceSrc}
          alt="Portrait reference"
          draggable={false}
          style={{
            opacity:
              snapshot.previewMode === "blueprint"
                ? snapshot.referenceOpacity
                : snapshot.referenceOpacity * 0.08,
          }}
        />
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        <canvas
          ref={overlayRef}
          className={styles.overlayCanvas}
          aria-label="Editable 192 by 288 semantic portrait grid"
          aria-describedby="portrait-canvas-instructions"
          role="application"
          tabIndex={0}
          style={{ cursor: toolCursor(snapshot.activeTool) }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerGesture}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={() => {
            hoverRef.current = null;
            onCursorChange?.(null);
            setOverlayRevision((value) => value + 1);
          }}
          onFocus={() => {
            if (!hoverRef.current) {
              hoverRef.current = {
                x: Math.floor(snapshot.blueprint.width / 2),
                y: Math.floor(snapshot.blueprint.height / 2),
              };
              onCursorChange?.(hoverRef.current);
              setOverlayRevision((value) => value + 1);
            }
          }}
          onKeyDown={handleCanvasKeyDown}
        />
        <div className={styles.canvasMeta} aria-hidden="true">
          <span className={styles.metaTag}>192 × 288</span>
          <span className={styles.metaTag}>semantic grid</span>
        </div>
      </div>
    </div>
  );
}
