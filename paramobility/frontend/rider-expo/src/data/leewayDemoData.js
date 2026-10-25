// Sample data for the Leeway rider-app demo flow, ported from the APPTS /
// CHAT / SUGG objects in design-reference/Leeway Denise Prototype.dc.html.
// All names, times, percentages and confirmation numbers are sample data,
// same as the original prototype.
//
// Shaped close to the backend's `Trip` / `TripOption` (paramobility/docs/
// INTERFACES.md) where the design maps cleanly onto it. Fields that don't
// exist in the backend schema yet are flagged — check with the backend team
// before wiring up real data:
//   - `visitReason`: backend's `appointment` only has `name`/`phone` (the
//     place), not a separate visit-type string ("Neurology").
//   - `pickupWindowMinutes`: backend only exposes `booked_pickup` (a single
//     time), not a window length. 30 min matches EBP's standard window
//     (see HANDOFF.md).
//   - `confirmationNumber`: not in the Trip shape; would likely come back
//     as part of a `booked` event's data once the backend defines it.

export const LOCATION = {
  name: 'Kaiser Oakland',
  address: '3600 Broadway, Oakland',
}

export const APPOINTMENTS = {
  neuro: {
    key: 'neuro',
    visitReason: 'Neurology',
    day: 'Tuesday',
    date: 'Tue, Nov 3',
    arriveByTime: '10:30 AM',
    pickupWindowStart: '9:15',
    pickupWindowEnd: '9:45',
    pOnTime: 0.86,
    confirmationNumber: '#48213',
    explanation:
      'Weekday morning rides from your area to Kaiser took 35 to 60 minutes over the last 3 months.',
  },
  pt: {
    key: 'pt',
    visitReason: 'Physical Therapy',
    day: 'Thursday',
    date: 'Thu, Nov 5',
    arriveByTime: '2:00 PM',
    pickupWindowStart: '12:45',
    pickupWindowEnd: '1:15',
    pOnTime: 0.82,
    confirmationNumber: '#48390',
    explanation:
      'Midday rides from your area to Kaiser took 30 to 55 minutes over the last 3 months.',
  },
}

// Extra "also booked" rows for the everyday-home screen — hardcoded sample
// rows in the original prototype too, not derived from APPOINTMENTS.
export const ALSO_BOOKED_EXTRA = [
  { title: 'Physical Therapy', date: 'Thu, Nov 12 · 2:00 PM', oddsText: '84%' },
  { title: 'Dentist', date: 'Mon, Nov 16 · 11:00 AM', oddsText: '88%' },
]

export const LAST_TRIP = {
  title: 'Physical Therapy',
  date: 'Thu, Nov 5',
  arrivedText: '1:41 PM, on time',
}

export const CALL_TRANSCRIPTS = {
  yes: [
    {
      who: 'LEEWAY',
      t: 'Hi, I’m calling for Denise Carter. She has a 10:30 neurology appointment with Dr. Patel, and her paratransit ride is running about 15 minutes late.',
    },
    { who: 'FRONT DESK', t: 'Let me check with Dr. Patel’s team …' },
    { who: 'FRONT DESK', t: 'She can come at 11:00. Same doctor.' },
    { who: 'LEEWAY', t: 'Great, please move her to 11:00. Thank you.' },
  ],
  no: [],
}
CALL_TRANSCRIPTS.no = [
  CALL_TRANSCRIPTS.yes[0],
  CALL_TRANSCRIPTS.yes[1],
  {
    who: 'FRONT DESK',
    t: 'Dr. Patel is full after 10:45 today. The next opening is Thursday at 9:00.',
  },
  { who: 'LEEWAY', t: 'Thank you. I’ll check with Denise before changing anything.' },
]

export const DECISION_OPTIONS = [
  {
    key: 'thu',
    title: 'Move to Thursday, 9:00 AM',
    tag: 'Recommended',
    sub: 'I’ll cancel today’s ride so it isn’t a no-show, then plan Thursday’s ride with you.',
    label: 'Confirm',
  },
  {
    key: 'car',
    title: 'Look for an accessible ride now',
    tag: '',
    sub: 'I’d check what’s available and what it costs. Nothing is booked until you approve.',
    label: 'Check accessible rides',
  },
  {
    key: 'go',
    title: 'Keep today’s ride',
    tag: '',
    sub: 'The front desk says you may need to rebook when you arrive.',
    label: 'Keep today’s ride',
  },
]

// Canned chat replies — in production, replace the keyword matching with
// the real chat agent (see paramobility/docs/INTERFACES.md, "Chat with the
// agent"). ChatMessage there is {sender: rider|agent, kind: reply|notice,
// text}; `card`/`actions` below are UI-only presentation hints.
export const CHAT_REPLIES = {
  next: {
    text: 'Tuesday, for neurology at 10:30 AM. Be ready downstairs at 9:15.',
    card: true,
  },
  att: {
    text:
      'Yes. EBP lets one attendant ride with you at no extra cost. Should I add one to Tuesday’s ride?',
    actions: [
      ['Add attendant', 'attYes'],
      ['Not now', 'no'],
    ],
  },
  attYes: {
    text: 'Done. EBP updated ride #48213 for you and one attendant.',
  },
  cancel: {
    text:
      'That’s physical therapy on Thu, Nov 5, with pickup between 12:45 and 1:15. Should I cancel it with EBP?',
    actions: [
      ['Cancel ride', 'cancelYes'],
      ['Keep it', 'no'],
    ],
  },
  cancelYes: {
    text: 'Cancelled. EBP confirmed, and it won’t count as a no-show.',
  },
  no: { text: 'Okay, I won’t change anything.' },
  help: {
    text: 'I can check your rides, change or cancel a booking, or call the clinic for you.',
  },
}

export const CHAT_SUGGESTIONS = [
  ['When is my next ride?', 'next'],
  ['Can someone ride with me?', 'att'],
  ['Cancel Thursday’s ride', 'cancel'],
]

export function matchChat(question) {
  if (/cancel/i.test(question)) return 'cancel'
  if (/attendant|aide|someone|ride with|bring/i.test(question)) return 'att'
  if (/next|when|pick/i.test(question)) return 'next'
  return 'help'
}
