# Workspace skills and resources

Skills live in the same visible local workspace as the agent's files. They are optional advice,
not permissions or executable plugins. Nothing in a skill can authorize a browser change, grant
terminal access, approve an action or increase a runtime limit.

```text
workspace/
├── memory/                         # the existing five memory directories
└── skills/
    └── investigate-build/
        ├── SKILL.md
        └── references/
            └── troubleshooting.md
```

An example `skills/investigate-build/SKILL.md`:

```markdown
---
name: investigate-build
description: Use when investigating a project's build failure.
---
Read the relevant failure first. Consult [troubleshooting](references/troubleshooting.md)
when it applies. Report what was observed and what remains unverified.
```

Use lower-case folder names containing letters, numbers, underscores or hyphens, up to 64
characters. The front-matter name matches the folder; descriptions start with `Use when` and
are at most 200 characters. The local adapter uses the shared core's skill parser/index.

## Discovery and reading

From a built checkout, or a distribution containing this feature:

```sh
sa --workspace /path/to/workspace skills list
sa --workspace /path/to/workspace skills read investigate-build/SKILL.md
sa --workspace /path/to/workspace skills read investigate-build/references/troubleshooting.md
```

The commands need no Cloud account, model or initialized Oojuro journal. `list` returns a concise
index, `next` offset and skipped-entry count. Use `skills list OFFSET` for the next page. The
catalog is capped at offset 10,000; `limited: true` reports that limit instead of claiming a
complete listing. Directory changes between pages may change their contents; offsets are not
a snapshot. No recursive file tree or resource contents are loaded into the index.

Local chat and direct `sa agent` tasks expose a `skills` tool. It lists the index on demand, opens
only selected skill/resource files and records those reads through the existing journal/tool
accounting path. The initial model context contains tool guidance, not the skills' bodies.
The normal request/step/output limits still apply after direct filesystem edits.

Radar tasks need an explicit `skills.read` entry in their subscription's `allowedActions`.
Existing subscriptions and defaults do not gain access automatically. This is independent of
`memory`: a browser-only task cannot inspect skills, and a skills-only task gains no memory
tool or memory context. The CLI's direct request supplies both permissions for its own workspace.

## Bounds and security

- Linux/WSL2 with `/proc/self/fd`, matching the supported source-preview platforms.
- At most 20 index entries and 256 directory candidates per page. Indexing reads only each
  candidate's `SKILL.md`, at most 16,000 bytes; invalid metadata is skipped.
- Reads return at most 8,000 UTF-8 bytes per page, with `start`, `end`, `bytes` and `partial`.
  Continue with `skills read PATH END`. Skill files are at most 16,000 bytes; other resources
  are at most 64,000 bytes. Binary/invalid UTF-8 content is rejected.
- Paths stay under `workspace/skills`. Absolute paths, traversal, hidden components and
  symlinks are refused. File descriptors pin each directory against concurrent replacement;
  files must be regular, owned by the current user and have a single hard link. FIFOs, sockets
  and devices are refused without opening a blocking stream.
- The shared credential-shape check rejects recognized credentials before returning text.
  It is not complete secret detection: keep all credentials outside skills and workspace files.
- Referenced scripts are read as outside text; this tool never executes them or fetches URLs.
  It grants no network, terminal, arbitrary workspace-file or private application-state access.

This feature does not make local execution an OS sandbox. Scoped file/terminal execution,
paired-device enforcement and full assistant release acceptance remain separate work.
