import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ChatAttachment,
  type EnvironmentId,
  type MessageId,
  type ThreadId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { useCallback, useRef } from "react";

import { hydrateImagesFromPersisted } from "../composerDraftStore";
import { useComposerQueueStore, type ComposerQueueEntry } from "../composerQueueStore";
import { readFileAsDataUrl } from "../components/ChatView.logic";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseAttachmentUpload,
  releasePersistedAttachmentUpload,
  startAttachmentUpload,
  verifyStashedAttachmentUpload,
} from "../lib/attachmentUploadQueue";
import { readThreadShell, useServerConfigs } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not send the queued message.";
}

/**
 * Sends one queued entry as a normal turn on its thread. Shared by the
 * drain (automatic, when the thread goes idle) and the panel's "Send now"
 * (manual, steers a running turn). The entry leaves the queue only after
 * the server accepted the turn; a failure keeps it at the head, marked
 * failed, so nothing behind it can jump the line.
 */
export function useComposerQueueDispatcher() {
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const serverConfigs = useServerConfigs();
  const inFlightRef = useRef(new Set<string>());

  return useCallback(
    async (entryId: string): Promise<boolean> => {
      const store = useComposerQueueStore.getState();
      const entry = store.entries.find((candidate) => candidate.id === entryId);
      if (!entry || inFlightRef.current.has(entryId)) return false;
      inFlightRef.current.add(entryId);
      store.update(entryId, { status: "sending" });
      const environmentId = entry.environmentId as EnvironmentId;
      const threadId = entry.threadId as ThreadId;
      const images = hydrateImagesFromPersisted(entry.attachments);
      const files = entry.files ?? [];
      try {
        const attachments = await resolveAttachments({
          environmentId,
          images,
          supportsUploads:
            serverConfigs.get(environmentId)?.environment.capabilities.attachmentUploads === true,
        });
        // Pending uploads are swept after a day; ask before pointing a
        // message at one that is gone.
        for (const file of files) {
          const verification = await verifyStashedAttachmentUpload({
            environmentId,
            attachmentId: file.attachmentId,
          });
          if (verification.status === "missing") {
            throw new Error(
              `The upload for ${file.name} expired (uploads are kept for a day). Edit and attach it again.`,
            );
          }
          if (verification.status === "failed") {
            throw new Error(`Could not check the upload for ${file.name}. Send again.`);
          }
          attachments.push({
            type: "file",
            id: file.attachmentId,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
          });
        }
        const shell = readThreadShell(scopeThreadRef(environmentId, threadId));
        const result = await startThreadTurn({
          environmentId,
          input: {
            threadId,
            message: {
              messageId: entry.id as MessageId,
              role: "user",
              text: entry.text,
              attachments,
            },
            ...(shell?.modelSelection ? { modelSelection: shell.modelSelection } : {}),
            runtimeMode: shell?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
            interactionMode: shell?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
            createdAt: new Date().toISOString(),
          },
        });
        if (result._tag === "Failure") {
          throw squashAtomCommandFailure(result);
        }
        for (const image of images) releaseAttachmentUpload(image.id);
        // The message owns the bytes now; drop the pending copies.
        for (const file of files) {
          releasePersistedAttachmentUpload({
            id: file.id,
            environmentId,
            attachmentId: file.attachmentId,
          });
        }
        useComposerQueueStore.getState().take(entryId);
        return true;
      } catch (error) {
        useComposerQueueStore
          .getState()
          .update(entryId, { status: "failed", error: errorMessage(error) });
        return false;
      } finally {
        inFlightRef.current.delete(entryId);
      }
    },
    [serverConfigs, startThreadTurn],
  );
}

async function resolveAttachments(input: {
  readonly environmentId: EnvironmentId;
  readonly images: ReturnType<typeof hydrateImagesFromPersisted>;
  readonly supportsUploads: boolean;
}): Promise<Array<ChatAttachment | UploadChatAttachment>> {
  if (input.images.length === 0) return [];
  if (input.supportsUploads) {
    for (const image of input.images) {
      startAttachmentUpload({ environmentId: input.environmentId, image });
    }
    await awaitAttachmentUploads(input.images.map((image) => image.id));
    const uploaded = getUploadedAttachments({
      environmentId: input.environmentId,
      images: input.images,
    });
    if (uploaded === null) {
      throw new Error("An image upload failed. Send again or remove the message.");
    }
    return uploaded;
  }
  return Promise.all(
    input.images.map(async (image) => ({
      type: "image" as const,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: await readFileAsDataUrl(image.file),
    })),
  );
}

export type ComposerQueueDispatch = ReturnType<typeof useComposerQueueDispatcher>;
export type { ComposerQueueEntry };
