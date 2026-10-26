# paseo-assistant

A Paseo plugin: a first mate for the other agents on a daemon. See [OVERVIEW.md](OVERVIEW.md).

Uses only upstream plugin surfaces: a sidebar entry and a screen. Injecting the mail tool into new
agents also needs a daemon whose `agent.create` hook carries `labels` and `parentAgentId`.

```sh
npm ci
npm run typecheck
npm test
paseo plugin install <git url>
```
