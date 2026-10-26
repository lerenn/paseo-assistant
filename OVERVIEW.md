Assistant is a first mate for the other agents on your Paseo daemon. It is one long-lived conversation that watches your agents, passes on their questions and summarises what needs you. A sidebar entry (a spinner that turns continuously while the Assistant is working, the sparkles icon when it is idle) opens its screen, with the chat always shown and a right-hand panel (toggle at the top right) with the tabs Current Tasks (the default, always), Your Decisions, Your Actions and Mailbox, each with a count.

## How it works

The plugin runs one Assistant agent per daemon, in a hidden background workspace. It is created the first time you open the screen and recreated if it is archived. The Chat tab embeds its conversation with the usual composer when the host provides `AgentChat` (the Paseo fork does), and otherwise has a button that opens it as an ordinary agent. New session archives the current conversation and starts a fresh one.

The Assistant watches, routes, summarises and relays. It reads agent status, activity and pending permissions with Paseo's own agent tools, and it can message other agents (coordinators included) with `send_agent_prompt`, to pass on a decision you gave it or to ask for status; relayed decisions are signed as coming from the Assistant on your behalf. It can create and manage agents within guardrails (see Managing agents), and never answers permission requests.

## Setup

Needs the daemon setting `mcp.injectIntoAgents` turned on, so the Assistant gets Paseo's own agent tools. The provider and model are a setting, claude/claude-sonnet-5-5 by default, and apply from the next new session.

If the Agents Inbox, Agents Warder or Agents Leases plugins are installed, the Assistant uses their tools: it asks you through the inbox when an agent needs a human answer, and looks at watched tasks and held leases. Without them it works from the Paseo agent tools and puts questions in its own chat.

## What it reads and where it runs

The Assistant is an ordinary agent on your configured provider, so what it sees of your agents' activity is sent to that provider. Its state, the ID of the current conversation, is kept in the plugin data folder on the daemon machine.

## Mailbox

Agent mail lives in the **Agents Mail** plugin; the Mailbox tab shows the Assistant's mailbox (`@assistant`) from it, unread first, each mail linking to its agent. Agents Mail tells new top-level agents to mail `@assistant` at milestones (start, blocked, pr, done), wakes the Assistant when it is idle and has mail, and gives the Assistant the tools `mail_list`, `mail_read` and `mail_mark_read`; the Assistant also processes its mailbox from a 15-minute Paseo heartbeat it sets up at the start of a session. A running Assistant is never interrupted. Which agents are told to mail is now a setting of Agents Mail (`milestoneIncludeLabels`, `milestoneExcludeLabels`); the Assistant's `mailIncludeLabels` and `mailExcludeLabels` are ignored.

Without Agents Mail the Mailbox tab is disabled with the hint "Agents Mail not installed" ("not answering" or "needs an update" in those cases) and the other tabs work as before. The plugin finds Agents Mail through `~/.paseo/agents-mail/endpoint.json` and its loopback API; nothing is shared between the two.

**Migration.** Agents started before the change still hold the old `assistant_mail` tool, and the Assistant's older sessions `assistant_mailbox` and `assistant_mark_read`: they keep working as forwarders to Agents Mail, and say so in their description; they report that nothing was sent when Agents Mail is not installed. Use New session to give the Assistant the new tools.

## Decisions

When something needs your choice, the Assistant queues it with `assistant_decision_add(question, options, recommended)` (2 to 4 options, the recommended one shown first and marked) instead of waiting on you in chat. The Your Decisions tab shows a count badge and lists the open ones; pick an option or choose "Other…" to type your own answer (Enter sends it, Shift+Enter adds a line). The answer is queued (on disk) and delivered to the Assistant as one message, together with any new-mail wake, once it is idle: a running turn is never steered or interrupted. The message carries the decision id, question and answer, so it can act. Answered decisions stay under a collapsed "Answered" section. A **×** in the corner of each open card cancels it: the card turns into "Cancelling… Undo" for 5 seconds and only then is the Assistant told ("Decision cancelled by the user (id …): <question>", through the same idle-only queue as answers, so it can tell any waiting agent not to wait). Cancelled decisions move under "Answered" marked "Cancelled", and `assistant_decision_list` reports them with status `cancelled`. Reloading the page inside the 5 seconds drops the cancel.

## Current Tasks (open items)

For things you are waiting on but do not have to decide ("waiting for the cluster rework PR 3", "pin PR pending restart"), the Assistant keeps a list with `assistant_item_add(title, detail?, link?)`, `assistant_item_update(id, ...)` and `assistant_item_close(id, note?)`. The Current Tasks tab shows the open ones with a count (the sidebar badge stays decisions-only); closed items stay under a collapsed "Closed" section. Decisions are for real choices only.

`assistant_decision_list(status?, since?, until?)` shows the Assistant its decisions with a status (pending, answered, delivered, closed), the recommended option, the answer and its source, and timestamps; it checks it before queueing a new one.

## Managing agents

