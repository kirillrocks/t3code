import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  branch: null,
  hasConversation: true,
  continueTargets: [],
  isPinned: false,
  isSettled: false,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: { settlement: true, snooze: true, pinning: true, titleRegeneration: true },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

function allIds(state: ThreadActionMenuState): string[] {
  const flatten = (items: ReturnType<typeof buildThreadActionMenuItems>): string[] =>
    items.flatMap((item) => [item.id, ...(item.children ? flatten(item.children) : [])]);
  return flatten(buildThreadActionMenuItems(state));
}

describe("buildThreadActionMenuItems", () => {
  it("hides lifecycle items when the environment lacks the capabilities", () => {
    expect(
      ids({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    ).toEqual([
      "new-thread-in-project",
      "continue-in-new-thread",
      "rename",
      "mark-unread",
      "copy",
      "archive",
      "delete",
    ]);
  });

  it("always offers a new thread in the same project", () => {
    expect(ids(baseState)[0]).toBe("new-thread-in-project");
    expect(ids({ ...baseState, branch: "feat/menu" }).slice(0, 3)).toEqual([
      "new-thread-in-project",
      "continue-in-new-thread",
      "new-thread-on-branch",
    ]);
  });

  it("includes branch items only for threads with a branch", () => {
    const withBranch = allIds({ ...baseState, branch: "feat/menu" });
    expect(withBranch).toContain("new-thread-on-branch");
    expect(withBranch).toContain("copy-branch");
    expect(allIds(baseState)).not.toContain("new-thread-on-branch");
    expect(allIds(baseState)).not.toContain("copy-branch");
  });

  it("flips lifecycle labels with thread state", () => {
    expect(ids({ ...baseState, isPinned: true, isSettled: true, isSnoozed: true })).toEqual(
      expect.arrayContaining(["unpin", "unsettle", "unsnooze"]),
    );
    expect(ids(baseState)).toEqual(expect.arrayContaining(["pin", "settle", "snooze"]));
  });

  it("disables snooze when the thread cannot snooze, keeping presets visible", () => {
    const snooze = buildThreadActionMenuItems({ ...baseState, canSnoozeNow: false }).find(
      (item) => item.id === "snooze",
    );
    expect(snooze?.disabled).toBe(true);
    expect(snooze?.children?.map((child) => child.id)).toEqual(["snooze:hour"]);
  });

  it("disables title regeneration while one is in flight", () => {
    const item = buildThreadActionMenuItems({ ...baseState, isRegeneratingTitle: true }).find(
      (candidate) => candidate.id === "regenerate-title",
    );
    expect(item).toMatchObject({ label: "Regenerating…", disabled: true });
  });

  it("disables continuation without settled conversation context", () => {
    const withoutMessages = buildThreadActionMenuItems({
      ...baseState,
      hasConversation: false,
    }).find((candidate) => candidate.id === "continue-in-new-thread");
    const whileRunning = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
    }).find((candidate) => candidate.id === "continue-in-new-thread");

    expect(withoutMessages?.disabled).toBe(true);
    expect(whileRunning?.disabled).toBe(true);
  });

  it("offers other providers as a submenu when configured", () => {
    const item = buildThreadActionMenuItems({
      ...baseState,
      continueTargets: [{ instanceId: "claude_personal", label: "Claude (personal)" }],
    }).find((candidate) => candidate.id === "continue-in-new-thread");
    expect(item?.children?.map((child) => [child.id, child.label])).toEqual([
      ["continue-in-new-thread", "Same provider"],
      ["continue-in-new-thread:claude_personal", "With Claude (personal)"],
    ]);
    expect(
      buildThreadActionMenuItems(baseState).find((c) => c.id === "continue-in-new-thread")
        ?.children,
    ).toBeUndefined();
  });

  it("marks delete as destructive and keeps it last", () => {
    const items = buildThreadActionMenuItems({ ...baseState, branch: "main" });
    expect(items.at(-1)).toMatchObject({ id: "delete", destructive: true });
  });
  it("offers archive as a non-destructive action right before delete", () => {
    const items = buildThreadActionMenuItems(baseState);
    const archiveItem = items.at(-2);
    expect(archiveItem?.id).toBe("archive");
    expect(archiveItem?.icon).toBe("archive");
    expect(archiveItem?.separatorBefore).toBe(true);
    expect(archiveItem?.destructive).toBeFalsy();
    expect(items.at(-1)?.id).toBe("delete");
  });

  it("keeps archive available even when the environment lacks every other capability", () => {
    expect(
      ids({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    ).toContain("archive");
  });

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});
