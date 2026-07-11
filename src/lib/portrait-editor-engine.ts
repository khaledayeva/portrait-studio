import {
  CUTOUT_CELL,
  TRANSPARENT_CELL,
  clonePortraitBlueprint,
  compositePortraitBlueprint,
  createPortraitBlueprint,
  isPortraitCellValid,
  packPortraitCell,
  PORTRAIT_MAX_GLYPHS,
  PORTRAIT_MAX_LAYERS,
  PORTRAIT_MAX_NAME_LENGTH,
  portraitCellMaterialId,
  type PortraitBlueprint,
  type PortraitLayer,
  type PortraitMaterial,
} from "./portrait-blueprint";
import {
  parsePortraitBlueprint,
  serializePortraitBlueprint,
} from "./portrait-blueprint-codec";

export type PortraitEditorTool =
  | "select"
  | "hand"
  | "brush"
  | "eraser"
  | "line"
  | "rectangle"
  | "ellipse"
  | "fill"
  | "eyedropper"
  | "lasso";

export type ShapeFillMode = "stroke" | "fill" | "both";
export type PortraitPreviewMode = "blueprint" | "animated" | "split";

export interface BrushSettings {
  /** Brush diameter in portrait-grid cells. */
  size: number;
  /** Packed-cell intensity in the range accepted by packPortraitCell. */
  intensity: number;
  /** Fraction of eligible cells painted by a textured brush. */
  density: number;
  /** Fraction of the brush radius that remains fully opaque. */
  hardness: number;
}

export interface PortraitEditorPan {
  x: number;
  y: number;
}

export interface PortraitSelection {
  kind: "rectangle" | "lasso";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional document-sized mask. A value of 1 marks a selected cell. */
  mask?: Uint8Array;
}

export interface PortraitCellEdit {
  index: number;
  value: number;
  layerId?: string;
}

export interface PortraitEditorSnapshot {
  revision: number;
  documentRevision: number;
  blueprint: PortraitBlueprint;
  activeTool: PortraitEditorTool;
  activeMaterialId: number;
  activeLayerId: string;
  brush: Readonly<BrushSettings>;
  shapeFillMode: ShapeFillMode;
  previewMode: PortraitPreviewMode;
  referenceOpacity: number;
  zoom: number;
  pan: Readonly<PortraitEditorPan>;
  selection: PortraitSelection | null;
  gridVisible: boolean;
  flickerEnabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isGesturing: boolean;
}

export interface PortraitEditorStoreOptions {
  historyLimit?: number;
  historyByteLimit?: number;
}

export interface ReplaceBlueprintOptions {
  label?: string;
  recordHistory?: boolean;
}

export interface PortraitEditorDevSnapshot {
  revision: number;
  documentRevision: number;
  blueprintHash: string;
  compositeHash: string;
  layerHashes: Record<string, string>;
  undoDepth: number;
  redoDepth: number;
  historyBytes: number;
  activeTool: PortraitEditorTool;
  activeMaterialId: number;
  activeLayerId: string;
  isGesturing: boolean;
  pendingGestureCellCount: number;
}

interface CellLayerPatch {
  layerId: string;
  indices: Uint32Array;
  before: Uint16Array;
  after: Uint16Array;
}

interface CellHistoryCommand {
  kind: "cells";
  label: string;
  layers: CellLayerPatch[];
}

interface BlueprintHistoryCommand {
  kind: "blueprint";
  label: string;
  before: PortraitBlueprint;
  after: PortraitBlueprint;
}

type HistoryCommand = CellHistoryCommand | BlueprintHistoryCommand;

interface PendingGesture {
  label: string;
  beforeByLayer: Map<string, Map<number, number>>;
}

type Listener = () => void;

const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_HISTORY_BYTE_LIMIT = 24 * 1024 * 1024;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 16;

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum));
}

function createLayerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `layer-${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2, 10);
  return `layer-${Date.now().toString(36)}-${random}`;
}

function copySelection(selection: PortraitSelection | null): PortraitSelection | null {
  if (selection === null) {
    return null;
  }

  return {
    ...selection,
    mask: selection.mask === undefined ? undefined : new Uint8Array(selection.mask),
  };
}

function layerById(
  blueprint: PortraitBlueprint,
  layerId: string,
): PortraitLayer | undefined {
  return blueprint.layers.find((layer) => layer.id === layerId);
}

function fnv1aUpdate(hash: number, byte: number): number {
  hash ^= byte;
  return Math.imul(hash, 0x01000193) >>> 0;
}

function hashCells(cells: Uint16Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < cells.length; index += 1) {
    const value = cells[index] ?? 0;
    hash = fnv1aUpdate(hash, value & 0xff);
    hash = fnv1aUpdate(hash, value >>> 8);
  }
  return hash.toString(16).padStart(8, "0");
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash = fnv1aUpdate(hash, code & 0xff);
    hash = fnv1aUpdate(hash, code >>> 8);
  }
  return hash.toString(16).padStart(8, "0");
}

function materialForId(
  blueprint: PortraitBlueprint,
  materialId: number,
): PortraitMaterial | undefined {
  return blueprint.materials.find((material) => material.id === materialId);
}

function assertWritableCellValue(blueprint: PortraitBlueprint, value: number): void {
  if (!isPortraitCellValid(value)) {
    throw new RangeError("Portrait cell value is not a valid packed semantic cell.");
  }
  if (value === TRANSPARENT_CELL || value === CUTOUT_CELL) {
    return;
  }
  const materialId = portraitCellMaterialId(value);
  if (materialForId(blueprint, materialId) === undefined) {
    throw new RangeError(`Portrait cell references unknown material ${materialId}.`);
  }
}

function uniqueLayerName(blueprint: PortraitBlueprint, requestedName: string): string {
  const trimmed = Array.from(requestedName.trim() || "Layer")
    .slice(0, PORTRAIT_MAX_NAME_LENGTH)
    .join("");
  const names = new Set(blueprint.layers.map((layer) => layer.name));
  if (!names.has(trimmed)) {
    return trimmed;
  }

  let suffix = 2;
  let candidate = trimmed;
  while (names.has(candidate)) {
    const suffixText = ` ${suffix}`;
    const prefix = Array.from(trimmed)
      .slice(0, PORTRAIT_MAX_NAME_LENGTH - suffixText.length)
      .join("");
    candidate = `${prefix}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

function blueprintMemoryBytes(blueprint: PortraitBlueprint): number {
  let bytes = 256 + blueprint.metadata.name.length * 2;
  bytes += (blueprint.metadata.sourceImage?.length ?? 0) * 2;
  for (const material of blueprint.materials) {
    bytes += 64 + (material.key.length + material.name.length + material.glyphs.length) * 2;
  }
  for (const layer of blueprint.layers) {
    bytes += 96 + (layer.id.length + layer.name.length) * 2 + layer.cells.byteLength;
  }
  return bytes;
}

function historyCommandBytes(command: HistoryCommand): number {
  if (command.kind === "blueprint") {
    return blueprintMemoryBytes(command.before) + blueprintMemoryBytes(command.after);
  }
  return command.layers.reduce(
    (total, patch) =>
      total +
      96 +
      patch.layerId.length * 2 +
      patch.indices.byteLength +
      patch.before.byteLength +
      patch.after.byteLength,
    64,
  );
}

/**
 * Mutable portrait state behind an immutable, cached external-store snapshot.
 * Cell arrays stay typed and in place during a pointer gesture. Each emit creates
 * a new snapshot shell, so React can subscribe without copying the full document.
 */
