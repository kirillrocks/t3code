import type { OrchestrationMessage } from "@t3tools/contracts";

const MAX_TRANSCRIPT_CHARS = 80_000;
const OMITTED_MARKER = "[... earlier messages omitted ...]";

function formatSection(message: OrchestrationMessage): string | null {
  if (message.streaming || (message.role !== "user" && message.role !== "assistant")) {
    return null;
  }
  const text = message.text.trim();
  const attachments = message.attachments?.map((attachment) => attachment.name) ?? [];
  if (text.length === 0 && attachments.length === 0) return null;
  const attachmentLine = attachments.length > 0 ? `\n(attachments: ${attachments.join(", ")})` : "";
  return `${message.role === "user" ? "User" : "Assistant"}:\n${text}${attachmentLine}`;
}

/**
 * User/assistant transcript for the handoff summary. Keeps the first user
 * message (the original ask) and as much of the newest conversation as fits,
 * dropping the middle when the thread is long.
 */
export function formatThreadHandoffTranscript(
  messages: ReadonlyArray<OrchestrationMessage>,
): string {
  const sections = messages.flatMap((message) => {
    const formatted = formatSection(message);
    return formatted === null ? [] : [formatted];
  });
  if (sections.length === 0) return "";
  const first = sections[0]!;
  const head = first.length > 8_000 ? `${first.slice(0, 8_000)}\n[... truncated ...]` : first;
  let budget = MAX_TRANSCRIPT_CHARS - head.length - OMITTED_MARKER.length - 4;
  const tail: string[] = [];
  for (let index = sections.length - 1; index >= 1; index -= 1) {
    const section = sections[index]!;
    if (section.length + 2 > budget) break;
    tail.unshift(section);
    budget -= section.length + 2;
  }
  const omitted = tail.length < sections.length - 1;
  return [head, ...(omitted ? [OMITTED_MARKER] : []), ...tail].join("\n\n");
}
