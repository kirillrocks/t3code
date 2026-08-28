import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";

import { PersistedComposerImageAttachment } from "./composerDraftStore";
import { createMemoryStorage, type StateStorage } from "./lib/storage";

/**
 * Follow-up messages waiting for the agent to finish. A queued message is
 * NOT on the server yet: it lives in this browser until the thread goes idle,
 * then the drain hook (see composerQueue/useComposerQueueDrain) sends it as
 * an ordinary turn. Enter while a turn runs queues; Ctrl/Cmd+Enter sends
 * straight into the running turn instead.
 */
export const COMPOSER_QUEUE_STORAGE_KEY = "t3code:composer-queue:v1";
const COMPOSER_QUEUE_STORAGE_VERSION = 1;

export const ComposerQueueEntryStatus = Schema.Literals(["queued", "sending", "failed"]);
export type ComposerQueueEntryStatus = typeof ComposerQueueEntryStatus.Type;

const ComposerQueueEntrySchema = Schema.Struct({
  id: Schema.String,
  threadKey: Schema.String,
  environmentId: Schema.String,
  threadId: Schema.String,
  createdAt: Schema.String,
  /** What the user typed; restored into the composer by Edit. */
  prompt: Schema.String,
  /** The fully formatted outgoing text (contexts appended, provider hints applied). */
  text: Schema.String,
  attachments: Schema.Array(PersistedComposerImageAttachment),
  /** Images that could not be kept (too large or unreadable). */
  droppedImageNames: Schema.Array(Schema.String),
  /** Images still being encoded; the entry must not be sent until this clears. */
  pendingImages: Schema.optionalKey(Schema.Boolean),
  status: ComposerQueueEntryStatus,
  error: Schema.optionalKey(Schema.String),
});
export type ComposerQueueEntry = typeof ComposerQueueEntrySchema.Type;

const PersistedComposerQueueState = Schema.Struct({
  entries: Schema.Array(ComposerQueueEntrySchema),
  /** Threads whose queue is paused (the user stopped the agent). */
  pausedThreadKeys: Schema.Array(Schema.String),
});
const decodePersistedComposerQueueState = Schema.decodeUnknownSync(PersistedComposerQueueState);

const baseStorage: StateStorage =
  typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();

function persistState(state: {
  entries: ReadonlyArray<ComposerQueueEntry>;
  pausedThreadKeys: ReadonlyArray<string>;
}): boolean {
  try {
    baseStorage.setItem(
      COMPOSER_QUEUE_STORAGE_KEY,
      JSON.stringify({ version: COMPOSER_QUEUE_STORAGE_VERSION, state }),
    );
    return true;
  } catch (error) {
    console.error("[COMPOSER-QUEUE] Could not persist queue (storage quota?).", error);
    return false;
  }
}

function readPersistedState(): {
  entries: ReadonlyArray<ComposerQueueEntry>;
  pausedThreadKeys: ReadonlyArray<string>;
} {
  try {
    const raw = baseStorage.getItem(COMPOSER_QUEUE_STORAGE_KEY);
    if (typeof raw !== "string" || raw.length === 0) return { entries: [], pausedThreadKeys: [] };
    const parsed: unknown = JSON.parse(raw);
    const state = (parsed as { state?: unknown } | null)?.state;
    if (!state) return { entries: [], pausedThreadKeys: [] };
    const decoded = decodePersistedComposerQueueState(state);
    return {
      // A reload mid-send loses the in-flight promise. The message may or
      // may not have reached the server, so ask the user instead of
      // silently sending it again.
      entries: decoded.entries.map((entry) =>
        entry.status === "sending"
          ? { ...entry, status: "failed" as const, error: "Interrupted by a reload. Send again?" }
          : entry.pendingImages
            ? {
                ...entry,
                pendingImages: false,
                status: "failed" as const,
                error: "Its images were lost in a reload. Edit to re-attach, or send without them.",
              }
            : entry,
      ),
      pausedThreadKeys: decoded.pausedThreadKeys,
    };
  } catch {
    return { entries: [], pausedThreadKeys: [] };
  }
}

