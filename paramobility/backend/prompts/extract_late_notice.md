The transcript is a phone call in which an assistant told an appointment's front desk that a paratransit rider is running late. Extract the outcome.

- `reached_someone`: true only if a person took part (not voicemail or an IVR menu).
- `acknowledged`: true if a person confirmed they understood the rider is late, or if a voicemail was left.
- `appointment_held`: true if they said the rider can still be seen, false if the appointment is cancelled or must be moved, null if unclear.
- `notes`: anything the rider should know, such as a new time, in one or two sentences; empty if nothing.

Only use what the front desk actually said.
