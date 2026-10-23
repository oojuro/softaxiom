# Shared saved-login vault

The vault is part of Soft Axiom. Its portable engine, encrypted envelope, saved-login record
schemas, origin checks, authenticator codes and secret redaction are Apache-2.0 source here.
Managed accounts, database queries, key provisioning and browser fleets belong to the host.
This first slice preserves saved logins; API-key inventory, credential version promotion,
browser capture of newly issued keys and scheduled rotation are subsequent work.

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
a guarantee of exactly-once browser effects. Rotation will need its own durable reconciliation.

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
