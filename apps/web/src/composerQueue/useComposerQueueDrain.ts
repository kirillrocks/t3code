import { useEffect } from "react";

import { useComposerQueueStore } from "../composerQueueStore";
import { useThreadShells } from "../state/entities";
import { resolveNextComposerQueueEntry } from "./composerQueue.logic";
import { useComposerQueueDispatcher } from "./useComposerQueueDispatcher";

/**
 * Sends queued messages as their threads go idle. Mounted once in the chat
 * layout so a queue keeps draining while the user looks at another thread.
 * Re-runs on every shell change; the dispatcher ignores an entry that is
 * already in flight, and a "sending" head makes the thread ineligible until
 * the server reflects the new turn.
 */
export function useComposerQueueDrain(): void {
  const shells = useThreadShells();
  const entries = useComposerQueueStore((state) => state.entries);
  const pausedThreadKeys = useComposerQueueStore((state) => state.pausedThreadKeys);
  const dispatch = useComposerQueueDispatcher();

  useEffect(() => {
    if (entries.length === 0) return;
    const now = new Date().toISOString();
    const seenThreadKeys = new Set<string>();
    for (const entry of entries) {
      if (seenThreadKeys.has(entry.threadKey)) continue;
      seenThreadKeys.add(entry.threadKey);
      const shell =
        shells.find(
          (candidate) =>
            candidate.environmentId === entry.environmentId && candidate.id === entry.threadId,
        ) ?? null;
      const next = resolveNextComposerQueueEntry({
        shell,
        entries: entries.filter((candidate) => candidate.threadKey === entry.threadKey),
        paused: pausedThreadKeys.includes(entry.threadKey),
        now,
      });
      if (next) void dispatch(next.id);
    }
  }, [dispatch, entries, pausedThreadKeys, shells]);
}
