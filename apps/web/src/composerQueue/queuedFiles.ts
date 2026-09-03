import type { ComposerQueueEntry } from "../composerQueueStore";
import { releasePersistedAttachmentUpload } from "../lib/attachmentUploadQueue";

/**
 * Drops the server-side uploads a queue entry still owns. Call it whenever
 * an entry leaves the queue without being sent (Remove, Clear all); a sent
 * entry's uploads belong to the message and are released by the dispatcher.
 */
export function releaseQueuedEntryFiles(entry: ComposerQueueEntry): void {
  for (const file of entry.files ?? []) {
    releasePersistedAttachmentUpload({
      id: file.id,
      environmentId: file.environmentId,
      attachmentId: file.attachmentId,
    });
  }
}