The Assistant can create and manage agents. Creation goes through the plugin, not the Paseo `create_agent` tool (which would make a subagent tied to the Assistant's session): `assistant_projects_list()` shows projects and workspaces, `assistant_workspace_create(project, title, runtime?)` makes a workspace (a Kubernetes Runtime pod by default), `assistant_agent_create(workspaceId, title, prompt, provider?, mode?, labels?)` makes a top-level agent there labelled `paseo.created-by=assistant`, and `assistant_agents_list` finds what it made. Those agents keep running after the Assistant's session ends. The Paseo tools archive, cancel, update, set modes, rename workspaces and manage schedules and heartbeats are pre-approved; the prompt sets the guardrails (a Decision first before archiving or cancelling a coordinator, the Factory Supervisor or a working agent; bypassPermissions only for its own agents; nothing on tf-aws prod; no contacting people; every action logged as an Open item). It needs the Paseo MCP tools (`mcp.injectIntoAgents`).

## Memory and new sessions

The Assistant can write its own memory: `Write` and `Edit` work only in its Claude memory folder (`~/.claude/projects/<working directory with / and . as ->/memory`, derived from its working directory) through path-scoped permission rules (`Edit(//abs/.../memory/**)`, which covers every file-editing tool); the places that matter (its working directory, `~/.paseo`, `~/src`, `~/.ssh`, Claude settings) are denied, and any other path falls to the permission prompt, which the Assistant cannot answer. `assistant_session_renew(handover, heartbeatId?)` lets it start its own New session: the plugin saves the handover (`handover.json`), creates the new session with it as the first message (marked as notes from the previous session), and archives the old one a few seconds later. The new session deletes the old heartbeat before creating its own, so there are never two. At most one renew every 10 minutes.

## Forwarders and the diagnostic

`assistant_mail`, `assistant_mailbox` and `assistant_mark_read` only forward to Agents Mail, for agents created before Agents Mail that still hold the old tool. The plugin counts their calls (`shim-usage.json`) and logs, a minute after start and then hourly, how many live agents still hold an `assistant_mail` capability; the RPC `assistant.shims` gives the same (`liveHolders`, `uses`, `lastUsedAt`, `removable`). When `removable` is true the forwarders can be deleted. The Assistant stores no mail of its own (the one-time import of the old `mailbox.json` is gone: the daemon never had one).

## Decision ids, asking in chat, and the panel width

- Each decision card shows its short id (the first 8 characters) as a chip next to the title, copyable on click through the host clipboard (selectable text on a host without one). `assistant_decision_list` shows it as `shortId` and takes an `id` filter; `assistant_decision_close` accepts the short id or the full one.
- **Chat is for status only.** The prompt makes it a hard rule that every question or choice for the human is queued with `assistant_decision_add`, with an example of each. As a non-blocking check, when an Assistant turn ends with a reply whose last paragraph asks the user something (ends in "?" or offers options) and no decision was queued in that turn, a note ("You asked the user in chat; queue it with assistant_decision_add") is put in front of its next prompt through the `agent.prompt` hook, or sent as a steered message to an idle Assistant on a host without the hook. The reply is never blocked or changed; the heuristic is wrong now and then, and the note says so by being only a note.
- The side panel is resizable by dragging its left edge (the handle shows a resize cursor): 280 px up to 60% of the window, saved on release on the daemon (`ui.json`, RPC `assistant.ui.get`/`set`) and restored on reload. Compact layouts are unchanged.

## Your Actions

Open items have an `owner`: `agent` (the default, also for items saved before owners existed) for waits, `human` for what you must DO: merge a PR, run a command, enter a Secret, sign in. `assistant_item_add` and `assistant_item_update` take `owner`, and the tools show it. The **Your Actions** tab lists the open `human` items with a count: the title and the detail, a markdown text of steps (up to 8000 characters) rendered with the host's markdown renderer and each fenced code block as a block with a Copy button. The **Current Tasks** tab keeps the `agent` items only. The Assistant adds an item with owner `human` for anything you must do, closes it when it is done, and answers "what do I need to do?" from that list. The sidebar badge stays decisions-only.

## Item ids, listing, staleness and the heartbeat review

- Cards in **Current Tasks** and **Your Actions** have the same copyable 8 character id chip on the header row as decision cards (one shared `CardHeader`; the right side shows "closed" or a "stale?" badge). `assistant_item_update` and `assistant_item_close` accept the short id or a unique prefix of 4+ characters.
- `assistant_item_list(status?, owner?)` returns id, shortId, title, owner, status, stale, detail, link, createdAt, updatedAt (and closedAt/note for closed ones); open by default.
- An open item with no update for 24 hours shows a small **stale?** badge; any update to it resets it.
- On each 15-minute mailbox heartbeat the Assistant also reviews the open items after the mailbox: it lists them, checks each against the agent's status, the PR or run it links to and the mail, and closes or updates stale ones. The heartbeat's own text ("Process the Assistant mailbox") does not change; the system prompt makes the review part of processing it, so the existing heartbeat keeps working.
