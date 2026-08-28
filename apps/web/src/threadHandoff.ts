import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS, type OrchestrationMessage } from "@t3tools/contracts";

export const THREAD_HANDOFF_MAX_CHARS = Math.min(
  80_000,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 1_000,
);

const OMITTED_MESSAGE_MARKER = "[Earlier conversation omitted to fit the provider input limit.]";
const OMITTED_TEXT_MARKER = "[Earlier content in this message omitted.]";

function formatMessage(message: OrchestrationMessage): string | null {
  if (message.streaming || (message.role !== "user" && message.role !== "assistant")) {
    return null;
  }

  const text = message.text.trim();
  const attachments = message.attachments?.map((attachment) => attachment.name) ?? [];
  if (text.length === 0 && attachments.length === 0) {
    return null;
  }

  const attachmentLine = attachments.length > 0 ? `\n\nAttachments: ${attachments.join(", ")}` : "";
  return `### ${message.role === "user" ? "User" : "Assistant"}\n\n${text}${attachmentLine}`;
}

function truncateSectionFromStart(section: string, maxChars: number): string {
  if (section.length <= maxChars) {
    return section;
  }

  const headingEnd = section.indexOf("\n\n");
  const heading = headingEnd >= 0 ? section.slice(0, headingEnd) : "### Message";
  const marker = `\n\n${OMITTED_TEXT_MARKER}\n\n`;
  const availableTail = Math.max(0, maxChars - heading.length - marker.length);
  return `${heading}${marker}${section.slice(-availableTail)}`;
}

export function buildThreadHandoffPrompt(input: {
  readonly sourceTitle: string;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
}): string | null {
  const sections = input.messages.flatMap((message) => {
    const formatted = formatMessage(message);
    return formatted === null ? [] : [formatted];
  });
  if (sections.length === 0) {
    return null;
  }

  const sourceTitle = input.sourceTitle.replace(/\s+/g, " ").trim().slice(0, 500);

  const header = [
    "Continue the work from another T3 Code thread using the recent conversation below as prior context.",
    "Re-check the current workspace before changing files because repository state may have moved on.",
    "Do not repeat work that is already complete unless verification requires it.",
    "",
    `Source thread: ${sourceTitle}`,
    "Attachment names are references only; ask the user to reattach anything you need to inspect.",
    "",
    "## Recent conversation",
    "",
  ].join("\n");

  const selected: string[] = [];
  // Reserve the omission marker up front. A long transcript is discovered
  // from newest to oldest, and trimming the final string would otherwise cut
  // the newest context to make room for the marker at the front.
  let remaining = THREAD_HANDOFF_MAX_CHARS - header.length - OMITTED_MESSAGE_MARKER.length - 2;
  let omitted = false;

  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index]!;
    const separatorLength = selected.length > 0 ? 2 : 0;
    if (section.length + separatorLength <= remaining) {
      selected.unshift(section);
      remaining -= section.length + separatorLength;
      continue;
    }

    omitted = true;
    if (selected.length === 0 && remaining > OMITTED_TEXT_MARKER.length + 20) {
      selected.unshift(truncateSectionFromStart(section, remaining));
    }
    break;
  }

  const omissionPrefix = omitted ? `${OMITTED_MESSAGE_MARKER}\n\n` : "";
  return `${header}${omissionPrefix}${selected.join("\n\n")}`;
}
