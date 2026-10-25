The transcript is a phone call in which an assistant told an appointment's front desk that a paratransit rider is running late. Extract the outcome.

- `reached_someone`: true only if a person took part (not voicemail or an IVR menu).
- `acknowledged`: true if a person confirmed they understood the rider is late, or if a voicemail was left.
- `appointment_held`: true if they said the rider can still be seen, false if the appointment is cancelled or must be moved, null if unclear.
- `new_time`: the new appointment time both sides agreed on for the same day, as HH:MM (24-hour); empty if the time wasn't moved or no time was agreed.
- `notes`: anything the rider should know, in one or two sentences; empty if nothing.

Only use what the front desk actually said.
