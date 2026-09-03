import type { OrchestrationThreadShell } from "@t3tools/contracts";
import { hasQueuedTurnStart } from "@t3tools/client-runtime/state/thread-settled";

import type { ComposerQueueEntry } from "../composerQueueStore";

export type ComposerQueueThreadShell = Pick<
  OrchestrationThreadShell,
  "session" | "hasPendingApprovals" | "hasPendingUserInput" | "latestUserMessageAt" | "latestTurn"
>;

/**
 * True while the agent still owns the thread: a turn is running or starting,
 * a message is waiting to be picked up, or the agent is waiting on the user
 * (approval / question). Queued messages must not go out in any of these.
 */
export function isThreadBusyForQueue(
  shell: ComposerQueueThreadShell,
  options: { readonly now: string },
): boolean {
  const status = shell.session?.status;
  if (status === "running" || status === "starting") return true;
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return true;
  return hasQueuedTurnStart(shell, options);
}

/**
 * The next entry to send for one thread, or null. Only the head of the
 * queue is ever eligible: a failed head blocks the rest until the user
 * removes or resends it, so messages never run out of order.
 */
export function resolveNextComposerQueueEntry(input: {
  readonly shell: ComposerQueueThreadShell | null;
  readonly entries: ReadonlyArray<ComposerQueueEntry>;
  readonly paused: boolean;
  readonly now: string;
}): ComposerQueueEntry | null {
  const head = input.entries[0];
  if (!head || input.paused || !input.shell) return null;
  if (head.status !== "queued" || head.pendingImages || head.pendingFiles) return null;
  if (isThreadBusyForQueue(input.shell, { now: input.now })) return null;
  return head;
}

const SNIPPET_MAX_CHARS = 120;

export function composerQueueEntrySnippet(
  entry: Pick<ComposerQueueEntry, "prompt" | "attachments">,
) {
  const trimmed = entry.prompt.trim().replace(/\s+/g, " ");
  if (trimmed.length > 0) {
    return trimmed.length > SNIPPET_MAX_CHARS ? `${trimmed.slice(0, SNIPPET_MAX_CHARS)}…` : trimmed;
  }
  const imageCount = entry.attachments.length;
  return imageCount > 0 ? `(${imageCount} image${imageCount === 1 ? "" : "s"})` : "(empty)";
}
