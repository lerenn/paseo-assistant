# paseo-assistant

A Paseo plugin: a first mate for the other agents on a daemon. See [OVERVIEW.md](OVERVIEW.md).

Uses upstream plugin surfaces (a sidebar entry and a screen); the embedded chat uses `AgentChat` when the host has it. The Mailbox tab needs the Agents Mail plugin (`lerenn/paseo-agents-mails`); without it the tab says so.

```sh
npm ci
npm run typecheck
npm test
paseo plugin install <git url>
```
