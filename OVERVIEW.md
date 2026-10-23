Overseer is a first mate for the other agents on your Paseo daemon. It is one long-lived conversation, docked on the right of the window, that watches your agents, passes on their questions and summarises what needs you. A header button in every workspace opens it, and it stays put when you switch workspace.

## How it works

The plugin runs one Overseer agent per daemon, in a hidden background workspace. It is created the first time you open the dock and recreated if it is archived. The conversation uses the same composer as any agent, with model, effort and mode pickers, attachments and voice input. New session archives the current conversation and starts a fresh one.

Version 1 only watches, routes and summarises. The Overseer reads agent status, activity and pending permissions with Paseo's own agent tools. It does not send prompts to other agents, nudge, cancel or approve anything.

## Setup

Needs a Paseo build with the app dock, the right-hand panel plugins can add tabs to. The provider and model are a setting, claude/claude-sonnet-5-5 by default, and apply from the next new session.

If the Agents Inbox, Agents Warder or Agents Leases plugins are installed, the Overseer uses their tools: it asks you through the inbox when an agent needs a human answer, and looks at watched tasks and held leases. Without them it works from the Paseo agent tools and puts questions in its own chat.

## What it reads and where it runs

The Overseer is an ordinary agent on your configured provider, so what it sees of your agents' activity is sent to that provider. Its state, the ID of the current conversation, is kept in the plugin data folder on the daemon machine.
