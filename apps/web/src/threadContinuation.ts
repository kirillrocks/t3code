import type {
  ModelSelection,
  ProviderInstanceId,
  ScopedThreadRef,
  ServerProvider,
} from "@t3tools/contracts";

import { useComposerDraftStore, type DraftId } from "./composerDraftStore";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readThreadDetail } from "./state/entities";
import { environmentThreadDetails } from "./state/threads";
import { buildThreadHandoffPrompt } from "./threadHandoff";
import {
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
  getProviderInstanceEntry,
} from "./providerInstances";

export interface ContinueThreadTarget {
  readonly instanceId: ProviderInstanceId;
  readonly label: string;
}

/**
 * Other providers/accounts the conversation could continue on: every enabled,
 * installed, available instance in the environment except the source one.
 * Used for the "Continue in new thread → with …" submenu.
 */
export function resolveContinueThreadTargets(
  providers: ReadonlyArray<ServerProvider>,
  sourceInstanceId: ProviderInstanceId | null,
): ReadonlyArray<ContinueThreadTarget> {
  return deriveProviderInstanceEntries(providers)
    .filter(
      (entry) =>
        entry.enabled &&
        entry.installed &&
        entry.isAvailable &&
        entry.instanceId !== sourceInstanceId,
    )
    .map((entry) => ({ instanceId: entry.instanceId, label: entry.displayName }));
}

/**
 * Model selection for the target instance: same driver keeps the model and
 * options (another account of the same tool), another driver takes that
 * instance's default model.
 */
export function resolveContinueThreadModelSelection(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly source: ModelSelection;
  readonly targetInstanceId: ProviderInstanceId;
}): ModelSelection {
  const source = getProviderInstanceEntry(input.providers, input.source.instanceId);
  const target = getProviderInstanceEntry(input.providers, input.targetInstanceId);
  if (source && target && source.driverKind === target.driverKind) {
    return { ...input.source, instanceId: input.targetInstanceId };
  }
  const model =
    getDefaultProviderInstanceModel(input.providers, input.targetInstanceId) ?? input.source.model;
  return { instanceId: input.targetInstanceId, model };
}

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

type ContinueThreadResult = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

export async function continueThreadInNewDraft(input: {
  readonly threadRef: ScopedThreadRef;
  readonly createDraft: () => Promise<{ readonly draftId: DraftId } | null>;
  /** Continue on another provider/account instead of the source one. */
  readonly target?: {
    readonly instanceId: ProviderInstanceId;
    readonly providers: ReadonlyArray<ServerProvider>;
  };
}): Promise<ContinueThreadResult> {
  const sourceThread = await waitForThreadDetail(input.threadRef);
  if (sourceThread === null) {
    return { ok: false, error: new Error("Conversation context could not be loaded.") };
  }

  const prompt = buildThreadHandoffPrompt({
    sourceTitle: sourceThread.title,
    messages: sourceThread.messages,
  });
  if (prompt === null) {
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
    const modelSelection = input.target
      ? resolveContinueThreadModelSelection({
          providers: input.target.providers,
          source: sourceThread.modelSelection,
          targetInstanceId: input.target.instanceId,
        })
      : sourceThread.modelSelection;
    drafts.setModelSelection(destination.draftId, modelSelection, {
      replaceOptions: true,
    });
    drafts.setRuntimeMode(destination.draftId, sourceThread.runtimeMode);
    drafts.setInteractionMode(destination.draftId, sourceThread.interactionMode);
    drafts.setPrompt(destination.draftId, prompt);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
