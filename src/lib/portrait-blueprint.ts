/**
 * Lossless, grid-native portrait document primitives shared by the editor and
 * the animated portrait renderer. This module is intentionally browser-safe
 * and has no framework dependencies.
 */

export const BLUEPRINT_VERSION = 1 as const;
export const PORTRAIT_GRID_WIDTH = 192;
export const PORTRAIT_GRID_HEIGHT = 288;
export const PORTRAIT_CELL_COUNT =
  PORTRAIT_GRID_WIDTH * PORTRAIT_GRID_HEIGHT;
export const PORTRAIT_MAX_LAYERS = 32;
export const PORTRAIT_MAX_MATERIALS = 32;
export const PORTRAIT_MAX_NAME_LENGTH = 80;
export const PORTRAIT_MAX_GLYPHS = 64;

export const TRANSPARENT_CELL = 0x0000;
export const CUTOUT_CELL = 0xffff;

export interface PortraitMaterialRuntime {
  alphaMin: number;
  alphaMax: number;
  glyphScale: number;
  mutationMinMs: number;
  mutationMaxMs: number;
  shimmer: number;
  breathe: number;
  tear: number;
  samplingPriority: number;
  minCoverage: number;
}

export interface PortraitMaterial {
  /** Stable numeric identifier stored in the high byte of every painted cell. */
  id: number;
  /** Stable machine-readable identifier used by the editor and renderer. */
  key: string;
  /** Human-readable palette label. */
  name: string;
  /** Ordered glyph family, from visually lightest to visually densest. */
  glyphs: string;
  /** Suggested 1..255 intensity when the material is first selected. */
  defaultIntensity: number;
  /** Maximum normalized glyph mutation depth used by the animated renderer. */
  flicker: number;
  /** Versioned animation and sampling behavior shared by editor and site. */
  runtime: PortraitMaterialRuntime;
}

export interface PortraitLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** One packed Uint16 value per cell, in row-major order. */
  cells: Uint16Array;
}

export interface PortraitBlueprintMetadata {
  name: string;
  sourceImage: string | null;
}

export interface PortraitBlueprint {
  version: typeof BLUEPRINT_VERSION;
  width: typeof PORTRAIT_GRID_WIDTH;
  height: typeof PORTRAIT_GRID_HEIGHT;
  metadata: PortraitBlueprintMetadata;
  /** Material definitions are embedded so exported files remain self-describing. */
  materials: PortraitMaterial[];
  /** Layers are ordered from bottom to top. */
  layers: PortraitLayer[];
}

export type BlueprintValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: string[] };

