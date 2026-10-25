# paseo-assistant

A Paseo plugin: a first mate for the other agents on a daemon. See [OVERVIEW.md](OVERVIEW.md).

Needs a Paseo build with app dock panels (`addAppPanel`) and `AgentChat`; `types/app-dock.d.ts`
declares them until the published `@getpaseo/plugin` types include them.

```sh
npm ci
npm run typecheck
npm test
paseo plugin install <git url>
```
