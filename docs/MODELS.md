# Local model access

Current-source setup needs no Soft Axiom Cloud account or subscription. Linux/WSL2, Node/npm,
`flock`, and the separately installed Oojuro executable remain prerequisites for local agent work.
The immutable installer in the README still selects an earlier preview; build current source
before using these commands.

```sh
npm ci --ignore-scripts
npm run build
node bin/softaxiom.js setup
node bin/softaxiom.js --workspace /path/to/workspace init
node bin/softaxiom.js --workspace /path/to/workspace chat --local 'Help organize my project memory'
```

Once installed, use `sa` in place of `node bin/softaxiom.js`.

Setup asks for a provider, model ID and masked API key:

| Choice | Protocol | Endpoint |
| --- | --- | --- |
| `openai` | Responses API | `https://api.openai.com/v1` |
| `anthropic` | Messages API | `https://api.anthropic.com/v1` |
| `compatible` | OpenAI-compatible Chat Completions | Your explicit HTTPS endpoint or loopback HTTP server |

Enter the model ID your provider actually offers; setup makes no model call or automatic model
selection. A keyless local server can leave the key blank. Third-party model/API costs are yours.
Provider subscription sign-in remains separate work; this command does not copy credentials from
ChatGPT, Claude Code or another application and does not claim subscription access is implemented.

The profile and key live together under `~/.local/state/softaxiom/local-model.json`, or the
explicit `SOFTAXIOM_STATE_DIR`. The directory is private, files are owner-only, and reads/writes
use the existing cross-process OS lock and atomic replacement. This protects against other OS
users, not programs already running as you. Keep this directory out of shared folders, source
control and backups intended for others. Secrets do not belong in `memory/config.json`, terminal
arguments, prompts, Radar events, diaries or skills.

`sa model status` prints nonsecret setup metadata; `sa model logout` removes this local profile
and key. These do not change Cloud login. `sa logout` removes the Cloud session and preserves
model setup. Offline status does not prove a key is valid or a provider is reachable.

Model selection and credentials come only from the private setup profile. Workspace content
cannot choose an endpoint or name an environment variable to read. The legacy `apiKeyEnv` field
is retained for reading old configs but is not used for authentication.
For an existing nonempty `model.name`, its name and URL must match the saved profile or execution
stops with `MODEL_PROFILE_MISMATCH`, before any request. Run `sa setup` for that pair, or clear
`model.name` to use the saved selection. Keyless local servers also need an explicit setup choice.
Init preserves existing settings/data; it does not grant credential or endpoint authority.

The model adapter uses the installed shared provider adapters directly, without a hosted gateway.
Each round is limited by the existing context/request, output-token, response-size and 90-second
timeout bounds. SDK retries are disabled. OpenAI Responses requests set `store: false`; this is
not a promise about the provider's separate retention terms. Only readable answer text and tool
calls enter the readable local runtime; hidden reasoning and provider metadata are excluded from
journals and command output. Provider replay envelopes stay in bounded process memory for the
matching request history and credential/endpoint, so stateless tool rounds can continue. Tools still
pass through local authorization, journaling, accounting and step limits.

Replay fingerprints ignore JSON object key order using the same canonical encoding as action
authorization. A real Oojuro round trip and an actual local model/tool loop exercise continuation;
the provider envelope remains absent from the complete readable journal records.

This is local memory/browser agent setup, not a claim that arbitrary terminal execution, paired
devices, the web UI, subscription login or the complete fresh-install journey is finished.

## Hosted policy is separate

The public CLI is model agnostic. Its operator-selected provider/profile is not a hosted route.
The private hosted composition uses the shared `fireworksModels` policy factory, restricted to
its reviewed Fireworks model and exact endpoint; it does not inherit local profiles, keys or
fallbacks. External specialists have their own declared execution boundary and receive no keys
implicitly. Both modes initially use embedding-free memory retrieval.