export function composerQueueThreadKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `${environmentId}:${threadId}`;
}

interface ComposerQueueStoreState {
  entries: ReadonlyArray<ComposerQueueEntry>;
  pausedThreadKeys: ReadonlyArray<string>;
  /** Appends to the end of the thread's queue. Returns false when storage rejected the write. */
  enqueue: (entry: ComposerQueueEntry) => boolean;
  /** Removes and returns the entry (Edit and Remove both go through here). */
  take: (entryId: string) => ComposerQueueEntry | null;
  update: (entryId: string, patch: Partial<Omit<ComposerQueueEntry, "id">>) => void;
  clearThread: (threadKey: string) => void;
  setThreadPaused: (threadKey: string, paused: boolean) => void;
}

export const useComposerQueueStore = create<ComposerQueueStoreState>()((set, get) => {
  const initial = readPersistedState();
  const commit = (next: {
    entries: ReadonlyArray<ComposerQueueEntry>;
    pausedThreadKeys: ReadonlyArray<string>;
  }) => {
    set(() => next);
    return persistState(next);
  };
  return {
    entries: initial.entries,
    pausedThreadKeys: initial.pausedThreadKeys,
    enqueue: (entry) => {
      const { entries, pausedThreadKeys } = get();
      const nextEntries = [...entries, entry];
      const written = persistState({ entries: nextEntries, pausedThreadKeys });
      if (!written) return false;
      set(() => ({ entries: nextEntries }));
      return true;
    },
    take: (entryId) => {
      const { entries, pausedThreadKeys } = get();
      const entry = entries.find((candidate) => candidate.id === entryId) ?? null;
      if (!entry) return null;
      commit({
        entries: entries.filter((candidate) => candidate.id !== entryId),
        pausedThreadKeys,
      });
      return entry;
    },
    update: (entryId, patch) => {
      const { entries, pausedThreadKeys } = get();
      if (!entries.some((candidate) => candidate.id === entryId)) return;
      commit({
        entries: entries.map((candidate) => {
          if (candidate.id !== entryId) return candidate;
          // A status change back to "sending" or "queued" drops the old error.
          const { error: _previousError, ...rest } = candidate;
          return patch.status !== undefined && patch.status !== "failed"
            ? { ...rest, ...patch }
            : { ...candidate, ...patch };
        }),
        pausedThreadKeys,
      });
    },
    clearThread: (threadKey) => {
      const { entries, pausedThreadKeys } = get();
      commit({
        entries: entries.filter((candidate) => candidate.threadKey !== threadKey),
        pausedThreadKeys: pausedThreadKeys.filter((key) => key !== threadKey),
      });
    },
    setThreadPaused: (threadKey, paused) => {
      const { entries, pausedThreadKeys } = get();
      const isPaused = pausedThreadKeys.includes(threadKey);
      if (isPaused === paused) return;
      commit({
        entries,
        pausedThreadKeys: paused
          ? [...pausedThreadKeys, threadKey]
          : pausedThreadKeys.filter((key) => key !== threadKey),
      });
    },
  };
});

const EMPTY_ENTRIES: ReadonlyArray<ComposerQueueEntry> = [];

/** Stable per-thread slice: same array identity while the thread's entries are unchanged. */
export function selectComposerQueueEntriesForThread(
  threadKey: string | null,
): (state: ComposerQueueStoreState) => ReadonlyArray<ComposerQueueEntry> {
  let cachedSource: ReadonlyArray<ComposerQueueEntry> | null = null;
  let cachedResult: ReadonlyArray<ComposerQueueEntry> = EMPTY_ENTRIES;
  return (state) => {
    if (threadKey === null) return EMPTY_ENTRIES;
    if (state.entries === cachedSource) return cachedResult;
    cachedSource = state.entries;
    const next = state.entries.filter((entry) => entry.threadKey === threadKey);
    cachedResult = next.length === 0 ? EMPTY_ENTRIES : next;
    return cachedResult;
  };
}
