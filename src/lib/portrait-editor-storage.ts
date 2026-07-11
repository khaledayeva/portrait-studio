import { type PortraitBlueprint } from "./portrait-blueprint";
import {
  parsePortraitBlueprint,
  serializePortraitBlueprint,
} from "./portrait-blueprint-codec";
import { type PortraitEditorStore } from "./portrait-editor-engine";

export const DEFAULT_PORTRAIT_EDITOR_STORAGE_KEY = "portrait-editor:draft:v1";
export const DEFAULT_PORTRAIT_EDITOR_DATABASE_NAME = "portrait-studio";
export const DEFAULT_PORTRAIT_EDITOR_OBJECT_STORE_NAME = "drafts";

export interface PortraitEditorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PortraitEditorAsyncStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PortraitEditorIndexedDbOptions {
  indexedDB?: IDBFactory | null;
  databaseName?: string;
  objectStoreName?: string;
}

export interface PortraitDraftStorageOptions {
  /** Synchronous fallback and compatibility mirror. Defaults to localStorage. */
  storage?: PortraitEditorStorage | null;
  /** Async primary. Defaults to IndexedDB in a browser. */
  asyncStorage?: PortraitEditorAsyncStorage | null;
  key?: string;
}

export type PortraitDraftLoadStatus = "loaded" | "empty" | "corrupt" | "unavailable";

export interface PortraitDraftLoadResult {
  status: PortraitDraftLoadStatus;
  blueprint: PortraitBlueprint | null;
  /** Invalid input is copied here before the active draft key is cleared. */
  recoveryKey?: string;
  error?: Error;
}

export interface PortraitDraftSaveResult {
  ok: boolean;
  error?: Error;
}

export interface PortraitEditorAutosaveOptions extends PortraitDraftStorageOptions {
  delayMs?: number;
  onError?: (error: Error) => void;
}

export interface PortraitEditorAutosaveController {
  flush(): Promise<PortraitDraftSaveResult>;
  dispose(): void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function browserStorage(): PortraitEditorStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(storage: PortraitEditorStorage | null | undefined): PortraitEditorStorage | null {
  return storage === undefined ? browserStorage() : storage;
}

function browserIndexedDb(): IDBFactory | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.indexedDB ?? null;
  } catch {
    return null;
  }
}

function indexedDbError(message: string, error: DOMException | null): Error {
  return new Error(error?.message ? `${message}: ${error.message}` : message);
}

/**
 * Small string-keyed IndexedDB adapter. The connection is opened lazily and is
 * reused for the lifetime of the adapter.
 */
