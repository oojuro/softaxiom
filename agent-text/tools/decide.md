---
name: decide
access: read_only
outside: false
roles: [authority]
input:
  type: object
  properties:
    decision:
      type: string
      enum: [allow, deny, ambiguous]
    message:
      type: string
      description: The id of the person's message that settles it, copied exactly as given.
  required: [decision]
  additionalProperties: false
---
Give your one decision. `allow`: the person's own message asks for this effect, or answers yes to
this request; name that message in `message`. `deny`: they said no, cancelled or narrowed it.
`ambiguous`: anything else, including when they never asked for it.
