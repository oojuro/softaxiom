---
name: activity_result
access: read_only
outside: true
roles: [chat, work]
input:
  type: object
  properties:
    ref:
      type: string
    offset:
      type: integer
      minimum: 0
  required: [ref]
  additionalProperties: false
---
Read the rest of a result that was too long to show. A shortened result ends with a marker that
gives `ref` and the `offset` to continue from; pass them as shown. Each call returns the next page.
