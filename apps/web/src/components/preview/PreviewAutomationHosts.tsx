"use client";

import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_AUTOMATION_OPERATIONS,
  type DesktopPreviewBridge,
  type EnvironmentId,
  type PreviewAutomationClickInput,
  type PreviewAutomationNavigateInput,
  type PreviewAutomationOpenInput,
  type PreviewAutomationResizeInput,
  type PreviewAutomationResizeResult,
  type PreviewAutomationSetColorSchemeInput,
  type PreviewAutomationSetColorSchemeResult,
  type PreviewAutomationHost as PreviewAutomationHostState,
  type PreviewAutomationRequest,
  type PreviewAutomationStatus,
  type PreviewRenderedViewportSize,
  type PreviewViewportSetting,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Atom } from "effect/unstable/reactivity";

import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  updatePreviewServerSnapshot,
} from "~/previewStateStore";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { resolveBrowserNavigationTarget } from "~/browser/browserTargetResolver";
import {
  readActiveBrowserRecordingTargets,
  startBrowserRecording,
  stopBrowserRecording,
} from "~/browser/browserRecording";
import { resolveBrowserRecordingStopTarget } from "~/browser/browserRecordingScope";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { browserDefaultOpenViewport, resolveBrowserDefaults } from "~/browser/browserDefaults";
import { runBrowserViewportMutation } from "~/browser/browserViewportActions";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { isElectron } from "~/env";
import { useEnvironments } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useAtomCommand } from "~/state/use-atom-command";

import { previewBridge } from "./previewBridge";
import {
  confirmPreviewAutomationClickDispatched,
  PreviewAutomationClickDeliveryUnconfirmedHostError,
  PreviewAutomationClickTimeoutHostError,
  PreviewAutomationOperationError,
  PreviewAutomationOverlayTimeoutError,
  PreviewAutomationRecordingNotActiveError,
  PreviewAutomationTabNotVisibleHostError,
  PreviewAutomationTargetUnavailableError,
  PreviewAutomationViewportTimeoutError,
} from "./previewAutomationErrors";
import {
  previewAutomationDefaultViewport,
  previewAutomationOpenNeedsOverlay,
  shouldOpenPreviewMiniPlayer,
} from "./previewAutomationOpenReadiness";
import {
  assertPreviewRuntimeCurrent,
  waitForNavigationReadiness,
} from "./previewNavigationReadiness";
import { createPreviewAutomationRequestConsumerAtom } from "./previewAutomationRequestConsumer";
import { createPreviewAutomationClientId } from "./previewAutomationClientId";
import {
  needsPreviewAutomationSessionSync,
  resolvePreviewAutomationOpenTab,
  resolvePreviewAutomationTarget,
} from "./previewAutomationTarget";
import { isPreviewViewportReady } from "./previewViewportReadiness";
import { shouldRollbackPreviewViewport } from "./previewViewportRollback";

const PREVIEW_PRESENTATION_SETTLE_TIMEOUT_MS = 500;
const PREVIEW_CLICK_REGISTRATION_POLL_MS = 16;
const PREVIEW_CLICK_RESPONSE_RESERVE_MS = 50;

export const isPreviewPresentationConfirmed = (
  runtimeTabId: string,
  bridge: DesktopPreviewBridge | null = previewBridge,
): boolean =>
  Boolean(
    useBrowserSurfaceStore.getState().byTabId[runtimeTabId]?.visible &&
    (!bridge?.setWebviewVisibility ||
      findPreviewWebview(runtimeTabId)?.getAttribute("data-preview-main-visible") === "true"),
  );

const waitForPreviewPresentation = async (runtimeTabId: string): Promise<void> => {
  const deadline = Date.now() + PREVIEW_PRESENTATION_SETTLE_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (isPreviewPresentationConfirmed(runtimeTabId)) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  }
};

const waitForDesktopOverlay = async (
  threadRef: ScopedThreadRef,
  requestId: string,
  tabId: string,
  runtimeTabId: string,
  operation: PreviewAutomationRequest["operation"],
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const state = assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, {
      operation,
      requestId,
    });
    if (state.desktopByTabId[tabId] && previewBridge) {
      const status = await previewBridge.automation.status(runtimeTabId);
      if (status.available) return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  throw new PreviewAutomationOverlayTimeoutError({
    requestId,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    timeoutMs,
  });
};

interface ExecutablePreviewWebview extends Element {
  readonly executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
}

