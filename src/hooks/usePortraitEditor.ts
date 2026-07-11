"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { type PortraitBlueprint } from "@/lib/portrait-blueprint";
import {
  PortraitEditorStore,
  type PortraitEditorSnapshot,
  type PortraitEditorStoreOptions,
} from "@/lib/portrait-editor-engine";
import {
  attachPortraitEditorAutosave,
  type PortraitEditorAutosaveOptions,
} from "@/lib/portrait-editor-storage";

export interface UsePortraitEditorResult {
  store: PortraitEditorStore;
  snapshot: PortraitEditorSnapshot;
}

/** Subscribe to an existing editor without putting the grid in React state. */
export function usePortraitEditorStore(store: PortraitEditorStore): PortraitEditorSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}

/** Create one stable editor instance for the lifetime of the calling component. */
export function usePortraitEditor(
  initialBlueprint?: PortraitBlueprint,
  options?: PortraitEditorStoreOptions,
): UsePortraitEditorResult {
  const [store] = useState(
    () => new PortraitEditorStore(initialBlueprint, options),
  );
  const snapshot = usePortraitEditorStore(store);
  return { store, snapshot };
}

/** Attach debounced document autosave and cleanly detach it on unmount. */
export function usePortraitEditorAutosave(
  store: PortraitEditorStore,
  options?: PortraitEditorAutosaveOptions,
): void {
  const delayMs = options?.delayMs;
  const key = options?.key;
  const storage = options?.storage;
  const asyncStorage = options?.asyncStorage;
  const onError = options?.onError;
  useEffect(() => {
    const controller = attachPortraitEditorAutosave(store, {
      asyncStorage,
      delayMs,
      key,
      storage,
      onError,
    });
    return () => {
      controller.dispose();
    };
  }, [asyncStorage, delayMs, key, onError, storage, store]);
}
