"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
} from "react";
import HalftonePortrait from "@/components/HalftonePortrait";
import EditorCanvas from "./EditorCanvas";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrushIcon,
  CloseIcon,
  DownloadIcon,
  DuplicateIcon,
  EllipseIcon,
  EraserIcon,
  ExportIcon,
  EyeHiddenIcon,
  EyeVisibleIcon,
  EyedropperIcon,
  FillBucketIcon,
  GridIcon,
  HandIcon,
  ImageIcon,
  ImportIcon,
  LassoIcon,
  LineIcon,
  LockIcon,
  MenuIcon,
  PlayIcon,
  PlusIcon,
  RectangleIcon,
  RedoIcon,
  SelectMarqueeIcon,
  TrashIcon,
  UndoIcon,
  UnlockIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
  type NamedIconProps,
} from "./icons";
import { usePortraitEditor, usePortraitEditorAutosave } from "@/hooks/usePortraitEditor";
import {
  TRANSPARENT_CELL,
  clonePortraitBlueprint,
  createPortraitBlueprint,
  PORTRAIT_MAX_LAYERS,
  type PortraitLayer,
  type PortraitMaterial,
} from "@/lib/portrait-blueprint";
import {
  PORTRAIT_MAX_JSON_BYTES,
  parsePortraitBlueprint,
  serializePortraitBlueprint,
} from "@/lib/portrait-blueprint-codec";
import type {
  PortraitEditorStore,
  PortraitEditorTool,
  PortraitSelection,
} from "@/lib/portrait-editor-engine";
import {
  clearPortraitEditorDraft,
  loadPortraitEditorDraftAsync,
} from "@/lib/portrait-editor-storage";
import { createBlueprintFromSourceImage } from "@/lib/portrait-source-blueprint";
import type { RasterPoint } from "@/lib/portrait-raster";
import styles from "./PortraitEditor.module.css";

declare global {
  interface Window {
    __portraitEditorDebug?: {
      snapshot: () => ReturnType<PortraitEditorStore["getDevSnapshot"]>;
      exportCanonical: () => string;
      getCell: (x: number, y: number, layerId?: string) => number | null;
      getCompositeCell: (x: number, y: number) => number | null;
    };
  }
}

type IconComponent = ComponentType<NamedIconProps>;

const TOOLS: Array<{
  id: PortraitEditorTool;
  label: string;
  shortcut: string;
  icon: IconComponent;
}> = [
  { id: "select", label: "Select", shortcut: "V", icon: SelectMarqueeIcon },
  { id: "hand", label: "Hand", shortcut: "H", icon: HandIcon },
  { id: "brush", label: "Brush", shortcut: "B", icon: BrushIcon },
  { id: "eraser", label: "Eraser", shortcut: "E", icon: EraserIcon },
  { id: "line", label: "Line", shortcut: "L", icon: LineIcon },
  { id: "rectangle", label: "Rectangle", shortcut: "R", icon: RectangleIcon },
  { id: "ellipse", label: "Ellipse", shortcut: "O", icon: EllipseIcon },
  { id: "fill", label: "Fill", shortcut: "G", icon: FillBucketIcon },
  { id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: EyedropperIcon },
  { id: "lasso", label: "Lasso", shortcut: "A", icon: LassoIcon },
];

const FIELD_TEXTURE = Array.from({ length: 94 }, (_, row) =>
  Array.from({ length: 68 }, (_, column) => {
    const glyphs = ["~", ":", ";", "·", "'", "`", "."];
    return glyphs[(row * 13 + column * 7) % glyphs.length];
  }).join(""),
).join("\n");

function shouldIgnoreGlobalShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="option"]',
    ),
  );
}

function selectionContains(
  selection: PortraitSelection,
  x: number,
  y: number,
  width: number,
) {
  if (selection.mask) return selection.mask[y * width + x] !== 0;
  return (
    x >= selection.x &&
    x < selection.x + selection.width &&
    y >= selection.y &&
    y < selection.y + selection.height
  );
}

function selectedIndices(selection: PortraitSelection, width: number, height: number) {
  const indices: number[] = [];
  const startX = Math.max(0, Math.floor(selection.x));
  const endX = Math.min(width, Math.ceil(selection.x + selection.width));
  const startY = Math.max(0, Math.floor(selection.y));
  const endY = Math.min(height, Math.ceil(selection.y + selection.height));
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      if (selectionContains(selection, x, y, width)) indices.push(y * width + x);
    }
  }
  return indices;
}