const findPreviewWebview = (tabId: string): ExecutablePreviewWebview | null =>
  Array.from(document.querySelectorAll<ExecutablePreviewWebview>("webview[data-preview-tab]")).find(
    (candidate) => candidate.getAttribute("data-preview-tab") === tabId,
  ) ?? null;

const readPreviewWebviewRegistration = (
  webview: ExecutablePreviewWebview | null,
): { readonly attachmentId: string; readonly webContentsId: number } | null => {
  const attachmentId = webview?.getAttribute("data-preview-attachment-id")?.trim();
  const webContentsId = Number(webview?.getAttribute("data-preview-web-contents-id"));
  return attachmentId && Number.isInteger(webContentsId) && webContentsId > 0
    ? { attachmentId, webContentsId }
    : null;
};

type PreviewAutomationClickContext = Parameters<typeof confirmPreviewAutomationClickDispatched>[1];

interface PreviewAutomationClickTiming {
  readonly deadline: number;
  readonly timeoutMs: number;
}

const makePreviewClickTimeoutError = (
  context: PreviewAutomationClickContext,
  timing: PreviewAutomationClickTiming,
) => new PreviewAutomationClickTimeoutHostError({ ...context, timeoutMs: timing.timeoutMs });

const assertPreviewClickBeforeDeadline = (
  context: PreviewAutomationClickContext,
  timing: PreviewAutomationClickTiming,
): void => {
  if (performance.now() >= timing.deadline) {
    throw makePreviewClickTimeoutError(context, timing);
  }
};

const awaitPreviewClickStep = <A,>(
  start: () => Promise<A>,
  context: PreviewAutomationClickContext,
  timing: PreviewAutomationClickTiming,
  options?: {
    readonly invalidationSignal?: AbortSignal;
    readonly timeoutError?: () => Error;
  },
): Promise<A> => {
  assertPreviewClickBeforeDeadline(context, timing);
  if (options?.invalidationSignal?.aborted) {
    return Promise.reject(new PreviewAutomationTabNotVisibleHostError(context));
  }
  const remainingMs = timing.deadline - performance.now();
  return new Promise<A>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      options?.invalidationSignal?.removeEventListener("abort", onInvalidated);
      settle();
    };
    const onInvalidated = () =>
      finish(() => reject(new PreviewAutomationTabNotVisibleHostError(context)));
    const timeout = globalThis.setTimeout(
      () =>
        finish(() =>
          reject(options?.timeoutError?.() ?? makePreviewClickTimeoutError(context, timing)),
        ),
      remainingMs,
    );
    options?.invalidationSignal?.addEventListener("abort", onInvalidated, { once: true });
    if (options?.invalidationSignal?.aborted) {
      onInvalidated();
      return;
    }
    try {
      assertPreviewClickBeforeDeadline(context, timing);
      start().then(
        (value) => finish(() => resolve(value)),
        (cause) => finish(() => reject(cause)),
      );
    } catch (cause) {
      finish(() => reject(cause));
    }
  });
};

const waitForPreviewClickRegistrationPoll = (
  context: PreviewAutomationClickContext,
  timing: PreviewAutomationClickTiming,
  invalidationSignal?: AbortSignal,
): Promise<void> => {
  assertPreviewClickBeforeDeadline(context, timing);
  if (invalidationSignal?.aborted) {
    return Promise.reject(new PreviewAutomationTabNotVisibleHostError(context));
  }
  const remainingMs = timing.deadline - performance.now();
  const delayMs = Math.min(PREVIEW_CLICK_REGISTRATION_POLL_MS, remainingMs);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      invalidationSignal?.removeEventListener("abort", onInvalidated);
      settle();
    };
    const onInvalidated = () =>
      finish(() => reject(new PreviewAutomationTabNotVisibleHostError(context)));
    const timeout = globalThis.setTimeout(
      () =>
        finish(() => {
          if (delayMs === remainingMs) reject(makePreviewClickTimeoutError(context, timing));
          else resolve();
        }),
      delayMs,
    );
    invalidationSignal?.addEventListener("abort", onInvalidated, { once: true });
    if (invalidationSignal?.aborted) onInvalidated();
  });
};

