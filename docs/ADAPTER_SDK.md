# Portable adapter SDK

Import `githubAdapter`, `adapterFor` and `createGithubMcp` from `@softaxiom/memory/adapters`.
The SDK is Apache-2.0, original project code with no npm dependencies. It contains service
mappings, setup descriptors, identity probes and the existing GitHub PR event normalization.
It has no hosted browser SDK, platform credentials, durable timers, billing or automatic daemon.
The caller owns secret storage, account scope, scheduling, retry/backoff and user notifications.

```js
import { githubAdapter, createGithubMcp } from '@softaxiom/memory/adapters';
const setup = githubAdapter.configure('api'); // also browser / mcp
const health = await githubAdapter.probe({ transport: 'api', token: yourSecretStoreValue });
const mcpHealth = await githubAdapter.probe({ transport: 'mcp',
  mcp: createGithubMcp({ token: yourSecretStoreValue }) });
```

Do not log those inputs. The API probe reads `/user`. MCP initializes a short read-only session,
calls `get_me` and closes the session; no model or write tool is used. A caller may instead inject
its own MCP peer using `mcp.call(tool, args)` (including a local stdio transport).

For browser health, inject `browser.read({url,selector,attribute})`, returning `{url,value}`.
`LocalBrowser` implements that interface using the person's installed browser. A managed browser
can implement it outside this repository. The GitHub mapping visits `/settings/profile` and reads
`meta[name="user-login"]`; it returns no cookies/passwords. Use the account's existing profile,
serialize access with human/agent drivers, and close only the probe's own tab. Expected account
comparison prevents a switched account from being silently accepted. Missing/changing markup is
an unknown/degraded check, not proof of logout. Login/sudo redirects require reconnection.

`adapterFor({origins})` discovers GitHub only from the exact approved `https://github.com` origin.
API/MCP binding must be explicit: a token name or prefix does not authorize sending it to a service.
`configure()` describes available read-only health/events; it never grants new write permissions,
registers a webhook or expands which repositories a subscription watches.

Healthy, reconnect-required and retry outcomes are distinct. HTTP 401 requires reconnect; SSO
challenges remain visible; throttling/server failures must back off. A stale probe must not overwrite
a newer credential, user removal or profile identity. Persist changes with the caller's generation
precondition. Report bounded codes, never raw provider errors or response bodies.

A read can help keep an idle browser session active, but cannot override a provider's revocation,
absolute expiry, SSO/2FA or device challenge. GitHub [typically expires sessions after two weeks of
inactivity](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github#session-cookies).
Personal access tokens cannot be renewed by pinging. Expiring GitHub App user tokens need the
[documented refresh flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
and durable one-time rotation in the credential owner; that flow is not implemented by this initial
PAT/browser/MCP probe SDK. Never replay a refresh with an unknown outcome.
