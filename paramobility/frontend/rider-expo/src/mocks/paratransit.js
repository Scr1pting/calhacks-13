// MOCK East Bay Paratransit booking. EBP only takes bookings by phone, and
// the team's rule is never to call real agency lines (HANDOFF.md), so this
// stands in for the reservations call: it walks through the same steps with
// short pauses and returns a made-up confirmation number. The pickup time
// itself is recorded on the backend for real (see useLeewayFlow).

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Calls onStep(1) when "connected", onStep(2) when the window is accepted.
// Resolves with the confirmation number once the caller has recorded the
// booking and EBP "confirms".
export async function requestPickupWindow(onStep) {
  await pause(1800)
  onStep(1)
  await pause(1800)
  onStep(2)
}

export async function confirmBooking() {
  await pause(1500)
  return `#${Math.floor(40000 + Math.random() * 60000)}`
}