export const DEFAULT_PORTRAIT_MATERIALS: readonly PortraitMaterial[] = [
  {
    id: 1,
    key: "skin-light",
    name: "Skin Light",
    glyphs: "%8#&@",
    defaultIntensity: 238,
    flicker: 0.1,
    runtime: { alphaMin: 0.48, alphaMax: 1, glyphScale: 1.1, mutationMinMs: 520, mutationMaxMs: 1150, shimmer: 0.1, breathe: 0.42, tear: 0, samplingPriority: 1, minCoverage: 0.16 },
  },
  {
    id: 2,
    key: "skin-mid",
    name: "Skin Mid",
    glyphs: "w$%80",
    defaultIntensity: 178,
    flicker: 0.16,
    runtime: { alphaMin: 0.36, alphaMax: 0.9, glyphScale: 1.06, mutationMinMs: 470, mutationMaxMs: 1080, shimmer: 0.11, breathe: 0.4, tear: 0, samplingPriority: 1, minCoverage: 0.16 },
  },
  {
    id: 3,
    key: "skin-shadow",
    name: "Skin Shadow",
    glyphs: ";jrf?",
    defaultIntensity: 102,
    flicker: 0.22,
    runtime: { alphaMin: 0.22, alphaMax: 0.68, glyphScale: 1.02, mutationMinMs: 420, mutationMaxMs: 980, shimmer: 0.14, breathe: 0.35, tear: 0, samplingPriority: 1, minCoverage: 0.16 },
  },
  {
    id: 4,
    key: "hair",
    name: "Hair",
    glyphs: "8%@&#",
    defaultIntensity: 206,
    flicker: 0.13,
    runtime: { alphaMin: 0.38, alphaMax: 0.94, glyphScale: 1.08, mutationMinMs: 560, mutationMaxMs: 1260, shimmer: 0.08, breathe: 0.3, tear: 0, samplingPriority: 1, minCoverage: 0.14 },
  },
  {
    id: 5,
    key: "beard",
    name: "Beard",
    glyphs: "w$%80&",
    defaultIntensity: 151,
    flicker: 0.2,
    runtime: { alphaMin: 0.28, alphaMax: 0.82, glyphScale: 1.05, mutationMinMs: 480, mutationMaxMs: 1140, shimmer: 0.12, breathe: 0.34, tear: 0, samplingPriority: 1, minCoverage: 0.14 },
  },
  {
    id: 6,
    key: "shirt",
    name: "Shirt",
    glyphs: "~_-+=<>",
    defaultIntensity: 79,
    flicker: 0.28,
    runtime: { alphaMin: 0.12, alphaMax: 0.46, glyphScale: 1, mutationMinMs: 680, mutationMaxMs: 1680, shimmer: 0.08, breathe: 0.22, tear: 0, samplingPriority: 1, minCoverage: 0.18 },
  },
  {
    id: 7,
    key: "neck-highlight",
    name: "Neck Highlight",
    glyphs: "%8#&@",
    defaultIntensity: 244,
    flicker: 0.08,
    runtime: { alphaMin: 0.54, alphaMax: 1, glyphScale: 1.12, mutationMinMs: 620, mutationMaxMs: 1320, shimmer: 0.07, breathe: 0.35, tear: 0, samplingPriority: 1.1, minCoverage: 0.1 },
  },
  {
    id: 8,
    key: "censor",
    name: "Censor",
    glyphs: "8#&@@&",
    defaultIntensity: 255,
    flicker: 0.05,
    runtime: { alphaMin: 0.82, alphaMax: 1, glyphScale: 1.45, mutationMinMs: 260, mutationMaxMs: 720, shimmer: 0.05, breathe: 0.08, tear: 0.8, samplingPriority: 1.22, minCoverage: 0.08 },
  },
  {
    id: 9,
    key: "outline",
    name: "Outline",
    glyphs: "%#&@",
    defaultIntensity: 250,
    flicker: 0.07,
    runtime: { alphaMin: 0.68, alphaMax: 1, glyphScale: 1.14, mutationMinMs: 600, mutationMaxMs: 1420, shimmer: 0.06, breathe: 0.25, tear: 0, samplingPriority: 1.14, minCoverage: 0.08 },
  },
];

const BLUEPRINT_KEYS = new Set([
  "version",
  "width",
  "height",
  "metadata",
  "materials",
  "layers",
]);
const METADATA_KEYS = new Set(["name", "sourceImage"]);
const MATERIAL_KEYS = new Set([
  "id",
  "key",
  "name",
  "glyphs",
  "defaultIntensity",
  "flicker",
  "runtime",
]);
const RUNTIME_KEYS = new Set([
  "alphaMin",
  "alphaMax",
  "glyphScale",
  "mutationMinMs",
  "mutationMaxMs",
  "shimmer",
  "breathe",
  "tear",
  "samplingPriority",
  "minCoverage",
]);
const LAYER_KEYS = new Set(["id", "name", "visible", "locked", "cells"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isByte(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255;
}

/** Pack a semantic material id and intensity into one lossless Uint16 cell. */
export function packPortraitCell(materialId: number, intensity: number): number {
  if (!Number.isInteger(materialId) || materialId < 1 || materialId > 254) {
    throw new RangeError("materialId must be an integer from 1 through 254");
  }
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 255) {
    throw new RangeError("intensity must be an integer from 1 through 255");
  }
  return (materialId << 8) | intensity;
}

export function portraitCellMaterialId(cell: number): number {
  if (cell === TRANSPARENT_CELL || cell === CUTOUT_CELL) return 0;
  return (cell >>> 8) & 0xff;
}

export function portraitCellIntensity(cell: number): number {
  if (cell === TRANSPARENT_CELL || cell === CUTOUT_CELL) return 0;
  return cell & 0xff;
}

export function isPortraitCellValid(cell: number): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell > 0xffff) return false;
  if (cell === TRANSPARENT_CELL || cell === CUTOUT_CELL) return true;
  const materialId = (cell >>> 8) & 0xff;
  const intensity = cell & 0xff;
  return materialId >= 1 && materialId <= 254 && intensity >= 1;
}

