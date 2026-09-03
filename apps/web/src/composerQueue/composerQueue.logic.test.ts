import { describe, expect, it } from "vite-plus/test";

import type { ComposerQueueEntry } from "../composerQueueStore";
import {
  composerQueueEntrySnippet,
  isThreadBusyForQueue,
  resolveNextComposerQueueEntry,
  type ComposerQueueThreadShell,
} from "./composerQueue.logic";

const NOW = "2026-08-28T12:00:00.000Z";

function shell(overrides: Partial<ComposerQueueThreadShell> = {}): ComposerQueueThreadShell {
  return {
    session: {
      threadId: "thread-1",
      status: "ready",
      providerName: "claudeAgent",
      providerInstanceId: "claudeAgent",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: NOW,
    } as ComposerQueueThreadShell["session"],
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestUserMessageAt: "2026-08-28T11:00:00.000Z",
    latestTurn: {
      turnId: "turn-1",
      requestedAt: "2026-08-28T11:00:00.000Z",
      startedAt: "2026-08-28T11:00:01.000Z",
      completedAt: "2026-08-28T11:05:00.000Z",
    } as ComposerQueueThreadShell["latestTurn"],
    ...overrides,
  };
}

function entry(overrides: Partial<ComposerQueueEntry> = {}): ComposerQueueEntry {
  return {
    id: "entry-1",
    threadKey: "env:thread-1",
    environmentId: "env",
    threadId: "thread-1",
    createdAt: NOW,
    prompt: "also run the tests",
    text: "also run the tests",
    attachments: [],
    droppedImageNames: [],
    status: "queued",
    ...overrides,
  };
}

describe("isThreadBusyForQueue", () => {
  it("is idle when the last turn completed and nothing is pending", () => {
    expect(isThreadBusyForQueue(shell(), { now: NOW })).toBe(false);
  });

  it("is busy while a turn runs or starts", () => {
    for (const status of ["running", "starting"] as const) {
      expect(
        isThreadBusyForQueue(
          shell({
            session: { ...shell().session!, status } as ComposerQueueThreadShell["session"],
          }),
          { now: NOW },
        ),
      ).toBe(true);
    }
  });

  it("is busy while the agent waits on an approval or a question", () => {
    expect(isThreadBusyForQueue(shell({ hasPendingApprovals: true }), { now: NOW })).toBe(true);
    expect(isThreadBusyForQueue(shell({ hasPendingUserInput: true }), { now: NOW })).toBe(true);
  });

  it("is busy while a just-sent message waits for its turn", () => {
    // Message newer than every turn timestamp and inside the grace window.
    expect(
      isThreadBusyForQueue(shell({ latestUserMessageAt: "2026-08-28T11:59:30.000Z" }), {
        now: NOW,
      }),
    ).toBe(true);
  });

  it("is idle with no session at all", () => {
    expect(isThreadBusyForQueue(shell({ session: null }), { now: NOW })).toBe(false);
  });
});

describe("resolveNextComposerQueueEntry", () => {
  it("returns the head when the thread is idle", () => {
    const head = entry({ id: "a" });
    expect(
      resolveNextComposerQueueEntry({
        shell: shell(),
        entries: [head, entry({ id: "b" })],
        paused: false,
        now: NOW,
      }),
    ).toBe(head);
  });

  it("returns null while paused, busy, or without a shell", () => {
    const entries = [entry()];
    expect(
      resolveNextComposerQueueEntry({ shell: shell(), entries, paused: true, now: NOW }),
    ).toBeNull();
    expect(
      resolveNextComposerQueueEntry({
        shell: shell({ hasPendingApprovals: true }),
        entries,
        paused: false,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      resolveNextComposerQueueEntry({ shell: null, entries, paused: false, now: NOW }),
    ).toBeNull();
  });

  it("waits while the head's images are still encoding", () => {
    expect(
      resolveNextComposerQueueEntry({
        shell: shell(),
        entries: [entry({ pendingImages: true })],
        paused: false,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("waits while the head's files are still uploading", () => {
    expect(
      resolveNextComposerQueueEntry({
        shell: shell(),
        entries: [entry({ pendingFiles: true })],
        paused: false,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("never skips past a failed or in-flight head", () => {
    for (const status of ["failed", "sending"] as const) {
      expect(
        resolveNextComposerQueueEntry({
          shell: shell(),
          entries: [entry({ id: "a", status }), entry({ id: "b" })],
          paused: false,
          now: NOW,
        }),
      ).toBeNull();
    }
  });
});

describe("composerQueueEntrySnippet", () => {
  it("collapses whitespace and truncates long prompts", () => {
    expect(composerQueueEntrySnippet(entry({ prompt: "  fix\n\nthe   bug " }))).toBe("fix the bug");
    expect(composerQueueEntrySnippet(entry({ prompt: "x".repeat(200) }))).toHaveLength(121);
  });

  it("describes image-only entries", () => {
    expect(
      composerQueueEntrySnippet(
        entry({
          prompt: "",
          attachments: [
            { id: "i", name: "a.png", mimeType: "image/png", sizeBytes: 1, dataUrl: "data:" },
          ],
        }),
      ),
    ).toBe("(1 image)");
  });
});
