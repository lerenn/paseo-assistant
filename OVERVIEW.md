Assistant is a first mate for the other agents on your Paseo daemon. It is one long-lived conversation that watches your agents, passes on their questions and summarises what needs you. A sidebar entry opens its screen, with Chat, Mailbox and Decisions tabs.

## How it works

The plugin runs one Assistant agent per daemon, in a hidden background workspace. It is created the first time you open the screen and recreated if it is archived. The Chat tab embeds its conversation with the usual composer when the host provides `AgentChat` (the Paseo fork does), and otherwise has a button that opens it as an ordinary agent. New session archives the current conversation and starts a fresh one.

The Assistant watches, routes, summarises and relays. It reads agent status, activity and pending permissions with Paseo's own agent tools, and it can message other agents (coordinators included) with `send_agent_prompt`, to pass on a decision you gave it or to ask for status; relayed decisions are signed as coming from the Assistant on your behalf. It never creates, archives, kills, cancels or changes agents or modes, and never answers permission requests.

## Setup

Needs the daemon setting `mcp.injectIntoAgents` turned on, so the Assistant gets Paseo's own agent tools. The provider and model are a setting, claude/claude-sonnet-5-5 by default, and apply from the next new session.

If the Agents Inbox, Agents Warder or Agents Leases plugins are installed, the Assistant uses their tools: it asks you through the inbox when an agent needs a human answer, and looks at watched tasks and held leases. Without them it works from the Paseo agent tools and puts questions in its own chat.

## What it reads and where it runs

The Assistant is an ordinary agent on your configured provider, so what it sees of your agents' activity is sent to that provider. Its state, the ID of the current conversation, is kept in the plugin data folder on the daemon machine.

## Mailbox

New top-level agents mail the Assistant with the MCP tool `assistant_mail(subject, body, kind)` at milestones only: start, blocked, needs_user, pr, done. The sender is the calling agent, never what it claims. Mails are kept in the plugin data folder and listed in the Mailbox tab, unread first, each linking to its agent. The Assistant reads them with `assistant_mailbox` and `assistant_mark_read`, from a 15-minute Paseo heartbeat it sets up at the start of a session; any new mail also wakes it when it is idle (debounced, so a burst gives one wake); a running Assistant is never interrupted and reads the mail on its next mailbox read. `needs_louis` is still accepted as an alias of `needs_user`.

Which agents are told to mail is two settings, `mailIncludeLabels` and `mailExcludeLabels` (label rules such as `key=value` or `key`, comma separated). Subagents are always left out; an include rule wins over an exclude rule. Defaults leave out agents labelled `paseo.factory=1` except `paseo.factory.supervisor=1`. This needs a Paseo build whose `agent.create` hook carries labels and the parent agent; on an older daemon nothing is injected. The mailbox listens on `127.0.0.1:47842` (`PASEO_ASSISTANT_PORT` to change). An Assistant created before this feature has no mail tools: use New session.

## Decisions

When something needs your choice, the Assistant queues it with `assistant_decision_add(question, options, recommended)` (2 to 4 options, the recommended one shown first and marked) instead of waiting on you in chat. The Decisions tab shows a count badge and lists the open ones; pick an option or choose "Other…" to type your own answer. The answer goes straight back to the Assistant as a message with the decision id, question and answer, so it can act. Answered decisions stay under a collapsed "Answered" section.