const waitForDesktopOverlayBeforePreviewClick = async (
  threadRef: ScopedThreadRef,
  tabId: string,
  runtimeTabId: string,
  bridge: DesktopPreviewBridge,
  context: PreviewAutomationClickContext,
  timing: PreviewAutomationClickTiming,
): Promise<void> => {
  while (true) {
    assertPreviewClickBeforeDeadline(context, timing);
    const state = assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, context);
    if (state.desktopByTabId[tabId]) {
      const status = await awaitPreviewClickStep(
        () => bridge.automation.status(runtimeTabId),
        context,
        timing,
      );
      assertPreviewClickBeforeDeadline(context, timing);
      if (status.available) return;
    }
    await waitForPreviewClickRegistrationPoll(context, timing);
  }
};

export async function clickVisiblePreview(
  runtimeTabId: string,
  input: PreviewAutomationClickInput,
  bridge: DesktopPreviewBridge,
  context: PreviewAutomationClickContext,
  timing: PreviewAutomationClickTiming,
  assertRuntimeCurrent: () => void,
) {
  assertPreviewClickBeforeDeadline(context, timing);
  const presentation = useBrowserSurfaceStore.getState().byTabId[runtimeTabId];
  if (!presentation?.visible || presentation.owner === null) {
    throw new PreviewAutomationTabNotVisibleHostError(context);
  }

  const presentationOwner = presentation.owner;
  const webview = findPreviewWebview(runtimeTabId);
  const setWebviewVisibility = bridge.setWebviewVisibility;
  if (!webview || !setWebviewVisibility) {
    throw new PreviewAutomationTargetUnavailableError({
      ...context,
      bridgeAvailable: Boolean(setWebviewVisibility),
    });
  }

  let invalidated = false;
  let registration = readPreviewWebviewRegistration(webview);
  const invalidation = new AbortController();
  const presentationIsCurrent = () => {
    const currentPresentation = useBrowserSurfaceStore.getState().byTabId[runtimeTabId];
    return currentPresentation?.visible === true && currentPresentation.owner === presentationOwner;
  };
  const targetIsCurrent = () => {
    if (!registration) return false;
    const currentPresentation = useBrowserSurfaceStore.getState().byTabId[runtimeTabId];
    const currentWebview = findPreviewWebview(runtimeTabId);
    const currentRegistration = readPreviewWebviewRegistration(currentWebview);
    return (
      currentPresentation?.visible === true &&
      currentPresentation.owner === presentationOwner &&
      currentWebview === webview &&
      currentRegistration?.webContentsId === registration.webContentsId &&
      currentRegistration.attachmentId === registration.attachmentId
    );
  };
  const setCapturedWebviewHidden = () => {
    if (!registration) return Promise.resolve();
    webview.removeAttribute("data-preview-main-visible");
    return setWebviewVisibility(
      runtimeTabId,
      registration.webContentsId,
      registration.attachmentId,
      false,
    ).catch(() => undefined);
  };
  const assertRuntimeCurrentBeforeDispatch = () => {
    try {
      assertRuntimeCurrent();
    } catch (cause) {
      void setCapturedWebviewHidden();
      throw cause;
    }
  };
  const invalidate = () => {
    if (invalidated) return;
    invalidated = true;
    invalidation.abort();
    void setCapturedWebviewHidden();
  };
  const unsubscribe = useBrowserSurfaceStore.subscribe((state) => {
    const current = state.byTabId[runtimeTabId];
    if (!current?.visible || current.owner !== presentationOwner) invalidate();
  });

  try {
    assertRuntimeCurrentBeforeDispatch();
    while (!registration) {
      assertPreviewClickBeforeDeadline(context, timing);
      assertRuntimeCurrentBeforeDispatch();
      if (!presentationIsCurrent() || findPreviewWebview(runtimeTabId) !== webview) {
        invalidate();
        throw new PreviewAutomationTabNotVisibleHostError(context);
      }
      registration = readPreviewWebviewRegistration(webview);
      assertPreviewClickBeforeDeadline(context, timing);
      if (!registration) {
        await waitForPreviewClickRegistrationPoll(context, timing, invalidation.signal);
      }
    }
    const capturedRegistration = registration;
    assertPreviewClickBeforeDeadline(context, timing);
    assertRuntimeCurrentBeforeDispatch();
    if (!targetIsCurrent()) {
      invalidate();
      void setCapturedWebviewHidden();
      throw new PreviewAutomationTabNotVisibleHostError(context);
    }
    try {
      assertPreviewClickBeforeDeadline(context, timing);
      await awaitPreviewClickStep(
        () =>
          setWebviewVisibility(
            runtimeTabId,
            capturedRegistration.webContentsId,
            capturedRegistration.attachmentId,
            true,
          ),
        context,
        timing,
        { invalidationSignal: invalidation.signal },
      );
    } catch (cause) {
      if (!invalidated && targetIsCurrent()) {
        void setCapturedWebviewHidden();
        throw cause;
      }
      void setCapturedWebviewHidden();
      throw new PreviewAutomationTabNotVisibleHostError(context);
    }
    assertPreviewClickBeforeDeadline(context, timing);
    assertRuntimeCurrentBeforeDispatch();
    if (invalidated || !targetIsCurrent()) {
      invalidate();
      // This second false starts after the true acknowledgement, so a hide
      // during that acknowledgement cannot leave the old attachment visible.
      void setCapturedWebviewHidden();
      throw new PreviewAutomationTabNotVisibleHostError(context);
    }
    webview.setAttribute("data-preview-main-visible", "true");
    assertPreviewClickBeforeDeadline(context, timing);
    assertRuntimeCurrentBeforeDispatch();
    const result = await awaitPreviewClickStep(
      () =>
        bridge.automation.click(
          runtimeTabId,
          input,
          capturedRegistration.webContentsId,
          capturedRegistration.attachmentId,
        ),
      context,
      timing,
      {
        timeoutError: () => new PreviewAutomationClickDeliveryUnconfirmedHostError(context),
      },
    );
    if (result?._tag === "NotSent") {
      return confirmPreviewAutomationClickDispatched(result, context);
    }
    let runtimeIsCurrent = true;
    try {
      assertRuntimeCurrent();
    } catch {
      runtimeIsCurrent = false;
    }
    if (
      result?._tag === "Dispatched" &&
      (performance.now() >= timing.deadline ||
        invalidated ||
        !runtimeIsCurrent ||
        !targetIsCurrent())
    ) {
      throw new PreviewAutomationClickDeliveryUnconfirmedHostError(context);
    }
    return confirmPreviewAutomationClickDispatched(result, context);
  } finally {
    unsubscribe();
  }
}

