# Contributing

This repository is private while the first self-hosted source release is prepared.
Read the [scope and extraction checklist](docs/OPEN_SOURCE_PREPARATION.md) before making changes.

- Keep changes small and reviewable; shared assistant behavior belongs here, hosted operations do not.
- Use synthetic fixtures. Never commit credentials, customer records or private operational reports.
- Preserve permission checks, encryption, idempotency and spend bounds during extraction.
- Include a regression that demonstrates a behavioral fix and document how it was verified.
- Retain the provenance and notices of third-party components.

The memory slice uses Node 22.19+, Linux `flock` and the real Oojuro front-door CLI.
Run `flock /tmp/sa11-verification.lock npm run check`; set `OOJURO_BIN` if the executable is
not on PATH. Tests use synthetic data and local HTTP fixtures. No hosted credentials are needed.
See [memory architecture and verification](docs/MEMORY.md). Real-model evaluation is deferred.

Contributions are made under the repository's [Apache-2.0 license](LICENSE).
