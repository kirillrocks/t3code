import {
  ClockIcon,
  ImageIcon,
  PencilIcon,
  PlayIcon,
  SendHorizontalIcon,
  XIcon,
} from "lucide-react";
import { memo, useState } from "react";

import { cn } from "~/lib/utils";
import type { ComposerQueueEntry } from "../../composerQueueStore";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

/** How many cards peek out behind the front one while collapsed. */
const PEEK_LIMIT = 2;
const PEEK_OFFSET_PX = 6;

/**
 * Stored messages waiting for the agent to finish, stacked like
 * notifications: the next message to send sits in front, the rest peek out
 * behind it. Hover (or focus) fans the stack out so every message and its
 * actions are reachable. Text is one line while stacked, two when fanned.
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
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  if (entries.length === 0) return null;
  const expanded = hovered || focused || entries.length === 1;
  const peekCount = Math.min(PEEK_LIMIT, entries.length - 1);
  return (
    <div
      data-composer-queue="true"
      data-expanded={expanded ? "true" : "false"}
      className="mx-auto mb-2 flex w-full max-w-3xl flex-col gap-1 px-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
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
          <span className="hidden sm:inline">Ctrl+Enter sends now</span>
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
      {expanded ? (
        <ol className="flex flex-col gap-1.5">
          {entries.map((entry, index) => (
            <QueueCard
              key={entry.id}
              entry={entry}
              index={index}
              expanded
              onSendNow={onSendNow}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </ol>
      ) : (
        <ol
          className="relative"
          style={{ paddingBottom: peekCount * PEEK_OFFSET_PX }}
          aria-label={`${entries.length} queued messages, hover to show all`}
        >
          {/* Peeking edges render first so the front card paints on top. */}
          {entries.slice(1, 1 + peekCount).map((entry, index) => (
            <li
              key={entry.id}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-full rounded-xl border border-border/60 bg-card/70 shadow-xs"
              style={{
                transform: `translateY(${(index + 1) * PEEK_OFFSET_PX}px) scale(${1 - (index + 1) * 0.03})`,
                zIndex: peekCount - index,
                opacity: 1 - (index + 1) * 0.25,
              }}
            />
          ))}
          <QueueCard
            entry={entries[0]!}
            index={0}
            expanded={false}
            onSendNow={onSendNow}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        </ol>
      )}
    </div>
  );
});

const QueueCard = memo(function QueueCard(props: {
  entry: ComposerQueueEntry;
  index: number;
  expanded: boolean;
  onSendNow: (entry: ComposerQueueEntry) => void;
  onEdit: (entry: ComposerQueueEntry) => void;
  onRemove: (entry: ComposerQueueEntry) => void;
}) {
  const { entry, index, expanded, onSendNow, onEdit, onRemove } = props;
  const busy = entry.status === "sending" || entry.pendingImages === true;
  const imageCount = entry.imageCount ?? entry.attachments.length;
  const text = entry.prompt.trim().replace(/\s+/g, " ");
  return (
    <li
      className={cn(
        "group/queue-card relative z-10 flex items-center gap-2.5 rounded-xl border px-3 py-1.5",
        "border-border/70 bg-card/90 shadow-xs backdrop-blur-sm",
        entry.status === "failed" && "border-destructive/40",
      )}
    >
      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-muted px-1 text-[11px] font-medium tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p
          className={cn(
            "min-w-0 text-[13px] leading-5 text-foreground",
            expanded ? "line-clamp-2" : "truncate",
          )}
        >
          {text.length > 0 ? text : <span className="text-muted-foreground">(no text)</span>}
        </p>
        {imageCount > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <ImageIcon className="size-3" aria-hidden="true" />
            {imageCount === 1 ? "1 image" : `${imageCount} images`}
            {entry.pendingImages ? "…" : null}
          </span>
        ) : null}
        {entry.status === "failed" ? (
          <span className="min-w-0 shrink truncate text-[11px] text-destructive">
            {entry.error ?? "Could not send."}
          </span>
        ) : null}
      </div>
      <span
        className={cn(
          "flex shrink-0 items-center gap-0.5",
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
