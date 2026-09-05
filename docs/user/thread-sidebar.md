# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Sort order

By default the thread you last sent a message to is on top. To change this, open the sort menu
(the arrows icon beside the project filter) or go to Settings → General → **Sort active threads**:

- **Recent activity** (default): the thread you last sent a message to moves to the top. Agent
  replies do not move a thread, so the list only changes when you act.
- **Created**: newest thread on top. A thread keeps its place until it settles or you un-settle it.

Pinned, snoozed, and settled sections keep their own order.

## Finding a project

Click into the sidebar search box. While it is empty it lists your recent projects (the ones with
the newest activity). Type to search projects and threads by name; matching projects show above
matching threads. Matching threads keep their normal cards and sections (pinned, active,
snoozed, settled), so the list looks the same as when you are not searching. Pick a project to
show only its threads, the same as the project filter menu. Click the **+** at the end of a
project row to start a new thread in that project right away. Arrow keys and Enter work in the
list; Escape closes it.

The project filter menu (**All projects**) has its own search box: open it and type to narrow
the list, then press Enter or click a project. While a project filter is on, a **+** button next
to the menu starts a new thread in that project, and an **x** button takes you back to all
projects in one click. In the filtered view every thread shows as a full card, settled ones too,
with **Reopen** on hover.

## Other threads of the same project

Hold the mouse over a thread card. A small panel slides in beside the card with the other open
threads of that project (up to six, then **Show more**). Click one to open it. Move the mouse away
and the panel closes. This needs a mouse, so it is not available on touch screens; use the search
box or the project filter there.

## Starting a thread in the same project

Click the arrow beside **New thread** to start a thread in the project you are viewing, or pick
another project. Right-click any thread and choose **New thread in this project** to do the same
from the list. Shift+click on **New thread** is a shortcut for the current project.

## Continue in a new thread

Use this when an account hits its limit, or when you want to move the work to another provider.
Click the **Continue in new thread** button in the chat header, or choose it from a thread's context
menu. T3 Code opens a new draft in the same workspace and asks its text-generation model (the same
cheap model that writes thread titles, set under Settings → General) to write a short summary of the
conversation: the goal, what was done, what is left, and the rules you gave. The draft starts with
"We continue a conversation from another thread" and that summary. Pick any provider or account in
the draft, edit the text if you like, then send.

The summary takes a few seconds. If the summary model is not available, the recent messages are
pasted in instead. Tool state and images do not transfer; attachment names are listed so you know
what to attach again.

## Pinning

Pin a thread from its context menu to keep it in the pinned section above your active work.
`mod+shift+p` pins or unpins the thread you have open. Pinned threads are shown independently of
their project, including when you connect to more than one environment.

## Start a thread

On web and desktop, a new thread keeps the current project and carries your model
and mode selections, unless the destination project has its own model default.
Its branch and workspace mode come from your configured defaults. To continue in
an existing worktree, use **New thread in this worktree** from the branch toolbar.

When you change a new thread's project, T3 Code stays in the current environment
if that project exists there. Otherwise it selects an environment that has it.

### Start in the background

In a desktop browser or the desktop app, press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft. The
next draft keeps the workspace mode and base branch you selected. With **New
worktree**, each background submission creates its own worktree.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work. Drag pinned threads
to reorder them on web and desktop, or use **Move up** and **Move down** on mobile.
The order syncs across devices.

Pinning does not prevent automatic settlement. Settling a thread removes its pin.

## Settle finished work

Choose **Settle thread** from its menu to move finished work out of the active list
without deleting the conversation. **Un-settle thread** restores it to active work
and prevents automatic settlement until new activity resumes the usual rules.

By default, environments settle inactive threads after three days and settle
threads whose pull request merged. A closed pull request can also settle an idle
thread. Work in progress, pending questions or approvals, and live background work
prevent automatic settlement. An open pull request does not prevent inactivity
settlement, but an old closed or merged pull request does not settle work you
resumed after it closed.

Change these rules in **Settings → General**. They continue to run when your apps
are closed. Changes apply to connected environments that support shared settings;
offline environments and older servers keep their previous values. If connected
environments disagree, **Apply to all** copies your current settings to those named
in the warning. Changing a rule does not reopen already settled threads.

## Link a pull request

On web and desktop, right-click a pull request link in a thread and choose
**Link to thread**. Use **Unlink from thread** on the same link to remove it.
The linked pull request participates in automatic settlement.

## Find and reference work

On web and desktop, open the command palette with `Cmd/Ctrl+K` to search threads
across connected environments. Message search starts after two characters and
includes your messages and final agent responses.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread reference. A copied reference uses the thread's pull request
link when available, otherwise its thread ID. See [keybindings](./keybindings.md)
for custom configuration.

## Inspect agent work

On web and desktop, use **Agents** to follow work delegated to subagents.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.