export function createPortraitLayer(id: string, name: string): PortraitLayer {
  if (!isNonEmptyString(id) || !isNonEmptyString(name)) {
    throw new TypeError("Layer id and name must be non-empty strings");
  }
  return {
    id,
    name,
    visible: true,
    locked: false,
    cells: new Uint16Array(PORTRAIT_CELL_COUNT),
  };
}

export function createPortraitBlueprint(
  name = "Untitled Portrait",
  sourceImage: string | null = "/portrait.png",
): PortraitBlueprint {
  if (!isNonEmptyString(name)) {
    throw new TypeError("Blueprint name must be a non-empty string");
  }
  if (sourceImage !== null && typeof sourceImage !== "string") {
    throw new TypeError("sourceImage must be a string or null");
  }

  return {
    version: BLUEPRINT_VERSION,
    width: PORTRAIT_GRID_WIDTH,
    height: PORTRAIT_GRID_HEIGHT,
    metadata: { name, sourceImage },
    materials: DEFAULT_PORTRAIT_MATERIALS.map((material) => ({
      ...material,
      runtime: { ...material.runtime },
    })),
    layers: [
      createPortraitLayer("portrait", "Portrait"),
      createPortraitLayer("details", "Details"),
    ],
  };
}

export function clonePortraitBlueprint(
  blueprint: PortraitBlueprint,
): PortraitBlueprint {
  assertValidPortraitBlueprint(blueprint);
  return {
    version: BLUEPRINT_VERSION,
    width: PORTRAIT_GRID_WIDTH,
    height: PORTRAIT_GRID_HEIGHT,
    metadata: { ...blueprint.metadata },
    materials: blueprint.materials.map((material) => ({
      ...material,
      runtime: { ...material.runtime },
    })),
    layers: blueprint.layers.map((layer) => ({
      ...layer,
      cells: new Uint16Array(layer.cells),
    })),
  };
}

