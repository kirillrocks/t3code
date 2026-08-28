import { ListOrderedIcon, PencilIcon, PlayIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { composerQueueEntrySnippet } from "../../composerQueue/composerQueue.logic";
import type { ComposerQueueEntry } from "../../composerQueueStore";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

/**
 * Messages waiting for the agent to finish, docked above the composer. One
 * line per message in send order. Hover a row for Send now / Edit / Remove.
 * A failed head stops the queue and says why; a paused queue (the user hit
 * Stop) shows Resume.
 */
export const ComposerQueuePanel = memo(function ComposerQueuePanel(props: {
  entries: ReadonlyArray<ComposerQueueEntry>;
  paused: boolean;
  onSendNow: (entry: ComposerQueueEntry) => void;
  onEdit: (entry: ComposerQueueEntry) => void;
  onRemove: (entry: ComposerQueueEntry) => void;
  onClear: () => void;
  onResume: () => void;
}) {
  const { entries, paused, onSendNow, onEdit, onRemove, onClear, onResume } = props;
  if (entries.length === 0) return null;
  return (
    <div
      data-composer-queue="true"
      className="chat-composer-drawer-surface chat-composer-drawer-attached mb-2 rounded-[14px] px-2 pb-1 pt-1.5"
    >
      <div className="flex h-6 items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <ListOrderedIcon className="size-3 shrink-0" aria-hidden="true" />
        <span className="font-medium">Queued · {entries.length}</span>
        {paused ? (
          <>
            <span className="text-warning">Paused</span>
            <Button
              size="micro"
              variant="ghost-muted"
              className="gap-1 px-1.5"
              onPointerDown={(event) => event.preventDefault()}
              onClick={onResume}
            >
              <PlayIcon className="size-3" aria-hidden="true" />
              Resume
            </Button>
          </>
        ) : (
          <span className="hidden sm:inline">
            sends one by one after the agent finishes · Ctrl+Enter sends now
          </span>
        )}
        <Button
          size="micro"
          variant="ghost-muted"
          className="ml-auto px-1.5"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
      <ol className="flex flex-col">
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            className={cn(
              "group/queue-row flex min-h-7 items-center gap-2 rounded-md px-1 py-0.5",
              "hover:bg-accent/50 focus-within:bg-accent/50",
            )}
          >
            <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                entry.status === "failed" ? "text-foreground" : "text-foreground/90",
              )}
            >
              {composerQueueEntrySnippet(entry)}
            </span>
            {entry.status === "sending" || entry.pendingImages ? (
              <Spinner className="size-3 shrink-0 text-muted-foreground" aria-label="Sending" />
            ) : entry.status === "failed" ? (
              <span className="max-w-[40%] shrink truncate text-[11px] text-destructive">
                {entry.error ?? "Failed"}
              </span>
            ) : null}
            <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/queue-row:opacity-100 focus-within:opacity-100">
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label={entry.status === "failed" ? "Send again" : "Send now"}
                disabled={entry.status === "sending" || entry.pendingImages === true}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onSendNow(entry)}
              >
                <SendHorizontalIcon className="size-3" aria-hidden="true" />
              </Button>
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label="Edit in composer"
                disabled={entry.status === "sending"}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onEdit(entry)}
              >
                <PencilIcon className="size-3" aria-hidden="true" />
              </Button>
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label="Remove from queue"
                disabled={entry.status === "sending"}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onRemove(entry)}
              >
                <XIcon className="size-3" aria-hidden="true" />
              </Button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
});