export class PortraitEditorStore {
  private blueprint: PortraitBlueprint;
  private readonly historyLimit: number;
  private readonly historyByteLimit: number;
  private readonly listeners = new Set<Listener>();
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];
  private undoBytes = 0;
  private gesture: PendingGesture | null = null;
  private compositeCache: Uint16Array | null = null;
  private revision = 0;
  private documentRevision = 0;

  private activeTool: PortraitEditorTool = "brush";
  private activeMaterialId: number;
  private activeLayerId: string;
  private brush: BrushSettings;
  private shapeFillMode: ShapeFillMode = "stroke";
  private previewMode: PortraitPreviewMode = "blueprint";
  private referenceOpacity = 0.42;
  private zoom = 1;
  private pan: PortraitEditorPan = { x: 0, y: 0 };
  private selection: PortraitSelection | null = null;
  private gridVisible = true;
  private flickerEnabled = true;
  private snapshot: PortraitEditorSnapshot;

  constructor(
    initialBlueprint: PortraitBlueprint = createPortraitBlueprint(),
    options: PortraitEditorStoreOptions = {},
  ) {
    this.blueprint = clonePortraitBlueprint(initialBlueprint);
    this.ensureAtLeastOneLayer();
    const requestedHistoryLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.historyLimit = Number.isFinite(requestedHistoryLimit)
      ? Math.max(1, Math.floor(requestedHistoryLimit))
      : DEFAULT_HISTORY_LIMIT;
    const requestedHistoryByteLimit =
      options.historyByteLimit ?? DEFAULT_HISTORY_BYTE_LIMIT;
    this.historyByteLimit = Number.isFinite(requestedHistoryByteLimit)
      ? Math.max(1024 * 1024, Math.floor(requestedHistoryByteLimit))
      : DEFAULT_HISTORY_BYTE_LIMIT;
    this.activeLayerId = this.blueprint.layers[0]?.id ?? "";
    const firstMaterial = this.blueprint.materials[0];
    this.activeMaterialId = firstMaterial?.id ?? 1;
    this.brush = {
      size: 4,
      intensity: firstMaterial?.defaultIntensity ?? 220,
      density: 1,
      hardness: 0.85,
    };
    this.snapshot = this.buildSnapshot();
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): PortraitEditorSnapshot => this.snapshot;

  readonly getServerSnapshot = (): PortraitEditorSnapshot => this.snapshot;

  getComposite(): Uint16Array {
    if (this.compositeCache === null) {
      this.compositeCache = compositePortraitBlueprint(this.blueprint);
    }
    return this.compositeCache;
  }

  getPaintCellValue(): number {
    return packPortraitCell(this.activeMaterialId, this.brush.intensity);
  }

  setActiveTool(tool: PortraitEditorTool): void {
    if (tool === this.activeTool) {
      return;
    }
    this.activeTool = tool;
    this.emit(false);
  }

  setActiveMaterial(materialId: number, useDefaultIntensity = true): boolean {
    const material = materialForId(this.blueprint, materialId);
    if (material === undefined) {
      return false;
    }
    if (
      materialId === this.activeMaterialId &&
      (!useDefaultIntensity || this.brush.intensity === material.defaultIntensity)
    ) {
      return true;
    }

    this.activeMaterialId = materialId;
    if (useDefaultIntensity) {
      this.brush = { ...this.brush, intensity: material.defaultIntensity };
    }
    this.emit(false);
    return true;
  }

  setActiveLayer(layerId: string): boolean {
    if (layerById(this.blueprint, layerId) === undefined) {
      return false;
    }
    if (layerId === this.activeLayerId) {
      return true;
    }
    this.activeLayerId = layerId;
    this.emit(false);
    return true;
  }

  setBrush(settings: Partial<BrushSettings>): void {
    const next: BrushSettings = {
      size: clamp(settings.size ?? this.brush.size, 1, 64),
      intensity: clampInteger(settings.intensity ?? this.brush.intensity, 1, 255),
      density: clamp(settings.density ?? this.brush.density, 0.01, 1),
      hardness: clamp(settings.hardness ?? this.brush.hardness, 0, 1),
    };
    if (
      next.size === this.brush.size &&
      next.intensity === this.brush.intensity &&
      next.density === this.brush.density &&
      next.hardness === this.brush.hardness
    ) {
      return;
    }
    this.brush = next;
    this.emit(false);
  }

  setShapeFillMode(mode: ShapeFillMode): void {
    if (mode === this.shapeFillMode) {
      return;
    }
    this.shapeFillMode = mode;
    this.emit(false);
  }

  setPreviewMode(mode: PortraitPreviewMode): void {
    if (mode === this.previewMode) {
      return;
    }
    this.previewMode = mode;
    this.emit(false);
  }

  setReferenceOpacity(opacity: number): void {
    const next = clamp(opacity, 0, 1);
    if (next === this.referenceOpacity) {
      return;
    }
    this.referenceOpacity = next;
    this.emit(false);
  }

  setZoom(zoom: number): void {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) {
      return;
    }
    this.zoom = next;
    this.emit(false);
  }

  zoomBy(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) {
      return;
    }
    this.setZoom(this.zoom * factor);
  }

  /** Zoom while keeping one screen-space point fixed under the pointer. */
  zoomAt(factor: number, anchor: PortraitEditorPan): void {
    if (
      !Number.isFinite(factor) ||
      factor <= 0 ||
      !Number.isFinite(anchor.x) ||
      !Number.isFinite(anchor.y)
    ) {
      return;
    }
    const previousZoom = this.zoom;
    const nextZoom = clamp(previousZoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === previousZoom) return;
    const appliedFactor = nextZoom / previousZoom;
    this.zoom = nextZoom;
    this.pan = {
      x: anchor.x - (anchor.x - this.pan.x) * appliedFactor,
      y: anchor.y - (anchor.y - this.pan.y) * appliedFactor,
    };
    this.emit(false);
  }

  setPan(pan: PortraitEditorPan): void {
    if (!Number.isFinite(pan.x) || !Number.isFinite(pan.y)) {
      return;
    }
    if (pan.x === this.pan.x && pan.y === this.pan.y) {
      return;
    }
    this.pan = { x: pan.x, y: pan.y };
    this.emit(false);
  }

  panBy(deltaX: number, deltaY: number): void {
    this.setPan({ x: this.pan.x + deltaX, y: this.pan.y + deltaY });
  }

  resetViewport(): void {
    if (this.zoom === 1 && this.pan.x === 0 && this.pan.y === 0) {
      return;
    }
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.emit(false);
  }

  setGridVisible(visible: boolean): void {
    if (visible === this.gridVisible) {
      return;
    }
    this.gridVisible = visible;
    this.emit(false);
  }

  setFlickerEnabled(enabled: boolean): void {
    if (enabled === this.flickerEnabled) {
      return;
    }
    this.flickerEnabled = enabled;
    this.emit(false);
  }

  setSelection(selection: PortraitSelection | null): void {
    if (selection !== null) {
      const cellCount = this.blueprint.width * this.blueprint.height;
      if (selection.mask !== undefined && selection.mask.length !== cellCount) {
        throw new RangeError(`Selection mask must contain ${cellCount} cells.`);
      }
      if (
        !Number.isFinite(selection.x) ||
        !Number.isFinite(selection.y) ||
        !Number.isFinite(selection.width) ||
        !Number.isFinite(selection.height)
      ) {
        throw new TypeError("Selection bounds must be finite numbers.");
      }
    }
    this.selection = copySelection(selection);
    this.emit(false);
  }

  clearSelection(): void {
    if (this.selection === null) {
      return;
    }
    this.selection = null;
    this.emit(false);
  }

  beginGesture(label = "Draw"): void {
    if (this.gesture !== null) {
      throw new Error("A portrait edit gesture is already active.");
    }
    this.gesture = { label, beforeByLayer: new Map() };
    this.emit(false);
  }

  writeCell(index: number, value: number, layerId = this.activeLayerId): boolean {
    if (this.gesture === null) {
      throw new Error("beginGesture() must be called before writing portrait cells.");
    }
    const layer = layerById(this.blueprint, layerId);
    if (layer === undefined || layer.locked) {
      return false;
    }
    if (!Number.isInteger(index) || index < 0 || index >= layer.cells.length) {
      return false;
    }
    assertWritableCellValue(this.blueprint, value);
    const previous = layer.cells[index] ?? TRANSPARENT_CELL;
    if (previous === value) {
      return false;
    }

    let layerChanges = this.gesture.beforeByLayer.get(layerId);
    if (layerChanges === undefined) {
      layerChanges = new Map();
      this.gesture.beforeByLayer.set(layerId, layerChanges);
    }
    if (!layerChanges.has(index)) {
      layerChanges.set(index, previous);
    }
    layer.cells[index] = value;
    this.compositeCache = null;
    return true;
  }

  writeCells(edits: Iterable<PortraitCellEdit>): number {
    if (this.gesture === null) {
      throw new Error("beginGesture() must be called before writing portrait cells.");
    }
    let changed = 0;
    let didMutate = false;
    for (const edit of edits) {
      const layerId = edit.layerId ?? this.activeLayerId;
      const layer = layerById(this.blueprint, layerId);
      if (layer === undefined || layer.locked) {
        continue;
      }
      if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= layer.cells.length) {
        continue;
      }
      assertWritableCellValue(this.blueprint, edit.value);
      const previous = layer.cells[edit.index] ?? TRANSPARENT_CELL;
      if (previous === edit.value) {
        continue;
      }

      let layerChanges = this.gesture.beforeByLayer.get(layerId);
      if (layerChanges === undefined) {
        layerChanges = new Map();
        this.gesture.beforeByLayer.set(layerId, layerChanges);
      }
      if (!layerChanges.has(edit.index)) {
        layerChanges.set(edit.index, previous);
      }
      layer.cells[edit.index] = edit.value;
      changed += 1;
      didMutate = true;
    }
    if (didMutate) {
      this.compositeCache = null;
    }
    return changed;
  }

  /**
   * Paint onto the requested layer while clearing unlocked visible cells above
   * the same footprint. This keeps semantic layer ownership without allowing a
   * higher layer to silently hide a marker, fill, or shape operation.
   */
  writePaintCells(edits: Iterable<PortraitCellEdit>): number {
    if (this.gesture === null) {
      throw new Error("beginGesture() must be called before writing portrait cells.");
    }
    const surfacedEdits: PortraitCellEdit[] = [];
    for (const edit of edits) {
      const layerId = edit.layerId ?? this.activeLayerId;
      const layerIndex = this.blueprint.layers.findIndex(
        (layer) => layer.id === layerId,
      );
      const layer = this.blueprint.layers[layerIndex];
      if (
        layer === undefined ||
        layer.locked ||
        !Number.isInteger(edit.index) ||
        edit.index < 0 ||
        edit.index >= layer.cells.length
      ) {
        continue;
      }
      assertWritableCellValue(this.blueprint, edit.value);

      if (edit.value !== TRANSPARENT_CELL) {
        for (
          let upperIndex = layerIndex + 1;
          upperIndex < this.blueprint.layers.length;
          upperIndex++
        ) {
          const upperLayer = this.blueprint.layers[upperIndex];
          if (
            upperLayer === undefined ||
            !upperLayer.visible ||
            upperLayer.locked ||
            upperLayer.cells[edit.index] === TRANSPARENT_CELL
          ) {
            continue;
          }
          surfacedEdits.push({
            index: edit.index,
            value: TRANSPARENT_CELL,
            layerId: upperLayer.id,
          });
        }
      }
      surfacedEdits.push({ ...edit, layerId });
    }
    return this.writeCells(surfacedEdits);
  }

  /** Publish one lightweight preview update while a gesture is active. */
  refreshGesturePreview(): void {
    if (this.gesture === null) return;
    this.compositeCache = null;
    this.emit(false);
  }

  applyCellEdits(edits: Iterable<PortraitCellEdit>, label = "Edit cells"): number {
    this.beginGesture(label);
    try {
      const count = this.writeCells(edits);
      this.commitGesture();
      return count;
    } catch (error) {
      this.cancelGesture();
      throw error;
    }
  }

  applyPaintCellEdits(
    edits: Iterable<PortraitCellEdit>,
    label = "Paint cells",
  ): number {
    this.beginGesture(label);
    try {
      const count = this.writePaintCells(edits);
      this.commitGesture();
      return count;
    } catch (error) {
      this.cancelGesture();
      throw error;
    }
  }

  commitGesture(): boolean {
    if (this.gesture === null) {
      return false;
    }
    const pending = this.gesture;
    this.gesture = null;
    const patches: CellLayerPatch[] = [];

    for (const [layerId, beforeMap] of pending.beforeByLayer) {
      const layer = layerById(this.blueprint, layerId);
      if (layer === undefined) {
        continue;
      }
      const indices: number[] = [];
      const before: number[] = [];
      const after: number[] = [];
      for (const [index, originalValue] of beforeMap) {
        const finalValue = layer.cells[index] ?? TRANSPARENT_CELL;
        if (finalValue === originalValue) {
          continue;
        }
        indices.push(index);
        before.push(originalValue);
        after.push(finalValue);
      }
      if (indices.length > 0) {
        patches.push({
          layerId,
          indices: Uint32Array.from(indices),
          before: Uint16Array.from(before),
          after: Uint16Array.from(after),
        });
      }
    }

    if (patches.length > 0) {
      this.pushHistory({ kind: "cells", label: pending.label, layers: patches });
    }
    this.emit(patches.length > 0);
    return patches.length > 0;
  }

  cancelGesture(): boolean {
    if (this.gesture === null) {
      return false;
    }
    const pending = this.gesture;
    this.gesture = null;
    let changed = false;
    for (const [layerId, beforeMap] of pending.beforeByLayer) {
      const layer = layerById(this.blueprint, layerId);
      if (layer === undefined) {
        continue;
      }
      for (const [index, originalValue] of beforeMap) {
        if (layer.cells[index] !== originalValue) {
          layer.cells[index] = originalValue;
          changed = true;
        }
      }
    }
    if (changed) this.compositeCache = null;
    this.emit(false);
    return changed;
  }

  undo(): boolean {
    this.cancelGesture();
    const command = this.undoStack.pop();
    if (command === undefined) {
      return false;
    }
    this.undoBytes = Math.max(0, this.undoBytes - historyCommandBytes(command));
    this.applyHistoryCommand(command, "before");
    this.redoStack.push(command);
    this.emit(true);
    return true;
  }

  redo(): boolean {
    this.cancelGesture();
    const command = this.redoStack.pop();
    if (command === undefined) {
      return false;
    }
    this.applyHistoryCommand(command, "after");
    this.undoStack.push(command);
    this.undoBytes += historyCommandBytes(command);
    this.emit(true);
    return true;
  }

  clearHistory(): void {
    if (this.undoStack.length === 0 && this.redoStack.length === 0) {
      return;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
    this.emit(false);
  }

  addLayer(name = "Layer", atIndex = this.blueprint.layers.length): string {
    if (this.blueprint.layers.length >= PORTRAIT_MAX_LAYERS) {
      return "";
    }
    let newId = "";
    this.mutateBlueprint("Add layer", (blueprint) => {
      newId = createLayerId();
      const layer: PortraitLayer = {
        id: newId,
        name: uniqueLayerName(blueprint, name),
        visible: true,
        locked: false,
        cells: new Uint16Array(blueprint.width * blueprint.height),
      };
      const index = clampInteger(atIndex, 0, blueprint.layers.length);
      blueprint.layers.splice(index, 0, layer);
      return true;
    });
    this.activeLayerId = newId;
    this.emit(false);
    return newId;
  }

  duplicateLayer(layerId: string): string | null {
    if (this.blueprint.layers.length >= PORTRAIT_MAX_LAYERS) {
      return null;
    }
    let duplicateId: string | null = null;
    this.mutateBlueprint("Duplicate layer", (blueprint) => {
      const sourceIndex = blueprint.layers.findIndex((layer) => layer.id === layerId);
      if (sourceIndex < 0) {
        return false;
      }
      const source = blueprint.layers[sourceIndex];
      if (source === undefined) {
        return false;
      }
      duplicateId = createLayerId();
      blueprint.layers.splice(sourceIndex + 1, 0, {
        ...source,
        id: duplicateId,
        name: uniqueLayerName(blueprint, `${source.name} copy`),
        locked: false,
        cells: new Uint16Array(source.cells),
      });
      return true;
    });
    if (duplicateId !== null) {
      this.activeLayerId = duplicateId;
      this.emit(false);
    }
    return duplicateId;
  }

  reorderLayer(layerId: string, toIndex: number): boolean {
    return this.mutateBlueprint("Reorder layer", (blueprint) => {
      const fromIndex = blueprint.layers.findIndex((layer) => layer.id === layerId);
      if (fromIndex < 0) {
        return false;
      }
      const bounded = clampInteger(toIndex, 0, blueprint.layers.length - 1);
      if (fromIndex === bounded) {
        return false;
      }
      const [layer] = blueprint.layers.splice(fromIndex, 1);
      if (layer === undefined) {
        return false;
      }
      blueprint.layers.splice(bounded, 0, layer);
      return true;
    });
  }

  moveLayer(layerId: string, direction: -1 | 1): boolean {
    const currentIndex = this.blueprint.layers.findIndex((layer) => layer.id === layerId);
    if (currentIndex < 0) {
      return false;
    }
    return this.reorderLayer(layerId, currentIndex + direction);
  }

  deleteLayer(layerId: string): boolean {
    if (this.blueprint.layers.length <= 1) {
      return false;
    }
    const deleted = this.mutateBlueprint("Delete layer", (blueprint) => {
      const index = blueprint.layers.findIndex((layer) => layer.id === layerId);
      if (index < 0) {
        return false;
      }
      blueprint.layers.splice(index, 1);
      return true;
    });
    if (deleted && this.activeLayerId === layerId) {
      this.activeLayerId = this.blueprint.layers.at(-1)?.id ?? this.blueprint.layers[0]?.id ?? "";
      this.emit(false);
    }
    return deleted;
  }

  renameLayer(layerId: string, name: string): boolean {
    const trimmed = name.trim();
    if (
      trimmed.length === 0 ||
      Array.from(trimmed).length > PORTRAIT_MAX_NAME_LENGTH
    ) {
      return false;
    }
    return this.mutateBlueprint("Rename layer", (blueprint) => {
      const layer = layerById(blueprint, layerId);
      if (layer === undefined || layer.name === trimmed) {
        return false;
      }
      layer.name = trimmed;
      return true;
    });
  }

  setLayerVisibility(layerId: string, visible: boolean): boolean {
    return this.mutateBlueprint(visible ? "Show layer" : "Hide layer", (blueprint) => {
      const layer = layerById(blueprint, layerId);
      if (layer === undefined || layer.visible === visible) {
        return false;
      }
      layer.visible = visible;
      return true;
    });
  }

  setLayerLocked(layerId: string, locked: boolean): boolean {
    return this.mutateBlueprint(locked ? "Lock layer" : "Unlock layer", (blueprint) => {
      const layer = layerById(blueprint, layerId);
      if (layer === undefined || layer.locked === locked) {
        return false;
      }
      layer.locked = locked;
      return true;
    });
  }

  renameDocument(name: string): boolean {
    const trimmed = name.trim();
    if (
      trimmed.length === 0 ||
      Array.from(trimmed).length > PORTRAIT_MAX_NAME_LENGTH
    ) {
      return false;
    }
    return this.mutateBlueprint("Rename portrait", (blueprint) => {
      if (blueprint.metadata.name === trimmed) {
        return false;
      }
      blueprint.metadata.name = trimmed;
      return true;
    });
  }

  setSourceImage(sourceImage: string | null): boolean {
    const trimmed = sourceImage === null ? null : sourceImage.trim();
    if (trimmed !== null && trimmed.length > 2048) {
      return false;
    }
    return this.mutateBlueprint("Change reference image", (blueprint) => {
      if (blueprint.metadata.sourceImage === trimmed) {
        return false;
      }
      blueprint.metadata.sourceImage = trimmed;
      return true;
    });
  }

  updateMaterial(
    materialId: number,
    updates: Partial<Pick<PortraitMaterial, "name" | "glyphs" | "defaultIntensity" | "flicker">>,
  ): boolean {
    return this.mutateBlueprint("Update material", (blueprint) => {
      const material = materialForId(blueprint, materialId);
      if (material === undefined) {
        return false;
      }
      let changed = false;
      if (updates.name !== undefined && updates.name.trim() !== "" && updates.name !== material.name) {
        material.name = updates.name.trim();
        changed = true;
      }
      if (
        updates.glyphs !== undefined &&
        updates.glyphs.trim() !== "" &&
        Array.from(updates.glyphs).length <= PORTRAIT_MAX_GLYPHS &&
        updates.glyphs !== material.glyphs
      ) {
        material.glyphs = updates.glyphs;
        changed = true;
      }
      if (updates.defaultIntensity !== undefined) {
        const intensity = clampInteger(updates.defaultIntensity, 1, 255);
        if (intensity !== material.defaultIntensity) {
          material.defaultIntensity = intensity;
          changed = true;
        }
      }
      if (updates.flicker !== undefined) {
        const flicker = clamp(updates.flicker, 0, 1);
        if (flicker !== material.flicker) {
          material.flicker = flicker;
          changed = true;
        }
      }
      return changed;
    });
  }

  replaceBlueprint(
    nextBlueprint: PortraitBlueprint,
    options: ReplaceBlueprintOptions = {},
  ): void {
    this.cancelGesture();
    const before = clonePortraitBlueprint(this.blueprint);
    const next = clonePortraitBlueprint(nextBlueprint);
    if (next.layers.length === 0) {
      next.layers.push({
        id: createLayerId(),
        name: "Layer 1",
        visible: true,
        locked: false,
        cells: new Uint16Array(next.width * next.height),
      });
    }
    this.blueprint = next;
    this.activeLayerId = next.layers[0]?.id ?? "";
    const activeMaterial = materialForId(next, this.activeMaterialId) ?? next.materials[0];
    if (activeMaterial !== undefined) {
      this.activeMaterialId = activeMaterial.id;
      this.brush = { ...this.brush, intensity: activeMaterial.defaultIntensity };
    }
    this.selection = null;
    if (options.recordHistory !== false) {
      this.pushHistory({
        kind: "blueprint",
        label: options.label ?? "Replace portrait",
        before,
        after: clonePortraitBlueprint(next),
      });
    } else {
      this.undoStack = [];
      this.redoStack = [];
      this.undoBytes = 0;
    }
    this.emit(true);
  }

  importJson(json: string, options: ReplaceBlueprintOptions = {}): PortraitBlueprint {
    const blueprint = parsePortraitBlueprint(json);
    this.replaceBlueprint(blueprint, { label: "Import portrait", ...options });
    return blueprint;
  }

  exportJson(): string {
    return serializePortraitBlueprint(this.blueprint);
  }

  getDevSnapshot(): PortraitEditorDevSnapshot {
    const layerHashes: Record<string, string> = {};
    for (const layer of this.blueprint.layers) {
      layerHashes[layer.id] = hashCells(layer.cells);
    }
    const blueprintDescriptor = JSON.stringify({
      version: this.blueprint.version,
      width: this.blueprint.width,
      height: this.blueprint.height,
      metadata: this.blueprint.metadata,
      materials: this.blueprint.materials,
      layers: this.blueprint.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        hash: layerHashes[layer.id],
      })),
    });
    let pendingGestureCellCount = 0;
    if (this.gesture !== null) {
      for (const changes of this.gesture.beforeByLayer.values()) {
        pendingGestureCellCount += changes.size;
      }
    }
    return {
      revision: this.revision,
      documentRevision: this.documentRevision,
      blueprintHash: hashString(blueprintDescriptor),
      compositeHash: hashCells(this.getComposite()),
      layerHashes,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      historyBytes: this.undoBytes,
      activeTool: this.activeTool,
      activeMaterialId: this.activeMaterialId,
      activeLayerId: this.activeLayerId,
      isGesturing: this.gesture !== null,
      pendingGestureCellCount,
    };
  }

  private ensureAtLeastOneLayer(): void {
    if (this.blueprint.layers.length > 0) {
      return;
    }
    this.blueprint.layers.push({
      id: createLayerId(),
      name: "Layer 1",
      visible: true,
      locked: false,
      cells: new Uint16Array(this.blueprint.width * this.blueprint.height),
    });
  }

  private buildSnapshot(): PortraitEditorSnapshot {
    return {
      revision: this.revision,
      documentRevision: this.documentRevision,
      blueprint: this.blueprint,
      activeTool: this.activeTool,
      activeMaterialId: this.activeMaterialId,
      activeLayerId: this.activeLayerId,
      brush: this.brush,
      shapeFillMode: this.shapeFillMode,
      previewMode: this.previewMode,
      referenceOpacity: this.referenceOpacity,
      zoom: this.zoom,
      pan: this.pan,
      selection: this.selection,
      gridVisible: this.gridVisible,
      flickerEnabled: this.flickerEnabled,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      isGesturing: this.gesture !== null,
    };
  }

  private emit(documentChanged: boolean): void {
    this.revision += 1;
    if (documentChanged) {
      this.documentRevision += 1;
      this.compositeCache = null;
    }
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private pushHistory(command: HistoryCommand): void {
    this.undoStack.push(command);
    this.undoBytes += historyCommandBytes(command);
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > this.historyLimit ||
        this.undoBytes > this.historyByteLimit)
    ) {
      const removed = this.undoStack.shift();
      if (removed) this.undoBytes -= historyCommandBytes(removed);
    }
    this.redoStack = [];
  }

  private applyHistoryCommand(command: HistoryCommand, direction: "before" | "after"): void {
    if (command.kind === "blueprint") {
      this.blueprint = clonePortraitBlueprint(command[direction]);
      this.ensureAtLeastOneLayer();
      if (layerById(this.blueprint, this.activeLayerId) === undefined) {
        this.activeLayerId = this.blueprint.layers[0]?.id ?? "";
      }
      if (materialForId(this.blueprint, this.activeMaterialId) === undefined) {
        this.activeMaterialId = this.blueprint.materials[0]?.id ?? 1;
      }
      this.selection = null;
      return;
    }

    for (const patch of command.layers) {
      const layer = layerById(this.blueprint, patch.layerId);
      if (layer === undefined) {
        continue;
      }
      const values = direction === "before" ? patch.before : patch.after;
      for (let offset = 0; offset < patch.indices.length; offset += 1) {
        const index = patch.indices[offset];
        const value = values[offset];
        if (index !== undefined && value !== undefined && index < layer.cells.length) {
          layer.cells[index] = value;
        }
      }
    }
  }

  private mutateBlueprint(
    label: string,
    mutate: (blueprint: PortraitBlueprint) => boolean,
  ): boolean {
    this.cancelGesture();
    const before = clonePortraitBlueprint(this.blueprint);
    try {
      if (!mutate(this.blueprint)) {
        return false;
      }
      const after = clonePortraitBlueprint(this.blueprint);
      this.pushHistory({
        kind: "blueprint",
        label,
        before,
        after,
      });
      this.emit(true);
      return true;
    } catch (error) {
      this.blueprint = before;
      this.compositeCache = null;
      throw error;
    }
  }
}
