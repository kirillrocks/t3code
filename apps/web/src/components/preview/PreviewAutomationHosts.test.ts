import {
  type DesktopPreviewBridge,
  EnvironmentId,
  PreviewTabId,
  ThreadId,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { acquireBrowserSurface, useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";

import { clickVisiblePreview, isPreviewPresentationConfirmed } from "./PreviewAutomationHosts";

const runtimeTabId = "runtime-tab-1";
const context = {
  requestId: "request-1",
  operation: "click" as const,
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  tabId: PreviewTabId.make("tab-1"),
};
const clickInput = { x: 10, y: 20 };

const deferred = <A>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const makeTiming = (timeoutMs = 100) => ({
  deadline: performance.now() + timeoutMs,
  timeoutMs,
});

const makeWebview = (
  webContentsId: number | null,
  attachmentId: string | null,
  mainVisible = true,
) => {
  const attributes = new Map([["data-preview-tab", runtimeTabId]]);
  if (webContentsId !== null) {
    attributes.set("data-preview-web-contents-id", String(webContentsId));
  }
  if (attachmentId !== null) attributes.set("data-preview-attachment-id", attachmentId);
  if (mainVisible) attributes.set("data-preview-main-visible", "true");
  return {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    removeAttribute: (name: string) => attributes.delete(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  };
};

const presentSurface = () => {
  const surface = acquireBrowserSurface(runtimeTabId);
  surface.present({ x: 0, y: 0, width: 800, height: 600 }, true);
  return surface;
};

const stubWebview = (getWebview: () => ReturnType<typeof makeWebview> | null) => {
  vi.stubGlobal("document", {
    querySelectorAll: () => {
      const webview = getWebview();
      return webview ? [webview] : [];
    },
  });
};

const makeBridge = (
  setWebviewVisibility: (...args: readonly unknown[]) => Promise<void>,
  click: (...args: readonly unknown[]) => Promise<unknown>,
) =>
  ({
    setWebviewVisibility,
    automation: { click },
  }) as unknown as DesktopPreviewBridge;

const runClick = (
  bridge: DesktopPreviewBridge,
  timing = makeTiming(),
  assertRuntimeCurrent: () => void = vi.fn(),
) => clickVisiblePreview(runtimeTabId, clickInput, bridge, context, timing, assertRuntimeCurrent);

const trackSubscriptionCleanup = () => {
  const subscribe = useBrowserSurfaceStore.subscribe;
  const unsubscribe = vi.fn();
  vi.spyOn(useBrowserSurfaceStore, "subscribe").mockImplementation((listener) => {
    const stop = subscribe(listener);
    return () => {
      unsubscribe();
      stop();
    };
  });
  return unsubscribe;
};

describe("preview presentation confirmation", () => {
  beforeEach(() => {
    useBrowserSurfaceStore.setState({ byTabId: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses store visibility for old shells and the native marker for current shells", () => {
    presentSurface();
    const webview = makeWebview(42, "preview-attachment-1", false);
    stubWebview(() => webview);
    const oldShell = { automation: {} } as unknown as DesktopPreviewBridge;
    const currentShell = {
      setWebviewVisibility: vi.fn(async () => undefined),
      automation: {},
    } as unknown as DesktopPreviewBridge;

    expect(isPreviewPresentationConfirmed(runtimeTabId, oldShell)).toBe(true);
    expect(isPreviewPresentationConfirmed(runtimeTabId, currentShell)).toBe(false);

    webview.setAttribute("data-preview-main-visible", "true");
    expect(isPreviewPresentationConfirmed(runtimeTabId, currentShell)).toBe(true);
  });
});

describe("clickVisiblePreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useBrowserSurfaceStore.setState({ byTabId: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("waits for registration on the captured visible webview", async () => {
    presentSurface();
    const webview = makeWebview(null, null);
    stubWebview(() => webview);
    const setWebviewVisibility = vi.fn(async () => undefined);
    const click = vi.fn(async () => ({ _tag: "Dispatched" as const }));
    const result = runClick(makeBridge(setWebviewVisibility, click));

    webview.setAttribute("data-preview-web-contents-id", "42");
    webview.setAttribute("data-preview-attachment-id", "preview-attachment-1");
    await vi.advanceTimersByTimeAsync(16);

    await expect(result).resolves.toEqual({ _tag: "PreviewAutomationClickDispatched" });
    expect(click).toHaveBeenCalledWith(runtimeTabId, clickInput, 42, "preview-attachment-1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out when registration never appears and never dispatches", async () => {
    presentSurface();
    const webview = makeWebview(null, null);
    stubWebview(() => webview);
    const unsubscribe = trackSubscriptionCleanup();
    const click = vi.fn(async () => ({ _tag: "Dispatched" as const }));
    const result = runClick(
      makeBridge(
        vi.fn(async () => undefined),
        click,
      ),
      makeTiming(50),
    );
    const rejection = expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationClickTimeoutHostError",
    });

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(click).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects registration that appears after the deadline", async () => {
    presentSurface();
    const webview = makeWebview(null, null);
    stubWebview(() => webview);
    const click = vi.fn(async () => ({ _tag: "Dispatched" as const }));
    const result = runClick(
      makeBridge(
        vi.fn(async () => undefined),
        click,
      ),
      makeTiming(50),
    );
    const rejection = expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationClickTimeoutHostError",
    });

    await vi.advanceTimersByTimeAsync(50);
    webview.setAttribute("data-preview-web-contents-id", "42");
    webview.setAttribute("data-preview-attachment-id", "preview-attachment-1");

    await rejection;
    expect(click).not.toHaveBeenCalled();
  });

  it("does not dispatch when the visibility acknowledgement arrives after the deadline", async () => {
    presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const acknowledgement = deferred<void>();
    const setWebviewVisibility = vi.fn(async (_tabId, _webContentsId, _attachmentId, visible) =>
      visible ? acknowledgement.promise : undefined,
    );
    const click = vi.fn(async () => ({ _tag: "Dispatched" as const }));
    const result = runClick(makeBridge(setWebviewVisibility, click), makeTiming(50));
    const rejection = expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationClickTimeoutHostError",
    });

    await vi.advanceTimersByTimeAsync(50);
    acknowledgement.resolve();
    await vi.advanceTimersByTimeAsync(0);

    await rejection;
    expect(click).not.toHaveBeenCalled();
    expect(setWebviewVisibility).toHaveBeenLastCalledWith(
      runtimeTabId,
      42,
      "preview-attachment-1",
      false,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start visibility IPC after an expired deadline", async () => {
    presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const setWebviewVisibility = vi.fn(async () => undefined);
    const click = vi.fn(async () => ({ _tag: "Dispatched" as const }));

    await expect(
      runClick(makeBridge(setWebviewVisibility, click), {
        deadline: performance.now(),
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({ _tag: "PreviewAutomationClickTimeoutHostError" });
    expect(setWebviewVisibility).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("does not click if the surface hides before visibility is acknowledged", async () => {
    const surface = presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const acknowledgement = deferred<void>();
    const visibilityCalls: boolean[] = [];
    const setWebviewVisibility = vi.fn((_tabId, _webContentsId, _attachmentId, visible) => {
      visibilityCalls.push(visible);
      return visible ? acknowledgement.promise : Promise.resolve();
    });
    const click = vi.fn(async () => ({ _tag: "Dispatched" as const }));
    const result = runClick(makeBridge(setWebviewVisibility, click));
    await vi.advanceTimersByTimeAsync(0);

    surface.present({ x: 0, y: 0, width: 800, height: 600 }, false);
    await expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationTabNotVisibleHostError",
    });
    acknowledgement.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(visibilityCalls).toEqual([true, false, false]);
    expect(click).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves NotSent when the surface hides during native dispatch", async () => {
    const surface = presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const clickResult = deferred<{
      readonly _tag: "NotSent";
      readonly reason: "tab-not-visible";
    }>();
    const click = vi.fn(() => clickResult.promise);
    const result = runClick(
      makeBridge(
        vi.fn(async () => undefined),
        click,
      ),
    );
    await vi.advanceTimersByTimeAsync(0);

    surface.present({ x: 0, y: 0, width: 800, height: 600 }, false);
    clickResult.resolve({ _tag: "NotSent", reason: "tab-not-visible" });

    await expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationTabNotVisibleHostError",
    });
  });

  it("reports uncertain delivery when the surface hides during native dispatch", async () => {
    const surface = presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const clickResult = deferred<{ readonly _tag: "Dispatched" }>();
    const result = runClick(
      makeBridge(
        vi.fn(async () => undefined),
        vi.fn(() => clickResult.promise),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);

    surface.present({ x: 0, y: 0, width: 800, height: 600 }, false);
    clickResult.resolve({ _tag: "Dispatched" });

    await expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationClickDeliveryUnconfirmedHostError",
      message: expect.stringContaining("MAY have been sent"),
    });
  });

  it("keeps invalidation sticky when the surface hides and returns", async () => {
    const surface = presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const clickResult = deferred<{ readonly _tag: "Dispatched" }>();
    const result = runClick(
      makeBridge(
        vi.fn(async () => undefined),
        vi.fn(() => clickResult.promise),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);

    surface.present({ x: 0, y: 0, width: 800, height: 600 }, false);
    surface.present({ x: 0, y: 0, width: 800, height: 600 }, true);
    clickResult.resolve({ _tag: "Dispatched" });

    await expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationClickDeliveryUnconfirmedHostError",
    });
  });

  it("reports uncertain delivery when the DOM attachment changes during dispatch", async () => {
    presentSurface();
    const initialWebview = makeWebview(42, "preview-attachment-1");
    const replacementWebview = makeWebview(43, "preview-attachment-2");
    let currentWebview = initialWebview;
    stubWebview(() => currentWebview);
    const clickResult = deferred<{ readonly _tag: "Dispatched" }>();
    const result = runClick(
      makeBridge(
        vi.fn(async () => undefined),
        vi.fn(() => clickResult.promise),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);

    currentWebview = replacementWebview;
    clickResult.resolve({ _tag: "Dispatched" });

    await expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationClickDeliveryUnconfirmedHostError",
    });
  });

  it("reports uncertain delivery when the preview runtime changes during dispatch", async () => {
    presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const clickResult = deferred<{ readonly _tag: "Dispatched" }>();
    let runtimeIsCurrent = true;
    const assertRuntimeCurrent = vi.fn(() => {
      if (!runtimeIsCurrent) throw new Error("runtime changed");
    });
    const result = runClick(
      makeBridge(
        vi.fn(async () => undefined),
        vi.fn(() => clickResult.promise),
      ),
      makeTiming(),
      assertRuntimeCurrent,
    );
    await vi.advanceTimersByTimeAsync(0);

    runtimeIsCurrent = false;
    clickResult.resolve({ _tag: "Dispatched" });

    await expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationClickDeliveryUnconfirmedHostError",
    });
    expect(assertRuntimeCurrent.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not dispatch after a pre-dispatch runtime change", async () => {
    presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const click = vi.fn(async () => ({ _tag: "Dispatched" as const }));
    const runtimeError = new Error("runtime changed");

    await expect(
      runClick(
        makeBridge(
          vi.fn(async () => undefined),
          click,
        ),
        makeTiming(),
        () => {
          throw runtimeError;
        },
      ),
    ).rejects.toBe(runtimeError);
    expect(click).not.toHaveBeenCalled();
  });

  it("does not wait forever for native dispatch confirmation", async () => {
    presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const clickResult = deferred<{ readonly _tag: "Dispatched" }>();
    const result = runClick(
      makeBridge(
        vi.fn(async () => undefined),
        vi.fn(() => clickResult.promise),
      ),
      makeTiming(50),
    );
    const rejection = expect(result).rejects.toMatchObject({
      _tag: "PreviewAutomationClickDeliveryUnconfirmedHostError",
    });

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up its subscription and timer after success", async () => {
    presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const unsubscribe = trackSubscriptionCleanup();

    await expect(
      runClick(
        makeBridge(
          vi.fn(async () => undefined),
          vi.fn(async () => ({ _tag: "Dispatched" as const })),
        ),
      ),
    ).resolves.toEqual({ _tag: "PreviewAutomationClickDispatched" });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up after a visibility bridge error", async () => {
    presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const unsubscribe = trackSubscriptionCleanup();
    const bridgeError = new Error("bridge failed");
    const setWebviewVisibility = vi.fn(async (_tabId, _id, _attachment, visible) => {
      if (visible) throw bridgeError;
    });

    await expect(
      runClick(
        makeBridge(
          setWebviewVisibility,
          vi.fn(async () => ({ _tag: "Dispatched" as const })),
        ),
      ),
    ).rejects.toBe(bridgeError);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up after a click bridge error", async () => {
    presentSurface();
    const webview = makeWebview(42, "preview-attachment-1");
    stubWebview(() => webview);
    const unsubscribe = trackSubscriptionCleanup();
    const bridgeError = new Error("bridge failed");

    await expect(
      runClick(
        makeBridge(
          vi.fn(async () => undefined),
          vi.fn(async () => Promise.reject(bridgeError)),
        ),
      ),
    ).rejects.toBe(bridgeError);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
