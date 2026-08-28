import { MessageId, TurnId, type OrchestrationMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadHandoffPrompt, THREAD_HANDOFF_MAX_CHARS } from "./threadHandoff";

function message(
  role: OrchestrationMessage["role"],
  text: string,
  options?: Partial<OrchestrationMessage>,
): OrchestrationMessage {
  return {
    id: MessageId.make(`message-${role}-${text.length}`),
    role,
    text,
    turnId: TurnId.make("turn-1"),
    streaming: false,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...options,
  };
}

describe("buildThreadHandoffPrompt", () => {
  it("formats portable user and assistant context", () => {
    const prompt = buildThreadHandoffPrompt({
      sourceTitle: "Fix the login flow",
      messages: [
        message("user", "Please diagnose the redirect."),
        message("assistant", "The callback drops the state parameter."),
      ],
    });

    expect(prompt).toContain("Source thread: Fix the login flow");
    expect(prompt).toContain("### User\n\nPlease diagnose the redirect.");
    expect(prompt).toContain("### Assistant\n\nThe callback drops the state parameter.");
  });

  it("normalizes and bounds the source title", () => {
    const prompt = buildThreadHandoffPrompt({
      sourceTitle: `  Multi\nline ${"x".repeat(1_000)}  `,
      messages: [message("user", "Continue")],
    });

    expect(prompt).toContain("Source thread: Multi line ");
    expect(prompt).not.toContain("Multi\nline");
    expect(prompt!.length).toBeLessThanOrEqual(THREAD_HANDOFF_MAX_CHARS);
  });

  it("ignores system, streaming, and empty messages", () => {
    const prompt = buildThreadHandoffPrompt({
      sourceTitle: "Source",
      messages: [
        message("system", "hidden instructions"),
        message("assistant", "partial response", { streaming: true }),
        message("user", "  "),
      ],
    });

    expect(prompt).toBeNull();
  });

  it("retains attachment names without trying to copy provider-local attachment data", () => {
    const prompt = buildThreadHandoffPrompt({
      sourceTitle: "Image review",
      messages: [
        message("user", "Review this screenshot", {
          attachments: [
            {
              type: "image",
              id: "attachment-1",
              name: "broken-layout.png",
              mimeType: "image/png",
              sizeBytes: 512,
            },
          ],
        }),
      ],
    });

    expect(prompt).toContain("Attachments: broken-layout.png");
  });

  it("keeps the newest context when the transcript exceeds the send limit", () => {
    const prompt = buildThreadHandoffPrompt({
      sourceTitle: "Large thread",
      messages: [
        message("user", `old-context-${"a".repeat(THREAD_HANDOFF_MAX_CHARS)}`),
        message("assistant", "newest-result"),
      ],
    });

    expect(prompt).not.toBeNull();
    expect(prompt!.length).toBeLessThanOrEqual(THREAD_HANDOFF_MAX_CHARS);
    expect(prompt).toContain("Earlier conversation omitted");
    expect(prompt).toContain("newest-result");
    expect(prompt).not.toContain("old-context");
  });

  it("truncates a single oversized recent message from the start", () => {
    const prompt = buildThreadHandoffPrompt({
      sourceTitle: "Large latest message",
      messages: [message("assistant", `old-prefix-${"z".repeat(THREAD_HANDOFF_MAX_CHARS)}-tail`)],
    });

    expect(prompt).not.toBeNull();
    expect(prompt!.length).toBeLessThanOrEqual(THREAD_HANDOFF_MAX_CHARS);
    expect(prompt).toContain("Earlier content in this message omitted");
    expect(prompt).toContain("-tail");
    expect(prompt).not.toContain("old-prefix");
  });
});
