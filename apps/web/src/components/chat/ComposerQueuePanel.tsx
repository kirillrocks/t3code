import {
  ClockIcon,
  ImageIcon,
  PencilIcon,
  PlayIcon,
  SendHorizontalIcon,
  XIcon,
} from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import type { ComposerQueueEntry } from "../../composerQueueStore";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

/**
 * Stored messages waiting for the agent to finish. Sits above the composer
 * as its own stack of cards, separate from the composer surface and the
 * conversation, so a queued message reads as "put aside", not "sent".
 * Each card shows the text, an "N images attached" note, and hover actions.
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
      className="mx-auto mb-3 flex w-full max-w-3xl flex-col gap-1.5 px-1"
    >
      <div className="flex h-5 items-center gap-2 px-1 text-[11px] text-muted-foreground">
        <ClockIcon className="size-3 shrink-0" aria-hidden="true" />
        <span className="font-medium text-foreground/80">
          {entries.length === 1 ? "1 message waiting" : `${entries.length} messages waiting`}
        </span>
        {paused ? (
          <>
            <span className="text-warning">Paused after Stop</span>
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
            Sent one by one when the agent finishes. Ctrl+Enter sends now.
          </span>
        )}
        <Button
          size="micro"
          variant="ghost-muted"
          className="ml-auto px-1.5"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onClear}
        >
          Clear all
        </Button>
      </div>
      <ol className="flex flex-col gap-1.5">
        {entries.map((entry, index) => (
          <QueueCard
            key={entry.id}
            entry={entry}
            index={index}
            onSendNow={onSendNow}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        ))}
      </ol>
    </div>
  );
});

const QueueCard = memo(function QueueCard(props: {
  entry: ComposerQueueEntry;
  index: number;
  onSendNow: (entry: ComposerQueueEntry) => void;
  onEdit: (entry: ComposerQueueEntry) => void;
  onRemove: (entry: ComposerQueueEntry) => void;
}) {
  const { entry, index, onSendNow, onEdit, onRemove } = props;
  const busy = entry.status === "sending" || entry.pendingImages === true;
  const imageCount = entry.imageCount ?? entry.attachments.length;
  const text = entry.prompt.trim();
  return (
    <li
      className={cn(
        "group/queue-card relative flex gap-3 rounded-xl border px-3 py-2",
        "border-border/70 bg-card/80 shadow-xs backdrop-blur-sm",
        entry.status === "failed" && "border-destructive/40",
      )}
    >
      <span className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-muted px-1 text-[11px] font-medium tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {text.length > 0 ? (
          <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-5 text-foreground">
            {text}
          </p>
        ) : null}
        {imageCount > 0 ? (
          <span className="inline-flex w-fit items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <ImageIcon className="size-3" aria-hidden="true" />
            {imageCount === 1 ? "1 image attached" : `${imageCount} images attached`}
            {entry.pendingImages ? " (saving…)" : null}
            {entry.droppedImageNames.length > 0
              ? ` · ${entry.droppedImageNames.length} too large, not kept`
              : null}
          </span>
        ) : null}
        {entry.status === "failed" ? (
          <p className="text-[11px] text-destructive">{entry.error ?? "Could not send."}</p>
        ) : null}
      </div>
      <span
        className={cn(
          "flex shrink-0 items-start gap-0.5 self-start",
          "opacity-0 transition-opacity group-hover/queue-card:opacity-100 focus-within:opacity-100",
          entry.status === "failed" && "opacity-100",
        )}
      >
        {entry.status === "sending" ? (
          <Spinner className="m-1 size-3 text-muted-foreground" aria-label="Sending" />
        ) : (
          <>
            <Button
              size="micro"
              variant="ghost-muted"
              className="gap-1 px-1.5"
              aria-label={entry.status === "failed" ? "Send again" : "Send now"}
              disabled={busy}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onSendNow(entry)}
            >
              <SendHorizontalIcon className="size-3" aria-hidden="true" />
              {entry.status === "failed" ? "Send again" : "Send now"}
            </Button>
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label="Edit in composer"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onEdit(entry)}
            >
              <PencilIcon className="size-3" aria-hidden="true" />
            </Button>
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label="Remove from queue"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onRemove(entry)}
            >
              <XIcon className="size-3" aria-hidden="true" />
            </Button>
          </>
        )}
      </span>
    </li>
  );
});
