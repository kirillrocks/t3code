import {
  type DesktopPreviewBridge,
  EnvironmentId,
  PreviewTabId,
  ThreadId,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { acquireBrowserSurface, useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";

import { clickVisiblePreview } from "./PreviewAutomationHosts";

const runtimeTabId = "runtime-tab-1";
const context = {
  requestId: "request-1",
  operation: "click" as const,
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  tabId: PreviewTabId.make("tab-1"),
};

const deferred = <A>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const makeWebview = (webContentsId: number, attachmentId: string) => {
  const attributes = new Map([
    ["data-preview-tab", runtimeTabId],
    ["data-preview-web-contents-id", String(webContentsId)],
    ["data-preview-attachment-id", attachmentId],
    ["data-preview-main-visible", "true"],
  ]);
  return {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    removeAttribute: (name: string) => attributes.delete(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  };
};

describe("clickVisiblePreview", () => {
  beforeEach(() => {
    useBrowserSurfaceStore.setState({ byTabId: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends exact attachment visibility false when the surface hides during a click", async () => {
    const surface = acquireBrowserSurface(runtimeTabId);
    surface.present({ x: 0, y: 0, width: 800, height: 600 }, true);
    const webview = makeWebview(42, "preview-attachment-1");
    vi.stubGlobal("document", { querySelectorAll: () => [webview] });
    const clickResult = deferred<{
      readonly _tag: "NotSent";
      readonly reason: "tab-not-visible";
    }>();
    const setWebviewVisibility = vi.fn(async () => undefined);
    const click = vi.fn(() => clickResult.promise);
    const bridge = {
      setWebviewVisibility,
      automation: { click },
    } as unknown as DesktopPreviewBridge;

    const result = clickVisiblePreview(runtimeTabId, { x: 10, y: 20 }, bridge, context);
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

    surface.present({ x: 0, y: 0, width: 800, height: 600 }, false);
    await vi.waitFor(() =>
      expect(setWebviewVisibility).toHaveBeenCalledWith(
        runtimeTabId,
        42,
        "preview-attachment-1",
        false,
      ),
    );
    expect(webview.getAttribute("data-preview-main-visible")).toBeNull();
    expect(click).toHaveBeenCalledWith(runtimeTabId, { x: 10, y: 20 }, 42, "preview-attachment-1");

    clickResult.resolve({ _tag: "NotSent", reason: "tab-not-visible" });
    await expect(result).rejects.toMatchObject({ _tag: "PreviewAutomationTabNotVisibleHostError" });
  });

  it("sends false again after a pending true acknowledgement if the surface hides", async () => {
    const surface = acquireBrowserSurface(runtimeTabId);
    surface.present({ x: 0, y: 0, width: 800, height: 600 }, true);
    const webview = makeWebview(42, "preview-attachment-1");
    vi.stubGlobal("document", { querySelectorAll: () => [webview] });
    const visibleAcknowledgement = deferred<void>();
    const visibilityCalls: boolean[] = [];
    const setWebviewVisibility = vi.fn((_tabId, _webContentsId, _attachmentId, visible) => {
      visibilityCalls.push(visible);
      return visible ? visibleAcknowledgement.promise : Promise.resolve();
    });
    const click = vi.fn();
    const bridge = {
      setWebviewVisibility,
      automation: { click },
    } as unknown as DesktopPreviewBridge;

    const result = clickVisiblePreview(runtimeTabId, { x: 10, y: 20 }, bridge, context);
    await vi.waitFor(() => expect(visibilityCalls).toEqual([true]));
    surface.present({ x: 0, y: 0, width: 800, height: 600 }, false);
    await vi.waitFor(() => expect(visibilityCalls).toEqual([true, false]));

    visibleAcknowledgement.resolve();
    await expect(result).rejects.toMatchObject({ _tag: "PreviewAutomationTabNotVisibleHostError" });
    expect(visibilityCalls).toEqual([true, false, false]);
    expect(click).not.toHaveBeenCalled();
  });

  it("does not click a webview that replaces the acknowledged attachment", async () => {
    const surface = acquireBrowserSurface(runtimeTabId);
    surface.present({ x: 0, y: 0, width: 800, height: 600 }, true);
    const initialWebview = makeWebview(42, "preview-attachment-1");
    const replacementWebview = makeWebview(43, "preview-attachment-2");
    let currentWebview = initialWebview;
    vi.stubGlobal("document", { querySelectorAll: () => [currentWebview] });
    const setWebviewVisibility = vi.fn(async (_tabId, _webContentsId, _attachmentId, visible) => {
      if (visible) currentWebview = replacementWebview;
    });
    const click = vi.fn();
    const bridge = {
      setWebviewVisibility,
      automation: { click },
    } as unknown as DesktopPreviewBridge;

    await expect(
      clickVisiblePreview(runtimeTabId, { x: 10, y: 20 }, bridge, context),
    ).rejects.toMatchObject({ _tag: "PreviewAutomationTabNotVisibleHostError" });
    expect(setWebviewVisibility).toHaveBeenLastCalledWith(
      runtimeTabId,
      42,
      "preview-attachment-1",
      false,
    );
    expect(click).not.toHaveBeenCalled();
  });
});