export function createPortraitEditorIndexedDbStorage(
  options: PortraitEditorIndexedDbOptions = {},
): PortraitEditorAsyncStorage | null {
  const indexedDB = options.indexedDB === undefined ? browserIndexedDb() : options.indexedDB;
  if (indexedDB === null) {
    return null;
  }
  const databaseName = options.databaseName ?? DEFAULT_PORTRAIT_EDITOR_DATABASE_NAME;
  const objectStoreName = options.objectStoreName ?? DEFAULT_PORTRAIT_EDITOR_OBJECT_STORE_NAME;
  let databasePromise: Promise<IDBDatabase> | null = null;

  const openDatabase = (): Promise<IDBDatabase> => {
    if (databasePromise !== null) {
      return databasePromise;
    }
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(databaseName, 1);
      } catch (error) {
        reject(toError(error));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(objectStoreName)) {
          database.createObjectStore(objectStoreName);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        reject(indexedDbError("IndexedDB could not open", request.error));
      };
      request.onblocked = () => {
        reject(new Error("IndexedDB was blocked by another open connection."));
      };
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  };

  return {
    async getItem(key: string): Promise<string | null> {
      const database = await openDatabase();
      return new Promise<string | null>((resolve, reject) => {
        let request: IDBRequest<unknown>;
        try {
          request = database.transaction(objectStoreName, "readonly").objectStore(objectStoreName).get(key);
        } catch (error) {
          reject(toError(error));
          return;
        }
        request.onsuccess = () => {
          const value = request.result;
          resolve(typeof value === "string" ? value : null);
        };
        request.onerror = () => {
          reject(indexedDbError("IndexedDB could not read the portrait draft", request.error));
        };
      });
    },

    async setItem(key: string, value: string): Promise<void> {
      const database = await openDatabase();
      return new Promise<void>((resolve, reject) => {
        let transaction: IDBTransaction;
        try {
          transaction = database.transaction(objectStoreName, "readwrite");
          transaction.objectStore(objectStoreName).put(value, key);
        } catch (error) {
          reject(toError(error));
          return;
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => {
          reject(indexedDbError("IndexedDB could not save the portrait draft", transaction.error));
        };
        transaction.onabort = () => {
          reject(indexedDbError("IndexedDB aborted the portrait draft save", transaction.error));
        };
      });
    },

    async removeItem(key: string): Promise<void> {
      const database = await openDatabase();
      return new Promise<void>((resolve, reject) => {
        let transaction: IDBTransaction;
        try {
          transaction = database.transaction(objectStoreName, "readwrite");
          transaction.objectStore(objectStoreName).delete(key);
        } catch (error) {
          reject(toError(error));
          return;
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => {
          reject(indexedDbError("IndexedDB could not clear the portrait draft", transaction.error));
        };
        transaction.onabort = () => {
          reject(indexedDbError("IndexedDB aborted the portrait draft clear", transaction.error));
        };
      });
    },
  };
}

let defaultAsyncStorage: PortraitEditorAsyncStorage | null | undefined;

function browserAsyncStorage(): PortraitEditorAsyncStorage | null {
  if (defaultAsyncStorage === undefined) {
    defaultAsyncStorage = createPortraitEditorIndexedDbStorage();
  }
  return defaultAsyncStorage;
}

function resolveAsyncStorage(
  storage: PortraitEditorAsyncStorage | null | undefined,
): PortraitEditorAsyncStorage | null {
  return storage === undefined ? browserAsyncStorage() : storage;
}

function corruptionRecoveryKey(key: string): string {
  return `${key}:corrupt:${new Date().toISOString()}`;
}

function parseDraft(raw: string): PortraitDraftLoadResult {
  try {
    return { status: "loaded", blueprint: parsePortraitBlueprint(raw) };
  } catch (error) {
    return { status: "corrupt", blueprint: null, error: toError(error) };
  }
}

/**
 * Reads the localStorage compatibility mirror synchronously. Invalid JSON is
 * moved to a timestamped recovery key so it cannot block editor startup.
 */
export function loadPortraitEditorDraft(
  options: PortraitDraftStorageOptions = {},
): PortraitDraftLoadResult {
  const storage = resolveStorage(options.storage);
  if (storage === null) {
    return { status: "unavailable", blueprint: null };
  }
  const key = options.key ?? DEFAULT_PORTRAIT_EDITOR_STORAGE_KEY;

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    return { status: "unavailable", blueprint: null, error: toError(error) };
  }
  if (raw === null || raw.trim() === "") {
    return { status: "empty", blueprint: null };
  }

  const parsed = parseDraft(raw);
  if (parsed.status === "loaded") {
    return parsed;
  }
  const recoveryKey = corruptionRecoveryKey(key);
  let didRecover = false;
  try {
    storage.setItem(recoveryKey, raw);
    didRecover = true;
  } catch {
    // Recovery is best effort. The active key is still cleared when possible.
  }
  try {
    storage.removeItem(key);
  } catch {
    // A read-only storage implementation cannot be repaired here.
  }
  return {
    ...parsed,
    recoveryKey: didRecover ? recoveryKey : undefined,
  };
}

/**
 * Loads IndexedDB first. A valid legacy localStorage draft is returned and
 * migrated when the primary store is empty or unavailable.
 */
