import { afterEach, describe, expect, it, vi } from "vitest";

import { packPortraitCell } from "./portrait-blueprint";
import { PortraitEditorStore } from "./portrait-editor-engine";
import {
  attachPortraitEditorAutosave,
  clearPortraitEditorDraft,
  clearPortraitEditorDraftAsync,
  loadPortraitEditorDraft,
  loadPortraitEditorDraftAsync,
  savePortraitEditorDraft,
  savePortraitEditorDraftAsync,
  type PortraitEditorAsyncStorage,
  type PortraitEditorStorage,
} from "./portrait-editor-storage";
import { serializePortraitBlueprint } from "./portrait-blueprint-codec";

class MemoryStorage implements PortraitEditorStorage {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

class MemoryAsyncStorage implements PortraitEditorAsyncStorage {
  readonly items = new Map<string, string>();
  failReads = false;
  failWrites = false;
  failRemovals = false;

  async getItem(key: string): Promise<string | null> {
    if (this.failReads) throw new Error("async read failed");
    return this.items.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error("async write failed");
    this.items.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    if (this.failRemovals) throw new Error("async removal failed");
    this.items.delete(key);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("portrait editor draft storage", () => {
  it("saves, validates, loads, and clears semantic blueprints", () => {
    const storage = new MemoryStorage();
    const store = new PortraitEditorStore();
    store.applyCellEdits([{ index: 7, value: packPortraitCell(4, 204) }]);

    expect(savePortraitEditorDraft(store.getSnapshot().blueprint, { storage }).ok).toBe(true);
    const loaded = loadPortraitEditorDraft({ storage });
    expect(loaded.status).toBe("loaded");
    expect(loaded.blueprint?.layers[0]?.cells[7]).toBe(packPortraitCell(4, 204));
    expect(clearPortraitEditorDraft({ storage }).ok).toBe(true);
    expect(loadPortraitEditorDraft({ storage }).status).toBe("empty");
  });

  it("quarantines corrupt drafts instead of throwing on editor startup", () => {
    const storage = new MemoryStorage();
    storage.setItem("custom", "{ definitely not portrait json }");
    const result = loadPortraitEditorDraft({ storage, key: "custom" });

    expect(result.status).toBe("corrupt");
    expect(result.blueprint).toBeNull();
    expect(storage.getItem("custom")).toBeNull();
    expect(result.recoveryKey).toBeDefined();
    expect(storage.getItem(result.recoveryKey ?? "")).toBe(
      "{ definitely not portrait json }",
    );
  });

  it("saves to IndexedDB first and keeps a canonical local fallback mirror", async () => {
    const storage = new MemoryStorage();
    const asyncStorage = new MemoryAsyncStorage();
    const store = new PortraitEditorStore();
    store.applyCellEdits([{ index: 41, value: packPortraitCell(5, 177) }]);
    const blueprint = store.getSnapshot().blueprint;
    const canonical = serializePortraitBlueprint(blueprint);

    await expect(
      savePortraitEditorDraftAsync(blueprint, {
        asyncStorage,
        storage,
        key: "primary",
      }),
    ).resolves.toEqual({ ok: true });
    expect(asyncStorage.items.get("primary")).toBe(canonical);
    expect(storage.items.get("primary")).toBe(canonical);

    const loaded = await loadPortraitEditorDraftAsync({
      asyncStorage,
      storage,
      key: "primary",
    });
    expect(loaded.status).toBe("loaded");
    expect(loaded.blueprint?.layers[0]?.cells[41]).toBe(packPortraitCell(5, 177));
  });

  it("falls back to local storage when IndexedDB fails", async () => {
    const storage = new MemoryStorage();
    const asyncStorage = new MemoryAsyncStorage();
    asyncStorage.failWrites = true;
    const store = new PortraitEditorStore();
    store.applyCellEdits([{ index: 9, value: packPortraitCell(2, 199) }]);

    await expect(
      savePortraitEditorDraftAsync(store.getSnapshot().blueprint, {
        asyncStorage,
        storage,
        key: "fallback",
      }),
    ).resolves.toEqual({ ok: true });
    expect(storage.items.get("fallback")).toBe(
      serializePortraitBlueprint(store.getSnapshot().blueprint),
    );

    asyncStorage.failReads = true;
    const loaded = await loadPortraitEditorDraftAsync({
      asyncStorage,
      storage,
      key: "fallback",
    });
    expect(loaded.status).toBe("loaded");
    expect(loaded.blueprint?.layers[0]?.cells[9]).toBe(packPortraitCell(2, 199));
  });

  it("migrates a valid legacy local draft into an empty IndexedDB store", async () => {
    const storage = new MemoryStorage();
    const asyncStorage = new MemoryAsyncStorage();
    const store = new PortraitEditorStore();
    store.applyCellEdits([{ index: 18, value: packPortraitCell(7, 233) }]);
    const canonical = serializePortraitBlueprint(store.getSnapshot().blueprint);
    storage.setItem("legacy", canonical);

    const loaded = await loadPortraitEditorDraftAsync({
      asyncStorage,
      storage,
      key: "legacy",
    });
    expect(loaded.status).toBe("loaded");
    expect(asyncStorage.items.get("legacy")).toBe(canonical);
  });

  it("quarantines corrupt IndexedDB drafts without touching valid fallback data", async () => {
    const storage = new MemoryStorage();
    const asyncStorage = new MemoryAsyncStorage();
    asyncStorage.items.set("broken", "{ invalid async draft }");
    storage.items.set("broken", serializePortraitBlueprint(new PortraitEditorStore().getSnapshot().blueprint));

    const loaded = await loadPortraitEditorDraftAsync({
      asyncStorage,
      storage,
      key: "broken",
    });
    expect(loaded.status).toBe("corrupt");
    expect(asyncStorage.items.has("broken")).toBe(false);
    expect(loaded.recoveryKey).toBeDefined();
    expect(asyncStorage.items.get(loaded.recoveryKey ?? "")).toBe("{ invalid async draft }");
    expect(storage.items.has("broken")).toBe(true);
  });

  it("clears both IndexedDB and the fallback mirror", async () => {
    const storage = new MemoryStorage();
    const asyncStorage = new MemoryAsyncStorage();
    storage.items.set("clear", "local");
    asyncStorage.items.set("clear", "primary");

    await expect(
      clearPortraitEditorDraftAsync({ asyncStorage, storage, key: "clear" }),
    ).resolves.toEqual({ ok: true });
    expect(storage.items.has("clear")).toBe(false);
    expect(asyncStorage.items.has("clear")).toBe(false);
  });

  it("autosaves only after a gesture commits", async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const asyncStorage = new MemoryAsyncStorage();
    const store = new PortraitEditorStore();
    const controller = attachPortraitEditorAutosave(store, {
      asyncStorage,
      storage,
      key: "auto",
      delayMs: 50,
    });

    store.beginGesture("Brush");
    store.writeCell(12, packPortraitCell(1, 240));
    await vi.advanceTimersByTimeAsync(100);
    expect(storage.getItem("auto")).toBeNull();
    expect(await asyncStorage.getItem("auto")).toBeNull();

    store.commitGesture();
    await vi.advanceTimersByTimeAsync(49);
    expect(storage.getItem("auto")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(loadPortraitEditorDraft({ storage, key: "auto" }).blueprint?.layers[0]?.cells[12])
      .toBe(packPortraitCell(1, 240));
    expect(
      (await loadPortraitEditorDraftAsync({ asyncStorage, storage, key: "auto" }))
        .blueprint?.layers[0]?.cells[12],
    ).toBe(packPortraitCell(1, 240));
    controller.dispose();
  });
});
