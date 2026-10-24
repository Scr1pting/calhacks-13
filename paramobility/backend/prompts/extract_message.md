The transcript is a phone call in which an assistant passed a paratransit rider's message to their appointment's front desk. Extract the outcome.

- `reached_someone`: true only if a person took part (not voicemail or an IVR menu).
- `delivered`: true if a person heard the message, or it was left on voicemail.
- `response`: what the front desk said in reply, close to their words, in one or two sentences. Empty if nothing.

Only use what the front desk actually said.
