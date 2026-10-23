# Shared saved-login vault

The vault is part of Soft Axiom. Its portable engine, encrypted envelope, saved-login record
schemas, origin checks, authenticator codes and secret redaction are Apache-2.0 source here.
Managed accounts, database queries, key provisioning and browser fleets belong to the host.
It preserves saved logins and supplies credential versioning and trusted browser key capture.
It also supplies an ordered rotation coordinator and daily recurrence policy; hosts own execution.

## Using the core

```ts
import { createVault } from "@softaxiom/memory/core/vault";

const vault = createVault({ rows: encryptedLoginStore });
const saved = await vault.describe(personId, connectionId); // metadata only
const status = await vault.typePassword({ personId, connectionId, tab, ref: "e2" });
```

`encryptedLoginStore` implements `VaultRows<Row, Transaction>`; `tab` implements `SecretTab`.
Both are trusted host ports, supplied explicitly. Importing the module opens no database,
reads no environment credential, starts no scheduler and configures no hosted service.

The store must enforce person ownership, encrypted persistence, record-version decoding,
atomic writes and typing markers. `secretOf` opens the same row whose origins were checked.
`savedFrom` opens only origins/metadata. `get` and `list` must not return another person's rows.
`put` must preserve the stored authenticator when replacing a password; origins and secret
changes commit together. Changes to allowed origins use compare-and-set or row locks.
`addOriginIn` runs inside the caller's authorization transaction.

The cloud supplies its existing Postgres/key-service adapter. A self-hosted application must
supply a real encrypted store and key provider; an in-memory store is only a test fixture.
This release does not add a local vault CLI, persistent local keyring or OS-keychain integration.

## Secret typing and outcomes

The engine checks that automatic sign-in is enabled and the page is on a saved exact HTTPS
origin before opening a password or authenticator seed. It never broadens a login to another
host, port or look-alike domain. The browser's `typeSecret` checks the current field and form
destination against those origins in the same action as typing, so navigation between checking
and typing cannot send a secret elsewhere.

Before password typing the store atomically claims a marker. Concurrent calls lose that claim.
`typed` keeps the marker until `settle`; a thrown browser call returns `uncertain` and also keeps
it. A definite refusal releases it. The host persists markers across process restarts. The
existing sign-in marker expires after ten minutes by default; it is not a rotation journal or
a guarantee of exactly-once browser effects. Rotation uses separate durable receipts and explicit reconciliation.

The core returns status words and metadata, never the password, seed or generated code. The
trusted browser receives plaintext for typing. Hosts call `scrub`, `scrubValue` or `scrubError`
before forwarding text to models or diagnostics. Redaction covers known text/encoded forms;
it does not sanitize screenshots, unknown newly generated keys or arbitrary encodings. Secure
key capture must be implemented before a create/reveal page is exposed to the model.

## Stored format compatibility

`sealWith` and `openWith` preserve the existing AES-256-GCM envelope:
`{ v: 1, kv, iv, tag, data }`, with random 12-byte IVs and base64 fields. Associated data is
`JSON.stringify(["sa", table, personId, rowId, purpose, keyVersion])`. Moving ciphertext across
people, rows, fields or key versions fails authentication. Hosts supply the 32-byte key for
the selected key version; the core does not provision or persist keys.

Saved-login record version 1 remains `{ password, totp? }`; its separate origins record remains
`{ origins, authenticator? }`. The Zod schemas preserve unknown top-level fields. No record,
key, grant or existing ciphertext is rewritten by this extraction. Future API-key rotation
must distinguish a provider credential version from an encryption-key version.

## Verification

`npm run check` includes the portable vault tests and a strict consumer type contract.
`fixtures/vault-v1.json` contains only synthetic values sealed by the implementation before
extraction; it is a frozen read-compatibility fixture. Tests cover ownership, origin refusal
before opening secrets, concurrent marker claims, lost typing responses, authenticator codes,
encoded redaction, changed records and ciphertext bindings. Hosts must additionally test their
real database roles, encryption adapters, browser fields and migration paths.

## Credential versions and browser capture

`createCredentials` is a trusted worker API. It prepares an immutable version, captures a key as
`candidate`, then separately promotes it with the expected current version. Promotion retires
the old stored version; it does not revoke that key at the provider or update its consumers.
Provider verification and authorization must precede promotion. Credential version IDs, record
schema versions and encryption key versions are independent. Existing saved-login records stay
unchanged. This slice accepts printable ASCII API tokens of 8–8192 characters, not PEM documents.

Hosts implement `CredentialRows` with encrypted plans/secrets, atomic claims, tenant ownership,
immutable operation parameters and compare-and-set promotion. `prepare` must durably quarantine
the connection before returning. It serializes against every browser read, action, title, URL,
probe, live view and screenshot; all tabs/popups remain private across worker restarts. Missing
privacy enforcement must refuse capture. `browserKeyScript` / `captureBrowserKey` are trusted
adapter primitives, never model tools. They only read one matching main-document element on the
exact approved HTTPS URL. The provider page can lie about its value; capture is not verification.

