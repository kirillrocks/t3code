# Organizing threads

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
the list, then press Enter or click a project. While a project filter is on, an **x** button next
to the menu takes you back to all projects in one click.

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
