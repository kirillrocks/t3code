import type { ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftStore, type DraftId } from "./composerDraftStore";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readThreadDetail } from "./state/entities";
import { environmentThreadDetails } from "./state/threads";
import { buildThreadHandoffPrompt } from "./threadHandoff";

async function waitForThreadDetail(
  threadRef: ScopedThreadRef,
  timeoutMs = 10_000,
): Promise<NonNullable<ReturnType<typeof readThreadDetail>> | null> {
  const existing = readThreadDetail(threadRef);
  if (existing !== null) {
    return existing;
  }

  const detailAtom = environmentThreadDetails.detailAtom(threadRef);
  return await new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    let unsubscribe = () => {};
    const finish = (detail: NonNullable<ReturnType<typeof readThreadDetail>> | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(detail);
    };

    unsubscribe = appAtomRegistry.subscribe(detailAtom, (detail) => {
      if (detail !== null) {
        finish(detail);
      }
    });
    // Atom registries are allowed to synchronously deliver the current value
    // during subscribe. In that case finish ran before subscribe returned,
    // so perform the deferred cleanup now that we have the real disposer.
    if (settled) {
      unsubscribe();
      return;
    }

    const loaded = readThreadDetail(threadRef);
    if (loaded !== null) {
      finish(loaded);
      return;
    }

    timeoutId = globalThis.setTimeout(() => finish(null), timeoutMs);
  });
}

/** Shown in the new draft while the summary model is still writing. */
export const THREAD_HANDOFF_PENDING_PROMPT =
  "Writing a summary of the previous conversation… (a few seconds; you can pick the provider or account meanwhile)";

export function buildThreadSummaryHandoffPrompt(input: {
  readonly sourceTitle: string;
  readonly summary: string;
}): string {
  const sourceTitle = input.sourceTitle.replace(/\s+/g, " ").trim().slice(0, 500);
  return [
    `We continue a conversation from another thread ("${sourceTitle}").`,
    "Here is a summary of what happened so far, written by a helper model:",
    "",
    input.summary.trim(),
    "",
    "Continue from here. Check the current state of the files before changing anything, and do not redo work that is already done.",
  ].join("\n");
}

type ContinueThreadResult =
  | { readonly ok: true; readonly mode: "summary" | "transcript" }
  | { readonly ok: false; readonly error: unknown };

/**
 * Continue a thread's work in a new draft. The draft opens right away with a
 * placeholder while a cheap model summarizes the source thread; the summary
 * then replaces the placeholder. If the summary fails (no text-generation
 * provider, limit hit), the recent transcript is pasted in instead.
 */
export async function continueThreadInNewDraft(input: {
  readonly threadRef: ScopedThreadRef;
  readonly createDraft: () => Promise<{ readonly draftId: DraftId } | null>;
  /** Server-side summary of the source thread; null or a throw means "use the transcript". */
  readonly summarize?: () => Promise<string | null>;
}): Promise<ContinueThreadResult> {
  const sourceThread = await waitForThreadDetail(input.threadRef);
  if (sourceThread === null) {
    return { ok: false, error: new Error("Conversation context could not be loaded.") };
  }

  const transcriptPrompt = buildThreadHandoffPrompt({
    sourceTitle: sourceThread.title,
    messages: sourceThread.messages,
  });
  if (transcriptPrompt === null) {
    return {
      ok: false,
      error: new Error("The thread does not have completed conversation context yet."),
    };
  }

  try {
    const destination = await input.createDraft();
    if (destination === null) {
      return { ok: false, error: new Error("The source project is no longer available.") };
    }
    const drafts = useComposerDraftStore.getState();
    // Sidebar actions can target a thread other than the one currently open.
    // Override the generic new-thread carry state with the actual source
    // thread before the user optionally picks a different provider.
    drafts.setModelSelection(destination.draftId, sourceThread.modelSelection, {
      replaceOptions: true,
    });
    drafts.setRuntimeMode(destination.draftId, sourceThread.runtimeMode);
    drafts.setInteractionMode(destination.draftId, sourceThread.interactionMode);
    if (!input.summarize) {
      drafts.setPrompt(destination.draftId, transcriptPrompt);
      return { ok: true, mode: "transcript" };
    }

    drafts.setPrompt(destination.draftId, THREAD_HANDOFF_PENDING_PROMPT);
    let summary: string | null = null;
    try {
      summary = await input.summarize();
    } catch {
      summary = null;
    }
    const prompt =
      summary && summary.trim().length > 0
        ? buildThreadSummaryHandoffPrompt({ sourceTitle: sourceThread.title, summary })
        : transcriptPrompt;
    // The user may have started typing while the summary was written; keep
    // their text below the handoff instead of wiping it.
    const current =
      useComposerDraftStore.getState().getComposerDraft(destination.draftId)?.prompt ?? "";
    const typed = current === THREAD_HANDOFF_PENDING_PROMPT ? "" : current.trim();
    useComposerDraftStore
      .getState()
      .setPrompt(destination.draftId, typed.length > 0 ? `${prompt}\n\n${typed}` : prompt);
    return { ok: true, mode: summary ? "summary" : "transcript" };
  } catch (error) {
    return { ok: false, error };
  }
}
