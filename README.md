# Soft Axiom

A personal AI assistant you can run yourself, with your own model credentials and data.

**Status: private open-source preparation.** This repository currently contains the license and
preparation documents. The assistant runtime has not been extracted yet; there is no runnable
release or installation command here today. Publication requires the owner's review.

## What we are preparing

A complete self-hosted assistant in the spirit of [OpenClaw](https://github.com/openclaw/openclaw)
and [Hermes Agent](https://github.com/NousResearch/hermes-agent):

- A persistent personal agent with memory, files, prompts and skills.
- Terminal, browser and tool execution with explicit permissions and durable recovery.
- Messaging adapters, reminders, schedules and background work.
- A web interface for settings, files, results and approvals.
- Documented self-hosting using your own infrastructure and provider credentials, without a
  Soft Axiom Cloud account or subscription.

Managed hosting, commercial billing and service operations belong to a separate private cloud
repository. The cloud product will consume reviewed versions of this shared assistant rather
than maintain a second copy of its core.

See [the source boundary and release checklist](docs/OPEN_SOURCE_PREPARATION.md),
[contributing](CONTRIBUTING.md), and [security reporting](SECURITY.md).

## License

[Apache License 2.0](LICENSE). Third-party components retain their own licenses and notices.
