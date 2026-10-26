Assistant is a first mate for the other agents on your Paseo daemon. It is one long-lived conversation that watches your agents, passes on their questions and summarises what needs you. A sidebar entry opens its screen, with Chat, Mailbox, Decisions and Open items tabs.

## How it works

The plugin runs one Assistant agent per daemon, in a hidden background workspace. It is created the first time you open the screen and recreated if it is archived. The Chat tab embeds its conversation with the usual composer when the host provides `AgentChat` (the Paseo fork does), and otherwise has a button that opens it as an ordinary agent. New session archives the current conversation and starts a fresh one.

The Assistant watches, routes, summarises and relays. It reads agent status, activity and pending permissions with Paseo's own agent tools, and it can message other agents (coordinators included) with `send_agent_prompt`, to pass on a decision you gave it or to ask for status; relayed decisions are signed as coming from the Assistant on your behalf. It never creates, archives, kills, cancels or changes agents or modes, and never answers permission requests.

## Setup

Needs the daemon setting `mcp.injectIntoAgents` turned on, so the Assistant gets Paseo's own agent tools. The provider and model are a setting, claude/claude-sonnet-5-5 by default, and apply from the next new session.

If the Agents Inbox, Agents Warder or Agents Leases plugins are installed, the Assistant uses their tools: it asks you through the inbox when an agent needs a human answer, and looks at watched tasks and held leases. Without them it works from the Paseo agent tools and puts questions in its own chat.

## What it reads and where it runs

The Assistant is an ordinary agent on your configured provider, so what it sees of your agents' activity is sent to that provider. Its state, the ID of the current conversation, is kept in the plugin data folder on the daemon machine.

## Mailbox

Agent mail lives in the **Agents Mail** plugin; the Mailbox tab shows the Assistant's mailbox (`@assistant`) from it, unread first, each mail linking to its agent. Agents Mail tells new top-level agents to mail `@assistant` at milestones (start, blocked, pr, done), wakes the Assistant when it is idle and has mail, and gives the Assistant the tools `mail_list`, `mail_read` and `mail_mark_read`; the Assistant also processes its mailbox from a 15-minute Paseo heartbeat it sets up at the start of a session. A running Assistant is never interrupted. Which agents are told to mail is now a setting of Agents Mail (`milestoneIncludeLabels`, `milestoneExcludeLabels`); the Assistant's `mailIncludeLabels` and `mailExcludeLabels` are ignored.

Without Agents Mail the tab says so ("Install the Agents Mail plugin to see agent mail here") and Chat and Decisions work as before. The plugin finds Agents Mail through `~/.paseo/agents-mail/endpoint.json` and its loopback API; nothing is shared between the two.

**Migration.** The first time Agents Mail answers, the Assistant moves its old `mailbox.json` into it (kept as `mailbox.json.migrated`). Agents started before the change still hold the old `assistant_mail` tool, and the Assistant's older sessions `assistant_mailbox` and `assistant_mark_read`: they keep working as forwarders to Agents Mail, and say so in their description; they report that nothing was sent when Agents Mail is not installed. Use New session to give the Assistant the new tools.

## Decisions

When something needs your choice, the Assistant queues it with `assistant_decision_add(question, options, recommended)` (2 to 4 options, the recommended one shown first and marked) instead of waiting on you in chat. The Decisions tab shows a count badge and lists the open ones; pick an option or choose "Other…" to type your own answer. The answer is queued (on disk) and delivered to the Assistant as one message, together with any new-mail wake, once it is idle: a running turn is never steered or interrupted. The message carries the decision id, question and answer, so it can act. Answered decisions stay under a collapsed "Answered" section.

## Open items

For things you are waiting on but do not have to decide ("waiting for the cluster rework PR 3", "pin PR pending restart"), the Assistant keeps a list with `assistant_item_add(title, detail?, link?)`, `assistant_item_update(id, ...)` and `assistant_item_close(id, note?)`. The Open items tab shows the open ones with a count (the sidebar badge stays decisions-only); closed items stay under a collapsed "Closed" section. Decisions are for real choices only.