The host uses a separate capture browser identity with the account profile, ends the ordinary
browser before opening it, and exposes no capture handle to models. It must recheck the durable
privacy block after connecting and before reveal. Capture claims commit before revealing once.
A lost response or failed save stays uncertain, with the browser private; calling capture again
never reveals again. Cleanup closes the whole capture browser before committing the unblock,
serialized with capture and ordinary browser access. Repeated cleanup must not close a later
ordinary browser. Cleanup failure preserves privacy and prevents promotion. These are host
requirements, exercised by real database/browser tests in the cloud integration.

Only metadata/status returns from the coordinator. Plaintext moves from the browser adapter to
the encrypted store; raw browser errors are discarded. All retained candidate/current/retired
values participate in text redaction. Unknown values in an uncertain capture are protected by
the quarantine, including screenshots. A trusted operator may close an uncertain capture without
claiming the key was saved; provider reconciliation is still required. There is no new LLM tool,
provider recipe or local persistent vault adapter. Hosted rotation is opt-in and requires adapters.

## Rotation workflow and daily scheduling

`runRotation(store, driver)` orders capture, candidate verification, consumer installation,
consumer verification, current-version promotion and previous-key revocation. It accepts only
version/connection/operation metadata; the trusted driver handles plaintext. A host must verify
that the candidate differs from the current secret, matches the pinned provider account and has
the required scope. Consumer verification must cover every live consumer before revocation;
publishing a new credential bundle alone does not prove a running process uses it.

`RotationStore` persists encrypted, person-owned receipts and atomically compares the full
operation binding and revision. It commits `running` before each effect. Concurrent workers
cannot claim the same step. After a crash or lost acknowledgement, `running`/`needs_attention`
blocks redispatch. `reconcileRotation` advances only from trusted read-only proof of that exact
step's postcondition; it never repeats a create, install or revoke call. A refusal stops the
workflow too, retaining the old key and evidence for review. There is no automatic rollback of
provider effects. A paused step needs an explicit host resume after authority is restored.

The driver must recheck user opt-in, rollout, unchanged account/consumer binding and spending
admission before each dispatch. Missing recipes return `unsupported`. Recipes must be versioned,
reviewed host code; selectors or permission claims from page content or an LLM are not authority.
Unknown provider errors are discarded. Returned receipts contain no keys or provider bodies.

`dailyRotationInput` validates explicit enablement, local HH:MM, time zone and recipe/consumer
identifiers. `nextDailyRotation` reuses the shared clock: DST folds run once, gaps move forward,
and missed days produce at most one catch-up followed by the first future occurrence. The host
must atomically persist a stable occurrence receipt with the advanced due time and keep only one
unfinished rotation per credential. An unfinished or uncertain rotation blocks subsequent days.
The pure core starts no scheduler; the hosted service owns Temporal polling and policy APIs.

Tests cover ordered effects, concurrency, unknown outcomes at every stage, lost receipt commits,
read-only reconciliation, missing support/authority, DST transitions and missed-day catch-up.
Existing saved-login format and typing tests remain unchanged.

### Cloudflare user token adapter (preparation)

`createCloudflareTokens(fetch)` implements Cloudflare's documented user-token
create, verify, inspect and delete APIs. A separate, explicitly supplied management
token needs API Tokens Read/Write; it never comes from the environment. Creation
clones the previous token's permission IDs, resources, IP restrictions and validity
window without extending them. Unknown policy/restriction fields refuse issuance.
The fixed HTTPS transport refuses redirects, bounds replies, suppresses provider
error content and never retries a mutation. Account-owned tokens are unsupported.

`captureProvider` claims the same encrypted version row as browser capture, stores
the returned token and provider ID, and releases quarantine only after persistence.
The provider-tagged plan retains the original approved browser plan as provenance;
its selectors are unused. Browser capture refuses provider plans. A lost create or
save response stays uncertain after restart; cleanup/reconciliation never creates
another token. A successful creation alone does not prove matching permissions:
`verify` reads the candidate and previous policies before consumer installation.

Hosts must bind the account, credential, management credential, recipe and consumer
before admission. Consumer installation, read-only reconciliation and fresh proof
that **all** consumers use the candidate remain trusted host responsibilities.
Revocation must follow that proof and promotion. This module does not register a
hosted consumer, enroll accounts or enable unattended rotation. Synthetic contract
checks are not live-provider staging acceptance.

Contract references: [create](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/create/),
[inspect](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/get/),
[delete](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/delete/),
[management token guidance](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/).
GitHub's [credential revocation API](https://docs.github.com/en/rest/credentials/revoke)
is for exposed credentials and is not used as an owner rotation adapter.