const readWebviewViewport = async (
  webview: ExecutablePreviewWebview,
): Promise<PreviewRenderedViewportSize | null> => {
  const value = await webview.executeJavaScript(
    "({ width: window.innerWidth, height: window.innerHeight })",
  );
  if (typeof value !== "object" || value === null) return null;
  const { width, height } = value as { readonly width?: unknown; readonly height?: unknown };
  return typeof width === "number" &&
    Number.isInteger(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isInteger(height) &&
    height > 0
    ? { width, height }
    : null;
};

const readRenderedViewport = async (
  runtimeTabId: string,
): Promise<PreviewRenderedViewportSize | null> => {
  const webview = findPreviewWebview(runtimeTabId);
  if (!webview) return null;
  return await readWebviewViewport(webview);
};

const readDeclaredViewport = (
  webview: ExecutablePreviewWebview | null,
): PreviewRenderedViewportSize | null => {
  const width = Number(webview?.getAttribute("data-preview-css-width"));
  const height = Number(webview?.getAttribute("data-preview-css-height"));
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? { width, height }
    : null;
};

const waitForRenderedViewport = async (
  threadRef: ScopedThreadRef,
  tabId: string,
  runtimeTabId: string,
  setting: PreviewViewportSetting,
  timeoutMs: number,
  context: {
    readonly requestId: PreviewAutomationRequest["requestId"];
    readonly operation: PreviewAutomationRequest["operation"];
    readonly environmentId: EnvironmentId;
    readonly threadId: PreviewAutomationRequest["threadId"];
  },
): Promise<PreviewRenderedViewportSize> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, context);
    try {
      const webview = findPreviewWebview(runtimeTabId);
      const appliedSettingKey = webview?.getAttribute("data-preview-viewport-key") ?? null;
      const declaredViewport = readDeclaredViewport(webview);
      const renderedViewport = webview ? await readWebviewViewport(webview) : null;
      if (
        renderedViewport &&
        isPreviewViewportReady({
          setting,
          appliedSettingKey,
          declaredViewport,
          renderedViewport,
        })
      ) {
        return renderedViewport;
      }
    } catch {
      // Registration and navigation can transiently replace the guest while
      // React applies the server snapshot. Retry until the operation deadline.
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  throw new PreviewAutomationViewportTimeoutError({
    ...context,
    tabId,
    timeoutMs,
  });
};