/** Validate the complete in-memory document without coercing any values. */
export function validatePortraitBlueprint(
  value: unknown,
): BlueprintValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["Blueprint must be an object"] };
  }
  if (!hasOnlyKeys(value, BLUEPRINT_KEYS)) {
    errors.push("Blueprint contains unknown properties");
  }
  if (value.version !== BLUEPRINT_VERSION) {
    errors.push(`version must equal ${BLUEPRINT_VERSION}`);
  }
  if (value.width !== PORTRAIT_GRID_WIDTH) {
    errors.push(`width must equal ${PORTRAIT_GRID_WIDTH}`);
  }
  if (value.height !== PORTRAIT_GRID_HEIGHT) {
    errors.push(`height must equal ${PORTRAIT_GRID_HEIGHT}`);
  }

  if (!isRecord(value.metadata)) {
    errors.push("metadata must be an object");
  } else {
    if (!hasOnlyKeys(value.metadata, METADATA_KEYS)) {
      errors.push("metadata contains unknown properties");
    }
    if (!isNonEmptyString(value.metadata.name)) {
      errors.push("metadata.name must be a non-empty string");
    } else if (codePointLength(value.metadata.name) > PORTRAIT_MAX_NAME_LENGTH) {
      errors.push(`metadata.name must be at most ${PORTRAIT_MAX_NAME_LENGTH} characters`);
    }
    if (
      value.metadata.sourceImage !== null &&
      typeof value.metadata.sourceImage !== "string"
    ) {
      errors.push("metadata.sourceImage must be a string or null");
    } else if (
      typeof value.metadata.sourceImage === "string" &&
      value.metadata.sourceImage.length > 2048
    ) {
      errors.push("metadata.sourceImage must be at most 2048 characters");
    }
  }

  const materialIds = new Set<number>();
  const materialKeys = new Set<string>();
  if (!Array.isArray(value.materials) || value.materials.length === 0) {
    errors.push("materials must be a non-empty array");
  } else if (value.materials.length > PORTRAIT_MAX_MATERIALS) {
    errors.push(`materials must contain at most ${PORTRAIT_MAX_MATERIALS} entries`);
  } else {
    value.materials.forEach((candidate, index) => {
      const path = `materials[${index}]`;
      if (!isRecord(candidate)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (!hasOnlyKeys(candidate, MATERIAL_KEYS)) {
        errors.push(`${path} contains unknown properties`);
      }
      if (
        !Number.isInteger(candidate.id) ||
        Number(candidate.id) < 1 ||
        Number(candidate.id) > 254
      ) {
        errors.push(`${path}.id must be an integer from 1 through 254`);
      } else if (materialIds.has(Number(candidate.id))) {
        errors.push(`${path}.id must be unique`);
      } else {
        materialIds.add(Number(candidate.id));
      }
      if (!isNonEmptyString(candidate.key)) {
        errors.push(`${path}.key must be a non-empty string`);
      } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.key)) {
        errors.push(`${path}.key must be kebab-case`);
      } else if (materialKeys.has(candidate.key)) {
        errors.push(`${path}.key must be unique`);
      } else {
        materialKeys.add(candidate.key);
      }
      if (typeof candidate.key === "string" && candidate.key.length > 64) {
        errors.push(`${path}.key must be at most 64 characters`);
      }
      if (!isNonEmptyString(candidate.name)) {
        errors.push(`${path}.name must be a non-empty string`);
      } else if (codePointLength(candidate.name) > PORTRAIT_MAX_NAME_LENGTH) {
        errors.push(`${path}.name must be at most ${PORTRAIT_MAX_NAME_LENGTH} characters`);
      }
      if (!isNonEmptyString(candidate.glyphs)) {
        errors.push(`${path}.glyphs must be a non-empty string`);
      } else if (codePointLength(candidate.glyphs) > PORTRAIT_MAX_GLYPHS) {
        errors.push(`${path}.glyphs must contain at most ${PORTRAIT_MAX_GLYPHS} glyphs`);
      }
      if (!isByte(candidate.defaultIntensity) || candidate.defaultIntensity === 0) {
        errors.push(`${path}.defaultIntensity must be an integer from 1 through 255`);
      }
      if (
        typeof candidate.flicker !== "number" ||
        !Number.isFinite(candidate.flicker) ||
        candidate.flicker < 0 ||
        candidate.flicker > 1
      ) {
        errors.push(`${path}.flicker must be a finite number from 0 through 1`);
      }
      if (!isRecord(candidate.runtime)) {
        errors.push(`${path}.runtime must be an object`);
      } else {
        if (!hasOnlyKeys(candidate.runtime, RUNTIME_KEYS)) {
          errors.push(`${path}.runtime contains unknown properties`);
        }
        const unitFields = ["alphaMin", "alphaMax", "shimmer", "breathe", "tear", "minCoverage"];
        for (const field of unitFields) {
          const runtimeValue = candidate.runtime[field];
          if (
            typeof runtimeValue !== "number" ||
            !Number.isFinite(runtimeValue) ||
            runtimeValue < 0 ||
            runtimeValue > 1
          ) {
            errors.push(`${path}.runtime.${field} must be a finite number from 0 through 1`);
          }
        }
        if (
          typeof candidate.runtime.alphaMin === "number" &&
          typeof candidate.runtime.alphaMax === "number" &&
          candidate.runtime.alphaMin > candidate.runtime.alphaMax
        ) {
          errors.push(`${path}.runtime.alphaMin cannot exceed alphaMax`);
        }
        if (
          typeof candidate.runtime.glyphScale !== "number" ||
          !Number.isFinite(candidate.runtime.glyphScale) ||
          candidate.runtime.glyphScale < 0.5 ||
          candidate.runtime.glyphScale > 2
        ) {
          errors.push(`${path}.runtime.glyphScale must be from 0.5 through 2`);
        }
        for (const field of ["mutationMinMs", "mutationMaxMs"] as const) {
          const runtimeValue = candidate.runtime[field];
          if (
            typeof runtimeValue !== "number" ||
            !Number.isFinite(runtimeValue) ||
            runtimeValue < 16 ||
            runtimeValue > 10000
          ) {
            errors.push(`${path}.runtime.${field} must be from 16 through 10000`);
          }
        }
        if (
          typeof candidate.runtime.mutationMinMs === "number" &&
          typeof candidate.runtime.mutationMaxMs === "number" &&
          candidate.runtime.mutationMinMs > candidate.runtime.mutationMaxMs
        ) {
          errors.push(`${path}.runtime.mutationMinMs cannot exceed mutationMaxMs`);
        }
        if (
          typeof candidate.runtime.samplingPriority !== "number" ||
          !Number.isFinite(candidate.runtime.samplingPriority) ||
          candidate.runtime.samplingPriority < 0.5 ||
          candidate.runtime.samplingPriority > 2
        ) {
          errors.push(`${path}.runtime.samplingPriority must be from 0.5 through 2`);
        }
      }
    });
  }

  const layerIds = new Set<string>();
  if (!Array.isArray(value.layers) || value.layers.length === 0) {
    errors.push("layers must be a non-empty array");
  } else if (value.layers.length > PORTRAIT_MAX_LAYERS) {
    errors.push(`layers must contain at most ${PORTRAIT_MAX_LAYERS} entries`);
  } else {
    value.layers.forEach((candidate, index) => {
      const path = `layers[${index}]`;
      if (!isRecord(candidate)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (!hasOnlyKeys(candidate, LAYER_KEYS)) {
        errors.push(`${path} contains unknown properties`);
      }
      if (!isNonEmptyString(candidate.id)) {
        errors.push(`${path}.id must be a non-empty string`);
      } else if (layerIds.has(candidate.id)) {
        errors.push(`${path}.id must be unique`);
      } else {
        layerIds.add(candidate.id);
      }
      if (typeof candidate.id === "string" && candidate.id.length > 128) {
        errors.push(`${path}.id must be at most 128 characters`);
      }
      if (!isNonEmptyString(candidate.name)) {
        errors.push(`${path}.name must be a non-empty string`);
      } else if (codePointLength(candidate.name) > PORTRAIT_MAX_NAME_LENGTH) {
        errors.push(`${path}.name must be at most ${PORTRAIT_MAX_NAME_LENGTH} characters`);
      }
      if (typeof candidate.visible !== "boolean") {
        errors.push(`${path}.visible must be a boolean`);
      }
      if (typeof candidate.locked !== "boolean") {
        errors.push(`${path}.locked must be a boolean`);
      }
      if (!(candidate.cells instanceof Uint16Array)) {
        errors.push(`${path}.cells must be a Uint16Array`);
        return;
      }
      if (candidate.cells.length !== PORTRAIT_CELL_COUNT) {
        errors.push(`${path}.cells must contain ${PORTRAIT_CELL_COUNT} cells`);
        return;
      }
      for (let cellIndex = 0; cellIndex < candidate.cells.length; cellIndex++) {
        const cell = candidate.cells[cellIndex];
        if (!isPortraitCellValid(cell)) {
          errors.push(`${path}.cells[${cellIndex}] is not a valid packed cell`);
          break;
        }
        const materialId = portraitCellMaterialId(cell);
        if (materialId !== 0 && !materialIds.has(materialId)) {
          errors.push(
            `${path}.cells[${cellIndex}] references missing material ${materialId}`,
          );
          break;
        }
      }
    });
  }

  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors };
}