export async function loadPortraitEditorDraftAsync(
  options: PortraitDraftStorageOptions = {},
): Promise<PortraitDraftLoadResult> {
  const asyncStorage = resolveAsyncStorage(options.asyncStorage);
  const key = options.key ?? DEFAULT_PORTRAIT_EDITOR_STORAGE_KEY;
  if (asyncStorage === null) {
    return loadPortraitEditorDraft(options);
  }

  let raw: string | null;
  try {
    raw = await asyncStorage.getItem(key);
  } catch {
    return loadPortraitEditorDraft(options);
  }

  if (raw === null || raw.trim() === "") {
    const fallback = loadPortraitEditorDraft(options);
    if (fallback.status === "loaded" && fallback.blueprint !== null) {
      try {
        await asyncStorage.setItem(key, serializePortraitBlueprint(fallback.blueprint));
      } catch {
        // Loading a valid fallback is more important than migration succeeding.
      }
      return fallback;
    }
    return fallback.status === "unavailable"
      ? { status: "empty", blueprint: null }
      : fallback;
  }

  const parsed = parseDraft(raw);
  if (parsed.status === "loaded") {
    return parsed;
  }
  const recoveryKey = corruptionRecoveryKey(key);
  let didRecover = false;
  try {
    await asyncStorage.setItem(recoveryKey, raw);
    didRecover = true;
  } catch {
    // Recovery is best effort.
  }
  try {
    await asyncStorage.removeItem(key);
  } catch {
    // A read-only IndexedDB implementation cannot be repaired here.
  }
  return {
    ...parsed,
    recoveryKey: didRecover ? recoveryKey : undefined,
  };
}