const currentStatus = async (
  threadRef: ScopedThreadRef,
  requestedTabId: string | null,
): Promise<PreviewAutomationStatus> => {
  const state = readThreadPreviewState(threadRef);
  const { snapshot, tabId } = resolvePreviewAutomationTarget(state, requestedTabId);
  const runtimeTabId = tabId ? previewRuntimeTabId(threadRef, state.serverEpoch, tabId) : null;
  const visible = runtimeTabId ? isPreviewPresentationConfirmed(runtimeTabId) : false;
  const viewportSetting = snapshot ? (snapshot.viewport ?? FILL_PREVIEW_VIEWPORT) : undefined;
  const viewport = runtimeTabId ? await readRenderedViewport(runtimeTabId).catch(() => null) : null;
  const viewportStatus = {
    ...(viewportSetting === undefined ? {} : { viewportSetting }),
    ...(viewport === null ? {} : { viewport }),
  };
  if (runtimeTabId && tabId && previewBridge && state.desktopByTabId[tabId]) {
    const status = await previewBridge.automation.status(runtimeTabId);
    return { ...status, tabId, visible, ...viewportStatus };
  }
  const navStatus = snapshot?.navStatus;
  return {
    available: Boolean(previewBridge?.automation),
    visible,
    tabId,
    url: navStatus && navStatus._tag !== "Idle" ? navStatus.url : null,
    title: navStatus && navStatus._tag !== "Idle" ? navStatus.title : null,
    loading: navStatus?._tag === "Loading",
    ...viewportStatus,
  };
};

const raiseAtomCommandFailure = (result: Parameters<typeof squashAtomCommandFailure>[0]): never => {
  throw squashAtomCommandFailure(result);
};

const raisePreviewAutomationHostError = (
  error: PreviewAutomationRecordingNotActiveError,
): never => {
  throw error;
};

export function PreviewAutomationHosts() {
  const { environments } = useEnvironments();
  if (!isElectron || !previewBridge?.automation) return null;
  return (
    <>
      {/*
       * Host lifetime follows the desktop runtime's environment connections,
       * not the routed thread. This keeps background threads automatable and
       * lets the subscription runtime own reconnects for every saved target.
       */}
      {environments.map((environment) => (
        <PreviewAutomationHost
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      ))}
    </>
  );
}

