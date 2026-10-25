import { Platform } from 'react-native'

// Reads the rider's phone calendar (iOS/Android ask for permission first):
// every entry in the next two weeks, as the backend's calendar sync takes
// them. The backend then decides with Haiku which entries need a ride.
//
// expo-calendar is native only: it doesn't run on web, and needs a
// development build (`npx expo run:ios` / `run:android`) rather than Expo Go.
// Wherever it can't run, or the rider says no, this returns null and the app
// uses the mock calendar (src/mocks/calendar.js) instead.

const HORIZON_DAYS = 14 // the backend plans rides up to two weeks ahead

const iso = (d) => new Date(d).toISOString()

export async function readDeviceCalendar() {
  if (Platform.OS === 'web') return null
  try {
    // Required here, not imported at the top: where the native module is
    // missing (Expo Go), importing it would throw before the app starts.
    const Calendar = require('expo-calendar')
    const { status } = await Calendar.requestCalendarPermissions()
    if (status !== 'granted') return null
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT)
    if (!calendars.length) return null
    const start = new Date()
    const end = new Date(start.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000)
    const events = await Calendar.listEvents(calendars, start, end)
    return events.map((e) => ({
      // A repeating event shares its id across occurrences; the start tells them apart.
      id: `${e.id}@${iso(e.startDate)}`,
      title: e.title || '',
      start: iso(e.startDate),
      end: e.endDate ? iso(e.endDate) : null,
      all_day: !!e.allDay,
      location: e.location || '',
      notes: e.notes || '',
    }))
  } catch (e) {
    console.warn('reading the phone calendar failed, using the mock calendar', e)
    return null
  }
}
