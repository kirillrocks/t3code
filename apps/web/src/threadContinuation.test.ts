import {
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const drafts = vi.hoisted(() => ({
  setModelSelection: vi.fn(),
  setRuntimeMode: vi.fn(),
  setInteractionMode: vi.fn(),
  setPrompt: vi.fn(),
}));

vi.mock("./composerDraftStore", () => ({
  useComposerDraftStore: { getState: () => drafts },
}));
vi.mock("./state/entities", () => ({ readThreadDetail: vi.fn() }));
vi.mock("./state/threads", () => ({
  environmentThreadDetails: { detailAtom: vi.fn(() => Symbol("detail")) },
}));
vi.mock("./rpc/atomRegistry", () => ({
  appAtomRegistry: { subscribe: vi.fn() },
}));

import type { DraftId } from "./composerDraftStore";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readThreadDetail } from "./state/entities";
import { continueThreadInNewDraft } from "./threadContinuation";

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const draftId = "draft-1" as DraftId;

function message(role: OrchestrationMessage["role"], text: string): OrchestrationMessage {
  return {
    id: MessageId.make(`message-${role}`),
    role,
    text,
    turnId: TurnId.make("turn-1"),
    streaming: false,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

function sourceThread(messages: ReadonlyArray<OrchestrationMessage>) {
  return {
    title: "Source thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("claude"),
      model: "claude-opus-5",
      options: [{ id: "effort", value: "high" }],
    },
    runtimeMode: "full-access" as const,
    interactionMode: "plan" as const,
    messages,
  } as unknown as NonNullable<ReturnType<typeof readThreadDetail>>;
}

describe("continueThreadInNewDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a draft with source context and source provider state", async () => {
    vi.mocked(readThreadDetail).mockReturnValue(
      sourceThread([message("user", "Diagnose it"), message("assistant", "Found the cause")]),
    );
    const createDraft = vi.fn(async () => ({ draftId }));

    const result = await continueThreadInNewDraft({ threadRef, createDraft });

    expect(result).toEqual({ ok: true });
    expect(createDraft).toHaveBeenCalledOnce();
    expect(drafts.setModelSelection).toHaveBeenCalledWith(
      draftId,
      expect.objectContaining({ instanceId: "claude", model: "claude-opus-5" }),
      { replaceOptions: true },
    );
    expect(drafts.setRuntimeMode).toHaveBeenCalledWith(draftId, "full-access");
    expect(drafts.setInteractionMode).toHaveBeenCalledWith(draftId, "plan");
    expect(drafts.setPrompt).toHaveBeenCalledWith(
      draftId,
      expect.stringContaining("### Assistant\n\nFound the cause"),
    );
  });

  it("loads uncached thread detail through the subscribed atom", async () => {
    const source = sourceThread([message("user", "Load this context")]);
    vi.mocked(readThreadDetail).mockReturnValue(null);
    const dispose = vi.fn();
    vi.mocked(appAtomRegistry.subscribe).mockImplementation((_atom, listener) => {
      listener(source);
      return dispose;
    });

    const result = await continueThreadInNewDraft({
      threadRef,
      createDraft: async () => ({ draftId }),
    });

    expect(result).toEqual({ ok: true });
    expect(dispose).toHaveBeenCalledOnce();
    expect(drafts.setPrompt).toHaveBeenCalledWith(
      draftId,
      expect.stringContaining("Load this context"),
    );
  });

  it("does not create a draft when no completed portable context exists", async () => {
    vi.mocked(readThreadDetail).mockReturnValue(sourceThread([message("system", "hidden")]));
    const createDraft = vi.fn(async () => ({ draftId }));

    const result = await continueThreadInNewDraft({ threadRef, createDraft });

    expect(result).toMatchObject({ ok: false });
    expect(createDraft).not.toHaveBeenCalled();
    expect(drafts.setPrompt).not.toHaveBeenCalled();
  });

  it("reports a missing destination without mutating composer state", async () => {
    vi.mocked(readThreadDetail).mockReturnValue(sourceThread([message("user", "Continue")]));

    const result = await continueThreadInNewDraft({
      threadRef,
      createDraft: async () => null,
    });

    expect(result).toMatchObject({ ok: false });
    expect(drafts.setPrompt).not.toHaveBeenCalled();
  });
});
