import {
  assertValidPortraitBlueprint,
  BLUEPRINT_VERSION,
  compositePortraitBlueprint,
  isPortraitCellValid,
  PORTRAIT_CELL_COUNT,
  PORTRAIT_GRID_HEIGHT,
  PORTRAIT_GRID_WIDTH,
  PORTRAIT_MAX_GLYPHS,
  PORTRAIT_MAX_LAYERS,
  PORTRAIT_MAX_MATERIALS,
  PORTRAIT_MAX_NAME_LENGTH,
  type PortraitBlueprint,
  type PortraitLayer,
  type PortraitMaterial,
} from "./portrait-blueprint";

/** Covers the schema's worst-case 32 fully fragmented RLE layers. */
export const PORTRAIT_MAX_JSON_BYTES = 16 * 1024 * 1024;

export function portraitJsonByteLength(json: string): number {
  if (typeof json !== "string") throw new TypeError("json must be a string");
  return new TextEncoder().encode(json).byteLength;
}

export interface PortraitLayerJson {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Alternating run-length and packed-cell value pairs. */
  rle: number[];
}

export interface PortraitBlueprintJson {
  version: typeof BLUEPRINT_VERSION;
  width: typeof PORTRAIT_GRID_WIDTH;
  height: typeof PORTRAIT_GRID_HEIGHT;
  metadata: {
    name: string;
    sourceImage: string | null;
  };
  materials: PortraitMaterial[];
  layers: PortraitLayerJson[];
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

const JSON_BLUEPRINT_KEYS = new Set([
  "version",
  "width",
  "height",
  "metadata",
  "materials",
  "layers",
]);
const JSON_METADATA_KEYS = new Set(["name", "sourceImage"]);
const JSON_MATERIAL_KEYS = new Set([
  "id",
  "key",
  "name",
  "glyphs",
  "defaultIntensity",
  "flicker",
  "runtime",
]);
const JSON_RUNTIME_KEYS = new Set([
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
const JSON_LAYER_KEYS = new Set(["id", "name", "visible", "locked", "rle"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function requireOnlyKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`${path} contains unknown properties: ${unknown.join(", ")}`);
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new TypeError(`${path} must be a string`);
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
  return value;
}

/** Encode cells as canonical alternating [runLength, value] pairs. */
export function encodeCellRle(cells: Uint16Array): number[] {
  if (!(cells instanceof Uint16Array)) {
    throw new TypeError("cells must be a Uint16Array");
  }
  if (cells.length === 0) return [];

  const encoded: number[] = [];
  let value = cells[0];
  if (!isPortraitCellValid(value)) {
    throw new TypeError("cells contains an invalid packed cell at index 0");
  }
  let runLength = 1;

  for (let index = 1; index < cells.length; index++) {
    const next = cells[index];
    if (!isPortraitCellValid(next)) {
      throw new TypeError(`cells contains an invalid packed cell at index ${index}`);
    }
    if (next === value) {
      runLength++;
    } else {
      encoded.push(runLength, value);
      value = next;
      runLength = 1;
    }
  }
  encoded.push(runLength, value);
  return encoded;
}

/** Decode pair RLE while rejecting truncated, overlong, or invalid streams. */
export function decodeCellRle(
  encoded: readonly number[],
  expectedLength = PORTRAIT_CELL_COUNT,
): Uint16Array {
  if (!Array.isArray(encoded)) {
    throw new TypeError("encoded RLE must be an array");
  }
  if (!Number.isInteger(expectedLength) || expectedLength < 0) {
    throw new RangeError("expectedLength must be a non-negative integer");
  }
  if (encoded.length % 2 !== 0) {
    throw new TypeError("RLE must contain complete run-length/value pairs");
  }
  if (expectedLength > 0 && encoded.length === 0) {
    throw new RangeError("RLE is shorter than the expected cell count");
  }

  const cells = new Uint16Array(expectedLength);
  let offset = 0;
  for (let pairIndex = 0; pairIndex < encoded.length; pairIndex += 2) {
    const runLength = encoded[pairIndex];
    const value = encoded[pairIndex + 1];
    if (!Number.isInteger(runLength) || runLength <= 0) {
      throw new TypeError(`RLE run ${pairIndex / 2} has an invalid length`);
    }
    if (!isPortraitCellValid(value)) {
      throw new TypeError(`RLE run ${pairIndex / 2} has an invalid cell value`);
    }
    if (offset + runLength > expectedLength) {
      throw new RangeError("RLE expands beyond the expected cell count");
    }
    cells.fill(value, offset, offset + runLength);
    offset += runLength;
  }
  if (offset !== expectedLength) {
    throw new RangeError("RLE is shorter than the expected cell count");
  }
  return cells;
}

/** JSON stringify with recursively sorted object keys and stable array order. */
export function canonicalStringify(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalStringify(value[key] as CanonicalValue)}`,
    );
  return `{${entries.join(",")}}`;
}

function materialToCanonicalValue(
  material: PortraitMaterial,
): { [key: string]: CanonicalValue } {
  return {
    id: material.id,
    key: material.key,
    name: material.name,
    glyphs: material.glyphs,
    defaultIntensity: material.defaultIntensity,
    flicker: material.flicker,
    runtime: {
      alphaMin: material.runtime.alphaMin,
      alphaMax: material.runtime.alphaMax,
      glyphScale: material.runtime.glyphScale,
      mutationMinMs: material.runtime.mutationMinMs,
      mutationMaxMs: material.runtime.mutationMaxMs,
      shimmer: material.runtime.shimmer,
      breathe: material.runtime.breathe,
      tear: material.runtime.tear,
      samplingPriority: material.runtime.samplingPriority,
      minCoverage: material.runtime.minCoverage,
    },
  };
}

function layerToJson(layer: PortraitLayer): PortraitLayerJson {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    rle: encodeCellRle(layer.cells),
  };
}

export function serializePortraitBlueprint(blueprint: PortraitBlueprint): string {
  assertValidPortraitBlueprint(blueprint);
  const materials = [...blueprint.materials].sort((a, b) => a.id - b.id);
  const canonical: CanonicalValue = {
    version: BLUEPRINT_VERSION,
    width: PORTRAIT_GRID_WIDTH,
    height: PORTRAIT_GRID_HEIGHT,
    metadata: {
      name: blueprint.metadata.name,
      sourceImage: blueprint.metadata.sourceImage,
    },
    materials: materials.map(materialToCanonicalValue),
    layers: blueprint.layers.map((layer) => {
      const encoded = layerToJson(layer);
      return {
        id: encoded.id,
        name: encoded.name,
        visible: encoded.visible,
        locked: encoded.locked,
        rle: encoded.rle,
      };
    }),
  };
  const json = canonicalStringify(canonical);
  if (portraitJsonByteLength(json) > PORTRAIT_MAX_JSON_BYTES) {
    throw new RangeError(
      `Portrait blueprint exceeds ${PORTRAIT_MAX_JSON_BYTES} bytes`,
    );
  }
  return json;
}

function parseMaterial(value: unknown, index: number): PortraitMaterial {
  const path = `materials[${index}]`;
  const material = requireRecord(value, path);
  requireOnlyKeys(material, JSON_MATERIAL_KEYS, path);
  const runtime = requireRecord(material.runtime, `${path}.runtime`);
  requireOnlyKeys(runtime, JSON_RUNTIME_KEYS, `${path}.runtime`);
  const key = requireString(material.key, `${path}.key`);
  const name = requireString(material.name, `${path}.name`);
  const glyphs = requireString(material.glyphs, `${path}.glyphs`);
  if (key.length > 64) throw new RangeError(`${path}.key is too long`);
  if (Array.from(name).length > PORTRAIT_MAX_NAME_LENGTH) {
    throw new RangeError(`${path}.name is too long`);
  }
  if (Array.from(glyphs).length > PORTRAIT_MAX_GLYPHS) {
    throw new RangeError(`${path}.glyphs contains too many glyphs`);
  }
  return {
    id: requireNumber(material.id, `${path}.id`),
    key,
    name,
    glyphs,
    defaultIntensity: requireNumber(
      material.defaultIntensity,
      `${path}.defaultIntensity`,
    ),
    flicker: requireNumber(material.flicker, `${path}.flicker`),
    runtime: {
      alphaMin: requireNumber(runtime.alphaMin, `${path}.runtime.alphaMin`),
      alphaMax: requireNumber(runtime.alphaMax, `${path}.runtime.alphaMax`),
      glyphScale: requireNumber(runtime.glyphScale, `${path}.runtime.glyphScale`),
      mutationMinMs: requireNumber(runtime.mutationMinMs, `${path}.runtime.mutationMinMs`),
      mutationMaxMs: requireNumber(runtime.mutationMaxMs, `${path}.runtime.mutationMaxMs`),
      shimmer: requireNumber(runtime.shimmer, `${path}.runtime.shimmer`),
      breathe: requireNumber(runtime.breathe, `${path}.runtime.breathe`),
      tear: requireNumber(runtime.tear, `${path}.runtime.tear`),
      samplingPriority: requireNumber(
        runtime.samplingPriority,
        `${path}.runtime.samplingPriority`,
      ),
      minCoverage: requireNumber(runtime.minCoverage, `${path}.runtime.minCoverage`),
    },
  };
}

function parseLayer(value: unknown, index: number): PortraitLayer {
  const path = `layers[${index}]`;
  const layer = requireRecord(value, path);
  requireOnlyKeys(layer, JSON_LAYER_KEYS, path);
  if (!Array.isArray(layer.rle)) {
    throw new TypeError(`${path}.rle must be an array`);
  }
  if (layer.rle.length > PORTRAIT_CELL_COUNT * 2) {
    throw new RangeError(`${path}.rle contains too many runs`);
  }
  const rle = layer.rle.map((item, itemIndex) =>
    requireNumber(item, `${path}.rle[${itemIndex}]`),
  );
  return {
    id: requireString(layer.id, `${path}.id`),
    name: requireString(layer.name, `${path}.name`),
    visible: requireBoolean(layer.visible, `${path}.visible`),
    locked: requireBoolean(layer.locked, `${path}.locked`),
    cells: decodeCellRle(rle),
  };
}

export function parsePortraitBlueprint(json: string): PortraitBlueprint {
  if (typeof json !== "string") throw new TypeError("json must be a string");
  if (portraitJsonByteLength(json) > PORTRAIT_MAX_JSON_BYTES) {
    throw new RangeError(`Portrait blueprint exceeds ${PORTRAIT_MAX_JSON_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new SyntaxError(
      `Portrait blueprint is not valid JSON: ${
        error instanceof Error ? error.message : "unknown parse error"
      }`,
    );
  }

  const root = requireRecord(parsed, "Blueprint");
  requireOnlyKeys(root, JSON_BLUEPRINT_KEYS, "Blueprint");
  const metadata = requireRecord(root.metadata, "metadata");
  requireOnlyKeys(metadata, JSON_METADATA_KEYS, "metadata");
  if (!Array.isArray(root.materials)) {
    throw new TypeError("materials must be an array");
  }
  if (!Array.isArray(root.layers)) {
    throw new TypeError("layers must be an array");
  }
  if (root.materials.length > PORTRAIT_MAX_MATERIALS) {
    throw new RangeError(`materials must contain at most ${PORTRAIT_MAX_MATERIALS} entries`);
  }
  if (root.layers.length > PORTRAIT_MAX_LAYERS) {
    throw new RangeError(`layers must contain at most ${PORTRAIT_MAX_LAYERS} entries`);
  }

  const sourceImage = metadata.sourceImage;
  if (sourceImage !== null && typeof sourceImage !== "string") {
    throw new TypeError("metadata.sourceImage must be a string or null");
  }

  const metadataName = requireString(metadata.name, "metadata.name");
  if (Array.from(metadataName).length > PORTRAIT_MAX_NAME_LENGTH) {
    throw new RangeError("metadata.name is too long");
  }
  if (typeof sourceImage === "string" && sourceImage.length > 2048) {
    throw new RangeError("metadata.sourceImage is too long");
  }

  const blueprint: PortraitBlueprint = {
    version: requireNumber(root.version, "version") as typeof BLUEPRINT_VERSION,
    width: requireNumber(root.width, "width") as typeof PORTRAIT_GRID_WIDTH,
    height: requireNumber(root.height, "height") as typeof PORTRAIT_GRID_HEIGHT,
    metadata: {
      name: metadataName,
      sourceImage,
    },
    materials: root.materials.map(parseMaterial),
    layers: root.layers.map(parseLayer),
  };
  assertValidPortraitBlueprint(blueprint);
  return blueprint;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnvByte(hash: number, byte: number): number {
  return Math.imul(hash ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

function fnvString(value: string, seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    hash = fnvByte(hash, code & 0xff);
    hash = fnvByte(hash, code >>> 8);
  }
  return hash;
}

function fnvCells(cells: Uint16Array, seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (const cell of cells) {
    hash = fnvByte(hash, cell & 0xff);
    hash = fnvByte(hash, cell >>> 8);
  }
  return hash;
}

function hashHex(hash: number): string {
  return hash.toString(16).padStart(8, "0");
}

export function hashPortraitBlueprint(blueprint: PortraitBlueprint): string {
  return hashHex(fnvString(serializePortraitBlueprint(blueprint)));
}

export function hashPortraitComposite(blueprint: PortraitBlueprint): string {
  const header = `${blueprint.width}x${blueprint.height}:`;
  return hashHex(fnvCells(compositePortraitBlueprint(blueprint), fnvString(header)));
}

export function hashPortraitLayer(layer: PortraitLayer): string {
  if (!(layer.cells instanceof Uint16Array)) {
    throw new TypeError("layer.cells must be a Uint16Array");
  }
  const header = canonicalStringify({
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
  });
  return hashHex(fnvCells(layer.cells, fnvString(header)));
}

export function hashPortraitLayers(
  blueprint: PortraitBlueprint,
): Record<string, string> {
  assertValidPortraitBlueprint(blueprint);
  return Object.fromEntries(
    blueprint.layers.map((layer) => [layer.id, hashPortraitLayer(layer)]),
  );
}