function safeFilename(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "portrait"
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function materialGlyphLabel(material: PortraitMaterial) {
  return Array.from(material.glyphs).join(" ");
}

function activeLayer(snapshotLayers: readonly PortraitLayer[], activeLayerId: string) {
  return snapshotLayers.find((layer) => layer.id === activeLayerId) ?? null;
}

function MaterialEditor({
  material,
  store,
}: {
  material: PortraitMaterial;
  store: PortraitEditorStore;
}) {
  const [glyphs, setGlyphs] = useState(material.glyphs);
  const [flicker, setFlicker] = useState(material.flicker);

  const commitGlyphs = () => {
    const next = glyphs.trim();
    if (next.length === 0) {
      setGlyphs(material.glyphs);
      return;
    }
    store.updateMaterial(material.id, { glyphs: next });
  };
  const commitFlicker = () => {
    store.updateMaterial(material.id, { flicker });
  };

  return (
    <div className={styles.materialEditor}>
      <label className={styles.fieldLabel}>
        <span>Glyph family</span>
        <input
          className={styles.textInput}
          value={glyphs}
          spellCheck={false}
          maxLength={64}
          onChange={(event) => setGlyphs(event.target.value)}
          onBlur={commitGlyphs}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>
      <label className={styles.controlRow}>
        <span className={styles.controlLabel}>Flicker range</span>
        <span className={styles.controlValue}>{Math.round(flicker * 100)}%</span>
      </label>
      <input
        className={styles.slider}
        style={{
          "--slider-fill": `${Math.min(100, flicker * 200)}%`,
        } as React.CSSProperties}
        type="range"
        min="0"
        max="0.5"
        step="0.01"
        value={flicker}
        aria-label="Material flicker range"
        onChange={(event) => setFlicker(Number(event.target.value))}
        onPointerUp={commitFlicker}
        onKeyUp={commitFlicker}
        onBlur={commitFlicker}
      />
    </div>
  );
}

export default function PortraitEditor() {
  const { store, snapshot } = usePortraitEditor(createPortraitBlueprint("Portrait"));
  const [referenceSrc, setReferenceSrc] = useState("/portrait.png");
  const [livePreviewOpen, setLivePreviewOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"tools" | "layers" | null>(null);
  const [cursor, setCursor] = useState<RasterPoint | null>(null);
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const importProjectRef = useRef<HTMLInputElement>(null);
  const importReferenceRef = useRef<HTMLInputElement>(null);
  const toolToggleRef = useRef<HTMLButtonElement>(null);
  const layerToggleRef = useRef<HTMLButtonElement>(null);
  const livePreviewTriggerRef = useRef<HTMLButtonElement>(null);
  const toolPanelRef = useRef<HTMLElement>(null);
  const layerPanelRef = useRef<HTMLElement>(null);
  const initializedRef = useRef(false);
  const previousToolRef = useRef<PortraitEditorTool | null>(null);
  const referenceObjectUrlRef = useRef<string | null>(null);
  const pendingCursorRef = useRef<RasterPoint | null>(null);
  const cursorFrameRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
    }, 2600);
  }, []);

  const onAutosaveError = useCallback(
    (error: Error) => showToast(`Autosave failed: ${error.message}`),
    [showToast],
  );
  usePortraitEditorAutosave(store, { delayMs: 650, onError: onAutosaveError });

  const handleCursorChange = useCallback((position: RasterPoint | null) => {
    pendingCursorRef.current = position;
    if (cursorFrameRef.current !== null) return;
    cursorFrameRef.current = window.requestAnimationFrame(() => {
      cursorFrameRef.current = null;
      setCursor(pendingCursorRef.current);
    });
  }, []);

  useEffect(
    () => () => {
      if (cursorFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (mobilePanel === null) return;
    const panel = mobilePanel === "tools" ? toolPanelRef.current : layerPanelRef.current;
    const frame = window.requestAnimationFrame(() => {
      panel
        ?.querySelector<HTMLElement>(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobilePanel]);

  const closeMobilePanel = useCallback(
    (panel: "tools" | "layers") => {
      setMobilePanel(null);
      window.requestAnimationFrame(() => {
        (panel === "tools" ? toolToggleRef.current : layerToggleRef.current)?.focus();
      });
    },
    [],
  );

  const closeLivePreview = useCallback(() => {
    setLivePreviewOpen(false);
    window.requestAnimationFrame(() => livePreviewTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    let cancelled = false;

    const initialize = async () => {
      const draft = await loadPortraitEditorDraftAsync();
      if (draft.status === "loaded" && draft.blueprint) {
        store.replaceBlueprint(draft.blueprint, { recordHistory: false });
        const face = draft.blueprint.layers.find((layer) => layer.id === "face");
        if (face) store.setActiveLayer(face.id);
        const sourceImage = draft.blueprint.metadata.sourceImage;
        if (sourceImage) setReferenceSrc(sourceImage);
        if (!cancelled) {
          setInitializing(false);
        }
        return;
      }
      if (draft.status === "corrupt") {
        showToast("A damaged local draft was preserved separately. A clean portrait was loaded.");
      }
      try {
        const traced = await createBlueprintFromSourceImage("/portrait.png");
        if (cancelled) return;
        store.replaceBlueprint(traced, { recordHistory: false });
        store.setActiveLayer("face");
        store.setActiveMaterial(1);
      } catch (error) {
        if (!cancelled) {
          showToast(
            `The source trace could not load: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [showToast, store]);

  useEffect(() => {
    if (window.location.hostname !== "localhost") return;
    window.__portraitEditorDebug = {
      snapshot: () => store.getDevSnapshot(),
      exportCanonical: () => store.exportJson(),
      getCell: (x, y, layerId = store.getSnapshot().activeLayerId) => {
        const current = store.getSnapshot();
        if (x < 0 || x >= current.blueprint.width || y < 0 || y >= current.blueprint.height) {
          return null;
        }
        const layer = current.blueprint.layers.find((candidate) => candidate.id === layerId);
        return layer?.cells[y * current.blueprint.width + x] ?? null;
      },
      getCompositeCell: (x, y) => {
        const current = store.getSnapshot();
        if (x < 0 || x >= current.blueprint.width || y < 0 || y >= current.blueprint.height) {
          return null;
        }
        return store.getComposite()[y * current.blueprint.width + x] ?? null;
      },
    };
    return () => {
      delete window.__portraitEditorDebug;
    };
  }, [store]);

  useEffect(
    () => () => {
      if (referenceObjectUrlRef.current) URL.revokeObjectURL(referenceObjectUrlRef.current);
    },
    [],
  );

  const deleteSelection = useCallback(() => {
    const current = store.getSnapshot();
    const selection = current.selection;
    if (!selection) return false;
    const indices = selectedIndices(selection, current.blueprint.width, current.blueprint.height);
    store.applyCellEdits(
      indices.map((index) => ({ index, value: TRANSPARENT_CELL })),
      "Delete selection",
    );
    store.clearSelection();
    return true;
  }, [store]);

  const duplicateSelection = useCallback(() => {
    const current = store.getSnapshot();
    const selection = current.selection;
    const layer = activeLayer(current.blueprint.layers, current.activeLayerId);
    if (!selection || !layer || layer.locked) return false;
    const edits = [];
    for (const index of selectedIndices(selection, current.blueprint.width, current.blueprint.height)) {
      const value = layer.cells[index];
      if (value === TRANSPARENT_CELL) continue;
      const x = index % current.blueprint.width;
      const y = Math.floor(index / current.blueprint.width);
      const targetX = x + 2;
      const targetY = y + 2;
      if (targetX >= current.blueprint.width || targetY >= current.blueprint.height) continue;
      edits.push({ index: targetY * current.blueprint.width + targetX, value });
    }
    if (edits.length === 0) return false;
    store.applyCellEdits(edits, "Duplicate selection");
    store.setSelection({
      ...selection,
      x: selection.x + 2,
      y: selection.y + 2,
      mask: selection.mask
        ? (() => {
            const moved = new Uint8Array(selection.mask.length);
            for (let y = 0; y < current.blueprint.height - 2; y++) {
              for (let x = 0; x < current.blueprint.width - 2; x++) {
                if (selection.mask?.[y * current.blueprint.width + x]) {
                  moved[(y + 2) * current.blueprint.width + x + 2] = 1;
                }
              }
            }
            return moved;
          })()
        : undefined,
    });
    return true;
  }, [store]);

  const exportPortrait = useCallback(() => {
    try {
      const canonical = store.exportJson();
      const roundTrip = serializePortraitBlueprint(parsePortraitBlueprint(canonical));
      if (canonical !== roundTrip) throw new Error("Canonical round-trip mismatch");
      const filename = `${safeFilename(store.getSnapshot().blueprint.metadata.name)}.portrait`;
      downloadBlob(new Blob([canonical], { type: "application/json" }), filename);
      showToast("Lossless portrait document exported");
    } catch (error) {
      showToast(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [showToast, store]);

  useEffect(() => {
    const toolShortcuts: Record<string, PortraitEditorTool> = {
      v: "select",
      h: "hand",
      b: "brush",
      e: "eraser",
      l: "line",
      r: "rectangle",
      o: "ellipse",
      g: "fill",
      i: "eyedropper",
      a: "lasso",
    };

    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "escape") {
        if (livePreviewOpen) {
          closeLivePreview();
          return;
        }
        store.cancelGesture();
        store.clearSelection();
        if (mobilePanel) closeMobilePanel(mobilePanel);
        return;
      }
      if (shouldIgnoreGlobalShortcut(event.target)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (modifier && key === "d") {
        if (duplicateSelection()) event.preventDefault();
        return;
      }
      if (modifier && key === "s") {
        event.preventDefault();
        exportPortrait();
        return;
      }
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        previousToolRef.current = store.getSnapshot().activeTool;
        store.setActiveTool("hand");
        return;
      }
      if (key === "delete" || key === "backspace") {
        if (deleteSelection()) event.preventDefault();
        return;
      }
      if (key === "[") {
        store.setBrush({ size: store.getSnapshot().brush.size - 1 });
        return;
      }
      if (key === "]") {
        store.setBrush({ size: store.getSnapshot().brush.size + 1 });
        return;
      }
      if (key === "0") {
        store.resetViewport();
        return;
      }
      if (key === "+" || key === "=") {
        store.zoomBy(1.15);
        return;
      }
      if (key === "-") {
        store.zoomBy(1 / 1.15);
        return;
      }
      const tool = toolShortcuts[key];
      if (tool) store.setActiveTool(tool);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !previousToolRef.current) return;
      store.setActiveTool(previousToolRef.current);
      previousToolRef.current = null;
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [closeLivePreview, closeMobilePanel, deleteSelection, duplicateSelection, exportPortrait, livePreviewOpen, mobilePanel, store]);

  const handleProjectImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > PORTRAIT_MAX_JSON_BYTES) {
      showToast(
        `Import rejected: portrait files must be ${PORTRAIT_MAX_JSON_BYTES / (1024 * 1024)} MB or smaller`,
      );
      return;
    }
    try {
      const imported = store.importJson(await file.text(), {
        label: `Import ${file.name}`,
      });
      setReferenceSrc(imported.metadata.sourceImage ?? "/portrait.png");
      const face = imported.layers.find((layer) => layer.id === "face");
      if (face) store.setActiveLayer(face.id);
      showToast(`Imported ${file.name}`);
    } catch (error) {
      showToast(`Import rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleReferenceImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      showToast("Choose a reference image no larger than 20 MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      showToast("Choose a PNG, JPEG, or WebP reference image");
      return;
    }
    if (referenceObjectUrlRef.current) URL.revokeObjectURL(referenceObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    referenceObjectUrlRef.current = url;
    setReferenceSrc(url);
    store.setReferenceOpacity(Math.max(0.35, store.getSnapshot().referenceOpacity));
    showToast("Reference replaced. Use Trace reference to rebuild the starting layers.");
  };

  const traceReference = useCallback(async () => {
    try {
      setInitializing(true);
      const traced = await createBlueprintFromSourceImage(referenceSrc);
      if (referenceSrc.startsWith("blob:")) {
        traced.metadata.sourceImage = null;
      }
      store.replaceBlueprint(traced, { label: "Trace reference" });
      store.setActiveLayer("face");
      setInitializing(false);
      showToast("Reference traced into semantic layers");
    } catch (error) {
      setInitializing(false);
      showToast(`Trace failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [referenceSrc, showToast, store]);

  const clearPortrait = useCallback(() => {
    const blank = clonePortraitBlueprint(store.getSnapshot().blueprint);
    blank.layers.forEach((layer) => layer.cells.fill(TRANSPARENT_CELL));
    store.replaceBlueprint(blank, { label: "Clear portrait" });
    showToast("Portrait cleared. Undo is available.");
  }, [showToast, store]);

  const resetToSource = useCallback(async () => {
    clearPortraitEditorDraft();
    setReferenceSrc("/portrait.png");
    try {
      setInitializing(true);
      const traced = await createBlueprintFromSourceImage("/portrait.png");
      store.replaceBlueprint(traced, { label: "Reset to source" });
      store.setActiveLayer("face");
      store.setActiveMaterial(1);
      showToast("Restored the original portrait trace");
    } finally {
      setInitializing(false);
    }
  }, [showToast, store]);

  const downloadPreview = useCallback(() => {
    if (!previewCanvas) {
      showToast("The preview is not ready yet");
      return;
    }
    previewCanvas.toBlob((blob) => {
      if (!blob) {
        showToast("Preview export failed");
        return;
      }
      downloadBlob(
        blob,
        `${safeFilename(snapshot.blueprint.metadata.name)}-${snapshot.previewMode}.png`,
      );
      showToast("Preview PNG exported");
    }, "image/png");
  }, [previewCanvas, showToast, snapshot.blueprint.metadata.name, snapshot.previewMode]);

  const layerIndex = snapshot.blueprint.layers.findIndex(
    (layer) => layer.id === snapshot.activeLayerId,
  );
  const selectedLayer = activeLayer(snapshot.blueprint.layers, snapshot.activeLayerId);
  const selectedMaterial =
    snapshot.blueprint.materials.find(
      (material) => material.id === snapshot.activeMaterialId,
    ) ?? snapshot.blueprint.materials[0];
  const debug = useMemo(
    () => {
      const current = store.getDevSnapshot();
      if (current.documentRevision !== snapshot.documentRevision) {
        return store.getDevSnapshot();
      }
      return current;
    },
    [snapshot.documentRevision, store],
  );

  return (
    <div className={styles.editor} data-testid="portrait-editor">
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <p className={styles.brandName}>portrait.studio</p>
        </div>
        <div className={styles.saveState} aria-live="polite">
          <span className={styles.saveDot} />
          {initializing
            ? "Preparing local document"
            : snapshot.isGesturing
              ? "Editing"
              : "Saved locally"}
        </div>
        <div className={styles.topActions}>
          <button
            ref={toolToggleRef}
            className={styles.panelToggle}
            type="button"
            aria-label="Open tool settings"
            aria-expanded={mobilePanel === "tools"}
            aria-controls="portrait-tool-settings"
            onClick={() => setMobilePanel((panel) => (panel === "tools" ? null : "tools"))}
          >
            <BrushIcon size={17} />
          </button>
          <button
            ref={layerToggleRef}
            className={styles.panelToggle}
            type="button"
            aria-label="Open layers"
            aria-expanded={mobilePanel === "layers"}
            aria-controls="portrait-layers-panel"
            onClick={() => setMobilePanel((panel) => (panel === "layers" ? null : "layers"))}
          >
            <MenuIcon size={17} />
          </button>
          <button
            className={styles.button}
            type="button"
            aria-label="Import portrait document"
            onClick={() => importProjectRef.current?.click()}
          >
            <ImportIcon size={16} />
            <span className={styles.buttonLabelOptional}>Import</span>
          </button>
          <button
            className={styles.button}
            type="button"
            aria-label="Export portrait document"
            onClick={exportPortrait}
          >
            <ExportIcon size={16} />
            <span className={styles.buttonLabelOptional}>Export .portrait</span>
          </button>
          <button
            ref={livePreviewTriggerRef}
            className={styles.primaryButton}
            type="button"
            aria-label="Open exact live preview"
            onClick={() => setLivePreviewOpen(true)}
          >
            <PlayIcon size={16} />
            <span className={styles.buttonLabelOptional}>Live preview</span>
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <aside
          ref={toolPanelRef}
          id="portrait-tool-settings"
          className={`${styles.panel} ${styles.leftPanel} ${
            mobilePanel === "tools" ? styles.panelOpen : ""
          }`}
          aria-label="Tool and material settings"
        >
          <div className={styles.panelInner}>
            <div className={styles.panelTitleRow}>
              <h2 className={styles.panelHeading}>Tool Settings</h2>
              <button
                type="button"
                className={`${styles.compactButton} ${styles.mobileOnly}`}
                aria-label="Close tool settings"
                onClick={() => closeMobilePanel("tools")}
              >
                <CloseIcon size={16} />
              </button>
            </div>
            <h3 className={styles.panelSubheading}>
              {TOOLS.find((tool) => tool.id === snapshot.activeTool)?.label ?? "Brush"}
            </h3>

            <label className={styles.controlRow}>
              <span className={styles.controlLabel}>Size</span>
              <span className={styles.controlValue}>{Math.round(snapshot.brush.size)}</span>
            </label>
            <input
              className={styles.slider}
              style={{ "--slider-fill": `${((snapshot.brush.size - 1) / 31) * 100}%` } as React.CSSProperties}
              type="range"
              min="1"
              max="32"
              step="1"
              value={snapshot.brush.size}
              aria-label="Brush size"
              onChange={(event) => store.setBrush({ size: Number(event.target.value) })}
            />

            <label className={styles.controlRow}>
              <span className={styles.controlLabel}>Density</span>
              <span className={styles.controlValue}>{Math.round(snapshot.brush.density * 100)}%</span>
            </label>
            <input
              className={styles.slider}
              style={{ "--slider-fill": `${snapshot.brush.density * 100}%` } as React.CSSProperties}
              type="range"
              min="10"
              max="100"
              step="1"
              value={Math.round(snapshot.brush.density * 100)}
              aria-label="Brush density"
              onChange={(event) => store.setBrush({ density: Number(event.target.value) / 100 })}
            />

            <label className={styles.controlRow}>
              <span className={styles.controlLabel}>Hardness</span>
              <span className={styles.controlValue}>{Math.round(snapshot.brush.hardness * 100)}%</span>
            </label>
            <input
              className={styles.slider}
              style={{ "--slider-fill": `${snapshot.brush.hardness * 100}%` } as React.CSSProperties}
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(snapshot.brush.hardness * 100)}
              aria-label="Brush hardness"
              onChange={(event) => store.setBrush({ hardness: Number(event.target.value) / 100 })}
            />

            <label className={styles.controlRow}>
              <span className={styles.controlLabel}>Intensity</span>
              <span className={styles.controlValue}>{snapshot.brush.intensity}</span>
            </label>
            <input
              className={styles.slider}
              style={{ "--slider-fill": `${(snapshot.brush.intensity / 255) * 100}%` } as React.CSSProperties}
              type="range"
              min="1"
              max="255"
              step="1"
              value={snapshot.brush.intensity}
              aria-label="Material intensity"
              onChange={(event) => store.setBrush({ intensity: Number(event.target.value) })}
            />

            {["rectangle", "ellipse"].includes(snapshot.activeTool) ? (
              <div
                className={styles.shapeModes}
                role="group"
                aria-label="Shape fill mode"
              >
                {(["stroke", "fill", "both"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`${styles.shapeModeButton} ${
                      snapshot.shapeFillMode === mode ? styles.shapeModeSelected : ""
                    }`}
                    aria-pressed={snapshot.shapeFillMode === mode}
                    onClick={() => store.setShapeFillMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            ) : null}

            <div className={styles.sectionDivider} />
            <h3 className={styles.panelHeading}>Materials</h3>
            <div className={styles.materials} role="group" aria-label="Semantic glyph materials">
              {snapshot.blueprint.materials.map((material) => {
                const selected = material.id === snapshot.activeMaterialId && snapshot.activeTool !== "eraser";
                return (
                  <button
                    key={material.id}
                    className={`${styles.materialButton} ${selected ? styles.materialSelected : ""}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      store.setActiveMaterial(material.id);
                      if (snapshot.activeTool === "eraser") store.setActiveTool("brush");
                    }}
                  >
                    <span className={styles.materialSample}>{Array.from(material.glyphs).slice(0, 3).join(" ")}</span>
                    <span className={styles.materialText}>
                      <span className={styles.materialName}>{material.name}</span>
                      <span className={styles.materialGlyphs}>{materialGlyphLabel(material)}</span>
                    </span>
                    <span className={styles.toneSwatches} aria-hidden="true">
                      <span className={styles.toneSwatch} />
                      <span className={styles.toneSwatch} />
                      <span className={styles.toneSwatch} />
                    </span>
                  </button>
                );
              })}
              <button
                className={`${styles.materialButton} ${snapshot.activeTool === "eraser" ? styles.materialSelected : ""}`}
                type="button"
                aria-pressed={snapshot.activeTool === "eraser"}
                onClick={() => store.setActiveTool("eraser")}
              >
                <span className={styles.materialSample}>···</span>
                <span className={styles.materialText}>
                  <span className={styles.materialName}>Erase</span>
                  <span className={styles.materialGlyphs}>transparent cell</span>
                </span>
                <span />
              </button>
            </div>
            {selectedMaterial ? (
              <MaterialEditor
                key={`${selectedMaterial.id}:${selectedMaterial.glyphs}:${selectedMaterial.flicker}`}
                material={selectedMaterial}
                store={store}
              />
            ) : null}
          </div>
        </aside>

        <main className={styles.workspace}>
          <pre className={styles.fieldTexture} aria-hidden="true">{FIELD_TEXTURE}</pre>
          <div className={styles.toolDockWrap}>
            <div className={styles.toolDock} role="toolbar" aria-label="Portrait drawing tools">
              {TOOLS.map(({ id, label, shortcut, icon: ToolIcon }, index) => (
                <button
                  key={id}
                  className={`${styles.toolButton} ${snapshot.activeTool === id ? styles.toolSelected : ""}`}
                  type="button"
                  aria-label={`${label}, shortcut ${shortcut}`}
                  aria-pressed={snapshot.activeTool === id}
                  title={`${label} (${shortcut})`}
                  onClick={() => store.setActiveTool(id)}
                >
                  <ToolIcon size={19} />
                  <span className={styles.toolLabel}>{label}</span>
                  {index === 1 || index === 3 || index === 6 ? null : null}
                </button>
              ))}
              <span className={styles.toolDivider} aria-hidden="true" />
              <button
                className={styles.toolButton}
                type="button"
                aria-label="Undo"
                title="Undo (Cmd or Ctrl + Z)"
                disabled={!snapshot.canUndo}
                onClick={() => store.undo()}
              >
                <UndoIcon size={19} />
                <span className={styles.toolLabel}>Undo</span>
              </button>
              <button
                className={styles.toolButton}
                type="button"
                aria-label="Redo"
                title="Redo (Shift + Cmd or Ctrl + Z)"
                disabled={!snapshot.canRedo}
                onClick={() => store.redo()}
              >
                <RedoIcon size={19} />
                <span className={styles.toolLabel}>Redo</span>
              </button>
            </div>
          </div>

          <EditorCanvas
            store={store}
            snapshot={snapshot}
            referenceSrc={referenceSrc}
            onCursorChange={handleCursorChange}
            onCanvasReady={setPreviewCanvas}
          />

          <div className={styles.modeSwitch} role="group" aria-label="Canvas view mode">
            <button
              className={`${styles.modeButton} ${snapshot.previewMode === "blueprint" ? styles.modeSelected : ""}`}
              type="button"
              aria-pressed={snapshot.previewMode === "blueprint"}
              onClick={() => store.setPreviewMode("blueprint")}
            >
              Blueprint
            </button>
            <button
              className={`${styles.modeButton} ${snapshot.previewMode === "animated" ? styles.modeSelected : ""}`}
              type="button"
              aria-pressed={snapshot.previewMode === "animated"}
              onClick={() => store.setPreviewMode("animated")}
            >
              Animated
            </button>
          </div>
        </main>

        <aside
          ref={layerPanelRef}
          id="portrait-layers-panel"
          className={`${styles.panel} ${styles.rightPanel} ${
            mobilePanel === "layers" ? styles.panelOpen : ""
          }`}
          aria-label="Layers and document settings"
        >
          <div className={styles.panelInner}>
            <div className={styles.panelTitleRow}>
              <h2 className={styles.panelHeading}>Layers</h2>
              <button
                type="button"
                className={`${styles.compactButton} ${styles.mobileOnly}`}
                aria-label="Close layers"
                onClick={() => closeMobilePanel("layers")}
              >
                <CloseIcon size={16} />
              </button>
            </div>
            <div className={styles.layers} aria-label="Portrait layers">
              <div className={styles.referenceLayer}>
                <button
                  className={styles.compactButton}
                  type="button"
                  aria-label={snapshot.referenceOpacity > 0 ? "Hide reference" : "Show reference"}
                  onClick={() => store.setReferenceOpacity(snapshot.referenceOpacity > 0 ? 0 : 0.35)}
                >
                  {snapshot.referenceOpacity > 0 ? <EyeVisibleIcon size={16} /> : <EyeHiddenIcon size={16} />}
                </button>
                <span className={styles.layerName}>Reference</span>
                <LockIcon size={15} aria-label="Reference is locked" />
              </div>
              {[...snapshot.blueprint.layers].reverse().map((layer) => {
                const selected = layer.id === snapshot.activeLayerId;
                return (
                  <div
                    key={layer.id}
                    className={`${styles.layerButton} ${selected ? styles.layerSelected : ""}`}
                    onClick={() => store.setActiveLayer(layer.id)}
                  >
                    <button
                      type="button"
                      className={styles.layerControl}
                      aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        store.setLayerVisibility(layer.id, !layer.visible);
                      }}
                    >
                      {layer.visible ? <EyeVisibleIcon size={16} /> : <EyeHiddenIcon size={16} />}
                    </button>
                    <button
                      type="button"
                      className={styles.layerSelect}
                      aria-pressed={selected}
                      aria-label={`Select ${layer.name} layer`}
                      onClick={(event) => {
                        event.stopPropagation();
                        store.setActiveLayer(layer.id);
                      }}
                    >
                      {layer.name}
                    </button>
                    <button
                      type="button"
                      className={styles.layerControl}
                      aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        store.setLayerLocked(layer.id, !layer.locked);
                      }}
                    >
                      {layer.locked ? <LockIcon size={15} /> : <UnlockIcon size={15} />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className={styles.layerUtility} role="toolbar" aria-label="Layer actions">
              <button className={styles.iconButton} type="button" aria-label="Add layer" title="Add layer" disabled={snapshot.blueprint.layers.length >= PORTRAIT_MAX_LAYERS} onClick={() => store.addLayer()}>
                <PlusIcon size={16} />
              </button>
              <button className={styles.iconButton} type="button" aria-label="Duplicate layer" title="Duplicate layer" disabled={snapshot.blueprint.layers.length >= PORTRAIT_MAX_LAYERS} onClick={() => store.duplicateLayer(snapshot.activeLayerId)}>
                <DuplicateIcon size={16} />
              </button>
              <button className={styles.iconButton} type="button" aria-label="Move layer up" title="Move layer up" disabled={layerIndex >= snapshot.blueprint.layers.length - 1} onClick={() => store.moveLayer(snapshot.activeLayerId, 1)}>
                <ArrowUpIcon size={16} />
              </button>
              <button className={styles.iconButton} type="button" aria-label="Move layer down" title="Move layer down" disabled={layerIndex <= 0} onClick={() => store.moveLayer(snapshot.activeLayerId, -1)}>
                <ArrowDownIcon size={16} />
              </button>
              <button className={styles.iconButton} type="button" aria-label="Delete layer" title="Delete layer" disabled={snapshot.blueprint.layers.length <= 1} onClick={() => store.deleteLayer(snapshot.activeLayerId)}>
                <TrashIcon size={16} />
              </button>
            </div>

            {selectedLayer ? (
              <label className={styles.fieldLabel}>
                <span>Layer name</span>
                <input
                  key={`${selectedLayer.id}:${selectedLayer.name}`}
                  className={styles.textInput}
                  defaultValue={selectedLayer.name}
                  maxLength={80}
                  onBlur={(event) => {
                    const next = event.currentTarget.value.trim();
                    if (next.length === 0) {
                      event.currentTarget.value = selectedLayer.name;
                      return;
                    }
                    store.renameLayer(selectedLayer.id, next);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
            ) : null}

            <div className={styles.sectionDivider} />
            <h2 className={styles.panelHeading}>Document</h2>
            <div className={styles.documentRows}>
              <div className={styles.documentRow}>
                <span className={styles.documentRowLabel}>Canvas size</span>
                <span className={styles.documentRowValue}>192 × 288</span>
              </div>
              <div className={styles.documentRow}>
                <span className={styles.documentRowLabel}>Active material</span>
                <span className={styles.documentRowValue}>{selectedMaterial?.name ?? "None"}</span>
              </div>
              <button className={styles.documentAction} type="button" onClick={() => importReferenceRef.current?.click()}>
                <ImageIcon size={16} />
                Replace reference
              </button>
              <button className={styles.documentAction} type="button" onClick={() => void traceReference()}>
                <UploadIcon size={16} />
                Trace reference
              </button>
              <button className={styles.documentAction} type="button" onClick={downloadPreview}>
                <DownloadIcon size={16} />
                Export preview PNG
              </button>
              <button className={styles.documentAction} type="button" onClick={clearPortrait}>
                <TrashIcon size={16} />
                Clear drawing
              </button>
              <button className={styles.documentAction} type="button" onClick={() => void resetToSource()}>
                <ImageIcon size={16} />
                Reset to source
              </button>
            </div>

            <div className={styles.sectionDivider} />
            <h2 className={styles.panelHeading}>Shortcuts</h2>
            <div className={styles.shortcuts}>
              <span><span className={styles.shortcutKey}>B</span>Brush</span>
              <span><span className={styles.shortcutKey}>E</span>Eraser</span>
              <span><span className={styles.shortcutKey}>V</span>Select</span>
              <span><span className={styles.shortcutKey}>H</span>Hand</span>
              <span><span className={styles.shortcutKey}>⌘Z</span>Undo</span>
              <span><span className={styles.shortcutKey}>[ ]</span>Size</span>
            </div>
          </div>
        </aside>
      </div>

      <footer className={styles.statusBar}>
        <div className={styles.statusGroup}>
          <button className={styles.compactButton} type="button" aria-label="Zoom out" onClick={() => store.zoomBy(1 / 1.15)}>
            <ZoomOutIcon size={15} />
          </button>
          <button className={styles.statusButton} type="button" onClick={() => store.resetViewport()} title="Reset zoom and pan">
            {Math.round(snapshot.zoom * 100)}%
          </button>
          <button className={styles.compactButton} type="button" aria-label="Zoom in" onClick={() => store.zoomBy(1.15)}>
            <ZoomInIcon size={15} />
          </button>
        </div>
        <span className={styles.statusDivider} />
        <div className={styles.statusGroup}>
          <GridIcon size={14} />
          <span className={styles.statusLabel}>Grid</span>
          <button
            className={`${styles.toggle} ${snapshot.gridVisible ? styles.toggleOn : ""}`}
            type="button"
            role="switch"
            aria-label="Show grid"
            aria-checked={snapshot.gridVisible}
            onClick={() => store.setGridVisible(!snapshot.gridVisible)}
          />
        </div>
        <span className={styles.statusDivider} />
        <div className={styles.statusGroup}>
          <span className={styles.statusLabel}>Reference</span>
          <input
            className={styles.statusSlider}
            type="range"
            min="0"
            max="100"
            value={Math.round(snapshot.referenceOpacity * 100)}
            aria-label="Reference opacity"
            onChange={(event) => store.setReferenceOpacity(Number(event.target.value) / 100)}
          />
          <span className={styles.statusValue}>{Math.round(snapshot.referenceOpacity * 100)}%</span>
        </div>
        <span className={styles.statusDivider} />
        <div className={styles.statusGroup}>
          <span className={styles.statusLabel}>Live flicker</span>
          <button
            className={`${styles.toggle} ${snapshot.flickerEnabled ? styles.toggleOn : ""}`}
            type="button"
            role="switch"
            aria-label="Enable live flicker"
            aria-checked={snapshot.flickerEnabled}
            onClick={() => store.setFlickerEnabled(!snapshot.flickerEnabled)}
          />
        </div>
        <div className={styles.statusSpacer} />
        <div className={styles.statusGroup}>
          <span className={styles.statusLabel}>cell</span>
          <span className={styles.statusValue}>{cursor ? `${cursor.x}, ${cursor.y}` : "–, –"}</span>
        </div>
        <span className={styles.statusDivider} />
        <div className={styles.statusGroup} title={`Document hash ${debug.blueprintHash}`}>
          <span className={styles.statusLabel}>shape</span>
          <span className={styles.statusValue}>{debug.compositeHash.slice(0, 8)}</span>
        </div>
      </footer>

      <input
        ref={importProjectRef}
        className={styles.hiddenInput}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept=".portrait,.json,application/json"
        onChange={(event) => void handleProjectImport(event)}
      />
      <input
        ref={importReferenceRef}
        className={styles.hiddenInput}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => void handleReferenceImport(event)}
      />
      <div className={styles.toastRegion} aria-live="polite" aria-atomic="true">
        {initializing ? <div className={styles.toast}>Preparing the semantic source trace…</div> : null}
        {toast ? <div className={styles.toast}>{toast}</div> : null}
      </div>
      {livePreviewOpen ? (
        <div
          className={styles.livePreview}
          role="dialog"
          aria-modal="true"
          aria-label="Exact live portrait preview"
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            event.preventDefault();
            event.currentTarget.querySelector<HTMLElement>("button")?.focus();
          }}
        >
          <HalftonePortrait
            src="/portrait.png"
            blueprint={snapshot.blueprint}
            alt="Exact animated preview of the current portrait document"
            className={styles.livePreviewCanvas}
          />
          <div className={styles.livePreviewBadge}>
            <span>Live renderer</span>
            <span>{snapshot.blueprint.width} × {snapshot.blueprint.height} master grid</span>
          </div>
          <button
            type="button"
            className={styles.livePreviewClose}
            aria-label="Close live preview"
            onClick={closeLivePreview}
            autoFocus
          >
            <CloseIcon size={19} />
            <span>Back to editor</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