function saveSerializedToStorage(
  serialized: string,
  options: PortraitDraftStorageOptions,
): PortraitDraftSaveResult {
  const storage = resolveStorage(options.storage);
  if (storage === null) {
    return { ok: false, error: new Error("Portrait draft storage is unavailable.") };
  }
  const key = options.key ?? DEFAULT_PORTRAIT_EDITOR_STORAGE_KEY;
  try {
    storage.setItem(key, serialized);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export function savePortraitEditorDraft(
  blueprint: PortraitBlueprint,
  options: PortraitDraftStorageOptions = {},
): PortraitDraftSaveResult {
  try {
    return saveSerializedToStorage(serializePortraitBlueprint(blueprint), options);
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

async function saveSerializedPortraitEditorDraftAsync(
  serialized: string,
  options: PortraitDraftStorageOptions,
): Promise<PortraitDraftSaveResult> {
  const asyncStorage = resolveAsyncStorage(options.asyncStorage);
  const key = options.key ?? DEFAULT_PORTRAIT_EDITOR_STORAGE_KEY;
  if (asyncStorage === null) {
    return saveSerializedToStorage(serialized, options);
  }

  try {
    await asyncStorage.setItem(key, serialized);
  } catch (primaryError) {
    const fallback = saveSerializedToStorage(serialized, options);
    return fallback.ok
      ? fallback
      : {
          ok: false,
          error: new Error(
            `IndexedDB and localStorage both failed: ${toError(primaryError).message}; ${fallback.error?.message ?? "unknown fallback error"}`,
          ),
        };
  }

  // Keep the synchronous startup path and emergency fallback current. Failure
  // here does not invalidate a durable IndexedDB save.
  const mirror = resolveStorage(options.storage);
  if (mirror !== null) {
    try {
      mirror.setItem(key, serialized);
    } catch {
      // IndexedDB is the primary and already committed successfully.
    }
  }
  return { ok: true };
}

export async function savePortraitEditorDraftAsync(
  blueprint: PortraitBlueprint,
  options: PortraitDraftStorageOptions = {},
): Promise<PortraitDraftSaveResult> {
  let serialized: string;
  try {
    serialized = serializePortraitBlueprint(blueprint);
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
  return saveSerializedPortraitEditorDraftAsync(serialized, options);
}

export function clearPortraitEditorDraft(
  options: PortraitDraftStorageOptions = {},
): PortraitDraftSaveResult {
  const storage = resolveStorage(options.storage);
  const key = options.key ?? DEFAULT_PORTRAIT_EDITOR_STORAGE_KEY;

  // The existing UI calls this synchronous compatibility function. Schedule a
  // primary clear as well so a deleted draft cannot reappear from IndexedDB.
  if (options.storage === undefined || options.asyncStorage !== undefined) {
    const asyncStorage = resolveAsyncStorage(options.asyncStorage);
    if (asyncStorage !== null) {
      void asyncStorage.removeItem(key).catch(() => undefined);
    }
  }

  if (storage === null) {
    return { ok: false, error: new Error("Portrait draft storage is unavailable.") };
  }
  try {
    storage.removeItem(key);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function clearPortraitEditorDraftAsync(
  options: PortraitDraftStorageOptions = {},
): Promise<PortraitDraftSaveResult> {
  const key = options.key ?? DEFAULT_PORTRAIT_EDITOR_STORAGE_KEY;
  const asyncStorage = resolveAsyncStorage(options.asyncStorage);
  const storage = resolveStorage(options.storage);
  const errors: Error[] = [];
  let attempted = false;

  if (asyncStorage !== null) {
    attempted = true;
    try {
      await asyncStorage.removeItem(key);
    } catch (error) {
      errors.push(toError(error));
    }
  }
  if (storage !== null) {
    attempted = true;
    try {
      storage.removeItem(key);
    } catch (error) {
      errors.push(toError(error));
    }
  }
  if (!attempted) {
    return { ok: false, error: new Error("Portrait draft storage is unavailable.") };
  }
  return errors.length === 0
    ? { ok: true }
    : { ok: false, error: new Error(errors.map((error) => error.message).join("; ")) };
}

/**
 * Debounces document-only changes. Viewport and tool changes do not write, and
 * an active gesture waits until commit so storage never captures a half stroke.
 * Serialized revisions are queued so a slower old write cannot replace a newer
 * draft.
 */
export function attachPortraitEditorAutosave(
  store: PortraitEditorStore,
  options: PortraitEditorAutosaveOptions = {},
): PortraitEditorAutosaveController {
  const delayMs = Math.max(0, options.delayMs ?? 600);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let lastSavedRevision = store.getSnapshot().documentRevision;
  let pendingRevision: number | null = null;
  let writeQueue: Promise<void> = Promise.resolve();

  const flush = (): Promise<PortraitDraftSaveResult> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (disposed) {
      return Promise.resolve({
        ok: false,
        error: new Error("Portrait autosave has been disposed."),
      });
    }
    const snapshot = store.getSnapshot();
    if (snapshot.isGesturing || snapshot.documentRevision === lastSavedRevision) {
      return Promise.resolve({ ok: true });
    }

    let serialized: string;
    try {
      serialized = serializePortraitBlueprint(snapshot.blueprint);
    } catch (error) {
      const result = { ok: false, error: toError(error) };
      options.onError?.(result.error);
      return Promise.resolve(result);
    }
    const revision = snapshot.documentRevision;
    pendingRevision = revision;
    const write = async (): Promise<PortraitDraftSaveResult> => {
      const result = await saveSerializedPortraitEditorDraftAsync(serialized, options);
      if (result.ok) {
        lastSavedRevision = Math.max(lastSavedRevision, revision);
      } else if (result.error !== undefined) {
        options.onError?.(result.error);
      }
      if (pendingRevision === revision) {
        pendingRevision = null;
      }
      return result;
    };
    const result = writeQueue.then(write, write);
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const unsubscribe = store.subscribe(() => {
    const snapshot = store.getSnapshot();
    if (
      disposed ||
      snapshot.isGesturing ||
      snapshot.documentRevision === lastSavedRevision ||
      snapshot.documentRevision === pendingRevision
    ) {
      return;
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  });

  return {
    flush,
    dispose(): void {
      if (disposed) {
        return;
      }
      if (timer !== null && !store.getSnapshot().isGesturing) {
        void flush();
      } else if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      disposed = true;
      unsubscribe();
    },
  };
}
