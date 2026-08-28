# Organizing threads

## Sort order

By default the thread you last sent a message to is on top. To change this, open the sort menu
(the arrows icon beside the project filter) or go to Settings → General → **Sort active threads**:

- **Recent activity** (default): the thread you last sent a message to moves to the top. Agent
  replies do not move a thread, so the list only changes when you act.
- **Created**: newest thread on top. A thread keeps its place until it settles or you un-settle it.

Pinned, snoozed, and settled sections keep their own order.

## Starting a thread in the same project

Click the arrow beside **New thread** to start a thread in the project you are viewing, or pick
another project. Right-click any thread and choose **New thread in this project** to do the same
from the list. Shift+click on **New thread** is a shortcut for the current project.

## Continue in a new thread

On web and desktop, open a thread's context menu and choose **Continue in new thread** to put its
recent completed conversation into a fresh, editable draft. The draft stays in the same workspace
and initially keeps the source provider, model, permission mode, and interaction mode. Choose any
other configured provider before sending to hand the work to a different coding harness.

When you have more than one provider or account set up, the item opens a submenu: **Same provider**,
or **With …** for each other provider. Pick an account there when the current one hit its limit; the
draft is already set to that account, so you only press send.

This is a portable conversation handoff, not a copy of the provider's private session state. Tool
state and image data do not transfer; attachment names remain in the handoff so you know what may
need to be attached again.

## Pinning

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled.

When you un-settle a thread, it returns to the top of the active list so you can find it right
away. Its timestamps do not change. Other threads keep their positions.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. The thread settles when the linked pull request merges if **Auto-settle merged
threads** is enabled. Right-click the same link and choose **Unlink from thread** to remove it.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
