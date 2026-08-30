import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_QUEUE_STORAGE_KEY,
  QUEUE_IMAGES_LOST_ON_RELOAD_ERROR,
  parsePersistedComposerQueueState,
  setComposerQueueStorageForTest,
  useComposerQueueStore,
  type ComposerQueueEntry,
} from "./composerQueueStore";
import type { StateStorage } from "./lib/storage";

function makeEntry(id: string, attachmentChars = 0): ComposerQueueEntry {
  return {
    id,
    threadKey: "env:thread",
    environmentId: "env",
    threadId: "thread",
    createdAt: "2026-08-29T12:00:00.000Z",
    prompt: `prompt ${id}`,
    text: `prompt ${id}`,
    attachments:
      attachmentChars > 0
        ? [
            {
              id: `${id}-img`,
              name: "shot.png",
              mimeType: "image/png",
              sizeBytes: attachmentChars,
              dataUrl: "x".repeat(attachmentChars),
            },
          ]
        : [],
    droppedImageNames: [],
    status: "queued",
  };
}

// A storage that holds about 100k characters, like a browser store that is
// nearly full.
const FAKE_QUOTA_CHARS = 100_000;

function createQuotaStorage(): StateStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      if (value.length > FAKE_QUOTA_CHARS) throw new Error("QuotaExceededError");
      items.set(name, value);
    },
    removeItem: (name) => {
      items.delete(name);
    },
  };
}

let storage = createQuotaStorage();
const readRaw = () => storage.items.get(COMPOSER_QUEUE_STORAGE_KEY) ?? null;

describe("composer queue store under a storage quota", () => {
  beforeEach(() => {
    storage = createQuotaStorage();
    setComposerQueueStorageForTest(storage);
    useComposerQueueStore.setState({ entries: [], pausedThreadKeys: [] });
  });

  it("keeps images in memory when they do not fit, and still accepts the write", () => {
    const store = useComposerQueueStore.getState();
    expect(store.enqueue(makeEntry("small"))).toBe(true);
    expect(store.enqueue(makeEntry("big", FAKE_QUOTA_CHARS))).toBe(true);

    const entries = useComposerQueueStore.getState().entries;
    expect(entries.map((entry) => entry.id)).toEqual(["small", "big"]);
    expect(entries[1]?.attachments).toHaveLength(1);

    const raw = readRaw();
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw ?? "") as {
      state: { entries: ReadonlyArray<ComposerQueueEntry> };
    };
    expect(persisted.state.entries[1]?.attachments).toHaveLength(0);
    expect(persisted.state.entries[1]?.imagesNotPersisted).toBe(true);
    expect(persisted.state.entries[1]?.imageCount).toBe(1);
  });

  it("later writes still land after the images were dropped from disk", () => {
    const store = useComposerQueueStore.getState();
    store.enqueue(makeEntry("big", FAKE_QUOTA_CHARS));
    expect(store.enqueue(makeEntry("next"))).toBe(true);
    expect(useComposerQueueStore.getState().entries).toHaveLength(2);
    expect(store.take("big")?.attachments).toHaveLength(1);
    const persisted = JSON.parse(readRaw() ?? "") as {
      state: { entries: ReadonlyArray<ComposerQueueEntry> };
    };
    expect(persisted.state.entries.map((entry) => entry.id)).toEqual(["next"]);
  });

  it("marks memory-only images as lost after a reload", () => {
    useComposerQueueStore.getState().enqueue(makeEntry("big", FAKE_QUOTA_CHARS));
    const reloaded = parsePersistedComposerQueueState(readRaw());
    expect(reloaded.entries[0]?.status).toBe("failed");
    expect(reloaded.entries[0]?.error).toBe(QUEUE_IMAGES_LOST_ON_RELOAD_ERROR);
    expect(reloaded.entries[0]?.imageCount).toBe(1);
  });
});
