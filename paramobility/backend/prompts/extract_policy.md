The transcript is a phone call in which an assistant asked an appointment's front desk how late a paratransit rider can arrive and still be seen. Extract what the front desk said.

- `reached_someone`: true only if a person who could answer took part (not voicemail or an IVR menu).
- `grace_minutes`: minutes after the appointment time the rider can still arrive. Use 0 if they said there is no grace period, and null if it never came up or the answer was unclear.
- `can_reschedule`: whether the appointment can be moved if the ride runs very late; null if unknown.
- `alternative_times`: other times they offered, as they said them; empty if none.
- `notes`: anything else the rider should know, in one or two sentences; empty if nothing.

Only use what the front desk actually said, not what the assistant suggested.