export function assertValidPortraitBlueprint(
  value: unknown,
): asserts value is PortraitBlueprint {
  const result = validatePortraitBlueprint(value);
  if (!result.valid) {
    throw new TypeError(`Invalid portrait blueprint: ${result.errors.join("; ")}`);
  }
}

/**
 * Composite visible layers from bottom to top. Transparent cells reveal lower
 * layers. A cutout cell clears everything below it back to transparency.
 */
export function compositePortraitBlueprint(
  blueprint: PortraitBlueprint,
): Uint16Array {
  if (
    blueprint.width !== PORTRAIT_GRID_WIDTH ||
    blueprint.height !== PORTRAIT_GRID_HEIGHT
  ) {
    throw new RangeError("Blueprint dimensions do not match the portrait grid");
  }
  const composite = new Uint16Array(PORTRAIT_CELL_COUNT);
  for (const layer of blueprint.layers) {
    if (!layer.visible) continue;
    if (
      !(layer.cells instanceof Uint16Array) ||
      layer.cells.length !== PORTRAIT_CELL_COUNT
    ) {
      throw new RangeError(
        `Layer ${layer.id || "(unnamed)"} does not match the portrait grid`,
      );
    }
    for (let index = 0; index < PORTRAIT_CELL_COUNT; index++) {
      const cell = layer.cells[index];
      if (cell === TRANSPARENT_CELL) continue;
      composite[index] = cell === CUTOUT_CELL ? TRANSPARENT_CELL : cell;
    }
  }
  return composite;
}
