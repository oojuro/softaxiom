# Contributing

This repository is private while the first self-hosted source release is prepared.
Read the [scope and extraction checklist](docs/OPEN_SOURCE_PREPARATION.md) before making changes.

- Keep changes small and reviewable; shared assistant behavior belongs here, hosted operations do not.
- Use synthetic fixtures. Never commit credentials, customer records or private operational reports.
- Preserve permission checks, encryption, idempotency and spend bounds during extraction.
- Include a regression that demonstrates a behavioral fix and document how it was verified.
- Retain the provenance and notices of third-party components.

There is no runtime build or test command yet. Add accurate development instructions with the
first runnable source import; do not invent a working quickstart.

Contributions are made under the repository's [Apache-2.0 license](LICENSE).