function PreviewAutomationHost(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const registry = useContext(RegistryContext);
  const [automationClientId] = useState(createPreviewAutomationClientId);
  const initialAutomationHost = useMemo<PreviewAutomationHostState>(
    () => ({
      clientId: automationClientId,
      environmentId,
      supportedOperations: [...PREVIEW_AUTOMATION_OPERATIONS],
      ...(previewBridge?.setWebviewVisibility
        ? { capabilities: ["click-visible-only-v1"] as const }
        : {}),
    }),
    [automationClientId, environmentId],
  );
  const automationRequestsAtom = previewEnvironment.automationRequests({
    environmentId,
    input: initialAutomationHost,
  });
  const listPreviews = useAtomQueryRunner(previewEnvironment.list, {
    reportFailure: false,
  });
  const open = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const resize = useAtomCommand(previewEnvironment.resize, {
    reportFailure: false,
  });
  const respondToAutomation = useAtomCommand(
    previewEnvironment.respondToAutomation,
    "preview automation response",
  );
  const focusAutomationHost = useAtomCommand(
    previewEnvironment.focusAutomationHost,
    "preview automation host focus",
  );
  const [automationConnectionAtom] = useState(() => Atom.make<string | null>(null));
  const automationConnectionId = useAtomValue(automationConnectionAtom);

  const handleRequest = useCallback(
    async (request: PreviewAutomationRequest): Promise<unknown> => {
      const clickTiming = {
        deadline:
          performance.now() + Math.max(0, request.timeoutMs - PREVIEW_CLICK_RESPONSE_RESERVE_MS),
        timeoutMs: request.timeoutMs,
      };
      const threadRef: ScopedThreadRef = {
        environmentId,
        threadId: request.threadId,
      };
      let tabId = request.tabId ?? null;
      try {
        let state = readThreadPreviewState(threadRef);
        const needsSessionSync = needsPreviewAutomationSessionSync(state, request.tabId);
        if (needsSessionSync) {
          const listTarget = {
            environmentId,
            input: { threadId: request.threadId },
          } as const;
          registry.refresh(previewEnvironment.list(listTarget));
          const result = await listPreviews(listTarget);
          if (result._tag === "Failure") {
            return raiseAtomCommandFailure(result);
          }
          reconcilePreviewServerSessions(threadRef, result.value);
          state = readThreadPreviewState(threadRef);
        }
        tabId = request.tabId ?? state.snapshot?.tabId ?? null;
        const unavailableTarget = {
          requestId: request.requestId,
          operation: request.operation,
          environmentId,
          threadId: request.threadId,
          tabId,
          bridgeAvailable: Boolean(previewBridge),
        };
        const requireReadyTab = async (clickContext?: PreviewAutomationClickContext) => {
          const bridge = previewBridge;
          const readyTabId = tabId;
          if (!bridge || !readyTabId) {
            throw new PreviewAutomationTargetUnavailableError(unavailableTarget);
          }
          const readyState = readThreadPreviewState(threadRef);
          const runtimeTabId = previewRuntimeTabId(threadRef, readyState.serverEpoch, readyTabId);
          if (clickContext) {
            assertPreviewClickBeforeDeadline(clickContext, clickTiming);
            await waitForDesktopOverlayBeforePreviewClick(
              threadRef,
              readyTabId,
              runtimeTabId,
              bridge,
              clickContext,
              clickTiming,
            );
          } else {
            await waitForDesktopOverlay(
              threadRef,
              request.requestId,
              readyTabId,
              runtimeTabId,
              request.operation,
              request.timeoutMs,
            );
          }
          return {
            bridge,
            tabId: readyTabId,
            runtimeTabId,
          };
        };
        switch (request.operation) {
          case "status":
            return await currentStatus(threadRef, tabId);
          case "open": {
            const input = request.input as PreviewAutomationOpenInput;
            const resolvedInputUrl = input.url
              ? resolveBrowserNavigationTarget(environmentId, {
                  kind: "url",
                  url: input.url,
                }).resolvedUrl
              : undefined;
            let activeTabId = resolvePreviewAutomationOpenTab(
              state,
              request.tabId,
              input.reuseExistingTab ?? true,
            );
            let activeSnapshot = activeTabId
              ? (state.sessions[activeTabId] ?? state.snapshot ?? undefined)
              : undefined;
            const reusedExistingTab = activeTabId !== null;
            tabId = activeTabId;
            if (!activeTabId) {
              const result = await open({
                environmentId,
                input: {
                  threadId: request.threadId,
                  ...(resolvedInputUrl ? { url: resolvedInputUrl } : {}),
                  // An agent that didn't state a size gets the user's
                  // configured default, same as a hand-opened tab.
                  viewport: browserDefaultOpenViewport(await resolveBrowserDefaults()),
                },
              });
              if (result._tag === "Failure") {
                return raiseAtomCommandFailure(result);
              }
              const snapshot = result.value;
              applyPreviewServerSnapshot(threadRef, snapshot);
              activeTabId = snapshot.tabId;
              activeSnapshot = snapshot;
              tabId = activeTabId;
            }
            const activeRuntimeTabId = previewRuntimeTabId(
              threadRef,
              readThreadPreviewState(threadRef).serverEpoch,
              activeTabId,
            );
            if (activeSnapshot) {
              const defaultViewport = previewAutomationDefaultViewport(
                reusedExistingTab,
                activeSnapshot,
              );
              if (defaultViewport) {
                const resizeResult = await runBrowserViewportMutation(
                  activeRuntimeTabId,
                  async () => {
                    assertPreviewRuntimeCurrent(
                      threadRef,
                      activeTabId,
                      activeRuntimeTabId,
                      request,
                    );
                    return await resize({
                      environmentId,
                      input: {
                        threadId: request.threadId,
                        tabId: activeTabId,
                        viewport: defaultViewport,
                      },
                    });
                  },
                );
                if (resizeResult._tag === "Failure") {
                  return raiseAtomCommandFailure(resizeResult);
                }
                activeSnapshot = resizeResult.value;
                updatePreviewServerSnapshot(threadRef, resizeResult.value);
              }
            }
            const shouldPresentPreview = shouldOpenPreviewMiniPlayer(
              input,
              (await resolveBrowserDefaults()).autoShowFloatingPreview,
            );
            if (shouldPresentPreview) {
              usePreviewMiniPlayerStore.getState().open(threadRef, activeTabId);
            }
            if (activeSnapshot && previewAutomationOpenNeedsOverlay(input, activeSnapshot)) {
              await waitForDesktopOverlay(
                threadRef,
                request.requestId,
                activeTabId,
                activeRuntimeTabId,
                request.operation,
                request.timeoutMs,
              );
            }
            if (shouldPresentPreview) {
              // React commits the thread-bound surface asynchronously. Settle
              // briefly so active-thread opens report visible=true, without
              // turning a background thread's offscreen mini player into an
              // operation failure.
              await waitForPreviewPresentation(activeRuntimeTabId);
            }
            if (reusedExistingTab && resolvedInputUrl && previewBridge) {
              assertPreviewRuntimeCurrent(threadRef, activeTabId, activeRuntimeTabId, request);
              await previewBridge.navigate(activeRuntimeTabId, resolvedInputUrl);
              await waitForNavigationReadiness(
                threadRef,
                request.requestId,
                activeTabId,
                activeRuntimeTabId,
                request.operation,
                "load",
                request.timeoutMs,
              );
            }
            return await currentStatus(threadRef, activeTabId);
          }
          case "navigate": {
            const ready = await requireReadyTab();
            const input = request.input as PreviewAutomationNavigateInput;
            const resolution = resolveBrowserNavigationTarget(
              environmentId,
              input.target ?? {
                kind: "url",
                url: input.url!,
              },
            );
            await ready.bridge.navigate(ready.runtimeTabId, resolution.resolvedUrl);
            await waitForNavigationReadiness(
              threadRef,
              request.requestId,
              ready.tabId,
              ready.runtimeTabId,
              request.operation,
              input.readiness ?? "load",
              input.timeoutMs ?? request.timeoutMs,
            );
            return await currentStatus(threadRef, ready.tabId);
          }
          case "resize": {
            const ready = await requireReadyTab();
            const input = request.input as PreviewAutomationResizeInput;
            const setting = resolvePreviewViewport(input);
            const applied = await runBrowserViewportMutation(ready.runtimeTabId, async () => {
              const operationState = assertPreviewRuntimeCurrent(
                threadRef,
                ready.tabId,
                ready.runtimeTabId,
                request,
              );
              const previousSetting =
                operationState.sessions[ready.tabId]?.viewport ?? FILL_PREVIEW_VIEWPORT;
              const result = await resize({
                environmentId,
                input: {
                  threadId: request.threadId,
                  tabId: ready.tabId,
                  viewport: setting,
                },
              });
              if (result._tag === "Failure") {
                return raiseAtomCommandFailure(result);
              }
              updatePreviewServerSnapshot(threadRef, result.value);
              return {
                previousSetting,
                serverEpoch: operationState.serverEpoch,
              };
            });
            let viewport: PreviewRenderedViewportSize;
            try {
              viewport = await waitForRenderedViewport(
                threadRef,
                ready.tabId,
                ready.runtimeTabId,
                setting,
                input.timeoutMs ?? request.timeoutMs,
                {
                  requestId: request.requestId,
                  operation: request.operation,
                  environmentId,
                  threadId: request.threadId,
                },
              );
            } catch (cause) {
              await runBrowserViewportMutation(ready.runtimeTabId, async () => {
                const latestState = readThreadPreviewState(threadRef);
                const latestSetting =
                  latestState.sessions[ready.tabId]?.viewport ?? FILL_PREVIEW_VIEWPORT;
                if (
                  shouldRollbackPreviewViewport(
                    applied.previousSetting,
                    setting,
                    latestSetting,
                    applied.serverEpoch,
                    latestState.serverEpoch,
                  )
                ) {
                  const rollback = await resize({
                    environmentId,
                    input: {
                      threadId: request.threadId,
                      tabId: ready.tabId,
                      viewport: applied.previousSetting,
                    },
                  });
                  if (rollback._tag !== "Failure") {
                    updatePreviewServerSnapshot(threadRef, rollback.value);
                  }
                }
              });
              throw cause;
            }
            return {
              tabId: ready.tabId,
              setting,
              viewport,
            } satisfies PreviewAutomationResizeResult;
          }
          case "setColorScheme": {
            const ready = await requireReadyTab();
            const input = request.input as PreviewAutomationSetColorSchemeInput;
            await ready.bridge.setColorScheme(ready.runtimeTabId, input.colorScheme);
            return {
              tabId: ready.tabId,
              colorScheme: input.colorScheme,
            } satisfies PreviewAutomationSetColorSchemeResult;
          }
          case "snapshot": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.snapshot(ready.runtimeTabId);
          }
          case "click": {
            const clickTabId = tabId;
            if (!clickTabId) {
              throw new PreviewAutomationTargetUnavailableError(unavailableTarget);
            }
            const clickContext = {
              requestId: request.requestId,
              operation: request.operation,
              environmentId,
              threadId: request.threadId,
              tabId: clickTabId,
            };
            const ready = await requireReadyTab(clickContext);
            return await clickVisiblePreview(
              ready.runtimeTabId,
              request.input as PreviewAutomationClickInput,
              ready.bridge,
              { ...clickContext, tabId: ready.tabId },
              clickTiming,
              () => {
                assertPreviewRuntimeCurrent(
                  threadRef,
                  ready.tabId,
                  ready.runtimeTabId,
                  clickContext,
                );
              },
            );
          }
          case "type": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.type(
              ready.runtimeTabId,
              request.input as Parameters<typeof ready.bridge.automation.type>[1],
            );
          }
          case "press": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.press(
              ready.runtimeTabId,
              request.input as Parameters<typeof ready.bridge.automation.press>[1],
            );
          }
          case "scroll": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.scroll(
              ready.runtimeTabId,
              request.input as Parameters<typeof ready.bridge.automation.scroll>[1],
            );
          }
          case "evaluate": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.evaluate(
              ready.runtimeTabId,
              request.input as Parameters<typeof ready.bridge.automation.evaluate>[1],
            );
          }
          case "waitFor": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.waitFor(
              ready.runtimeTabId,
              request.input as Parameters<typeof ready.bridge.automation.waitFor>[1],
            );
          }
          case "recordingStart": {
            const ready = await requireReadyTab();
            const startedAt = await startBrowserRecording(
              ready.runtimeTabId,
              threadRef,
              ready.tabId,
            );
            return {
              tabId: ready.tabId,
              recording: true,
              startedAt,
            };
          }
          case "recordingStop": {
            const activeRecordings = readActiveBrowserRecordingTargets(threadRef);
            const activeTabIds = new Set(
              activeRecordings.map((recording) => recording.serverTabId),
            );
            const stopTabId = resolveBrowserRecordingStopTarget(
              activeTabIds,
              tabId,
              request.tabIdExplicit ? request.tabId : undefined,
            );
            tabId = stopTabId ?? tabId;
            const stopRuntimeTabId =
              activeRecordings.find((recording) => recording.serverTabId === stopTabId)
                ?.runtimeTabId ?? null;
            const artifact = stopRuntimeTabId ? await stopBrowserRecording(stopRuntimeTabId) : null;
            if (!artifact || !stopTabId) {
              return raisePreviewAutomationHostError(
                new PreviewAutomationRecordingNotActiveError({
                  requestId: request.requestId,
                  environmentId,
                  threadId: request.threadId,
                  tabId,
                }),
              );
            }
            return { ...artifact, tabId: stopTabId };
          }
        }
      } catch (cause) {
        throw PreviewAutomationOperationError.fromCause({
          requestId: request.requestId,
          operation: request.operation,
          environmentId,
          threadId: request.threadId,
          tabId,
          cause,
        });
      }
    },
    [environmentId, listPreviews, open, registry, resize],
  );
  const [requestHandlerAtom] = useState(() => Atom.make({ handle: handleRequest }));
  const setRequestHandler = useAtomSet(requestHandlerAtom);
  useEffect(() => {
    setRequestHandler({ handle: handleRequest });
  }, [handleRequest, setRequestHandler]);

  const automationRequestConsumerAtom = useMemo(
    () =>
      createPreviewAutomationRequestConsumerAtom({
        requestsAtom: automationRequestsAtom,
        clientId: automationClientId,
        connectionAtom: automationConnectionAtom,
        environmentId,
        requestHandlerAtom,
        respond: (response) =>
          respondToAutomation({
            environmentId,
            input: response,
          }),
        label: `preview:automation-host:${environmentId}:${automationClientId}`,
      }),
    [
      automationClientId,
      automationConnectionAtom,
      automationRequestsAtom,
      requestHandlerAtom,
      respondToAutomation,
      environmentId,
    ],
  );
  useAtomValue(automationRequestConsumerAtom);

  useEffect(() => {
    const report = () => {
      if (!automationConnectionId) return;
      void focusAutomationHost({
        environmentId,
        input: {
          clientId: automationClientId,
          environmentId,
          connectionId: automationConnectionId,
          focused: document.hasFocus(),
        },
      });
    };
    report();
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    return () => {
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
    };
  }, [automationClientId, automationConnectionId, environmentId, focusAutomationHost]);

  return null;
}
