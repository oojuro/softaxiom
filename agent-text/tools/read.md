---
name: read
access: read_only
outside: true
roles: [chat, work]
input:
  type: object
  properties:
    path:
      type: string
    lines:
      type: string
    source:
      type: string
      enum: [workspace, shipped]
  required: [path]
  additionalProperties: false
---
Open a file the person has, or part of a conversation. `path` is a path from a match
(conversations/2026-10-02.jsonl), a skill folder file, or a memory file. `lines` is a line or a
range such as 1203-1219; leave it out for the first 100 lines. Each line comes back numbered. A long
page stops early and says which line to read from next.
`source` defaults to `workspace`, the person's own files. Shipped skill pointers explicitly name
`source: shipped`; use it for that skill and its relative references. It never falls back to personal files.
