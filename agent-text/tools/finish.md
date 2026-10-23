---
name: finish
access: effect
outside: false
roles: [chat, work]
input:
  type: object
  properties:
    outcome:
      type: string
      enum: [done, waiting, blocked]
    goal:
      type: string
      enum: [achieved, partly, not_achieved, unknown]
    evidence:
      type: string
    notification:
      type: string
  required: [outcome]
  additionalProperties: false
---
End this run. `done` means nothing is left to do now, `waiting` means you are waiting for something
that will wake you, `blocked` means you cannot go on without the person. Call it after your last
message, in its own call. A work agent also says in `goal` whether the goal was met, which is not
the same as finishing, and puts its report in `evidence`: what it did and saw, and where the files
are.

For a Radar or Compass task only, `notification` proposes one short useful message to the person.
Leave it out when nothing needs their attention. Code checks the task's source, quiet hours and
shared notification allowance, and adds its label; this field grants no authority on other tasks.
