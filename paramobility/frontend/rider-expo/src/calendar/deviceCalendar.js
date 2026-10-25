import { Platform } from 'react-native'
import * as Calendar from 'expo-calendar'
import { api } from '../api/client.js'

// Reads the rider's phone calendar (iOS/Android ask for permission first) and
// lets the backend decide with Haiku which entries need a ride.
//
// expo-calendar is native only: it doesn't run on web or in Expo Go, so use a
// development build (`npx expo run:ios` / `run:android`). Wherever it can't
// run, or the rider says no, this returns null and the app keeps its sample
// appointments.

const HORIZON_DAYS = 14 // the backend plans rides up to two weeks ahead

const RIDER = {
  name: 'Denise Carter',
  home: '1520 Grand Ave, Oakland',
}

const riderId = `rider_${Math.random().toString(36).slice(2, 12)}`

const iso = (d) => new Date(d).toISOString()

async function readEntries() {
  const { status } = await Calendar.requestCalendarPermissions()
  if (status !== 'granted') return null
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT)
  if (!calendars.length) return []
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
}

// {calendar: [CalendarEvent], skipped} from the backend, or null when the
// phone's calendar can't be read.
export async function checkDeviceCalendar() {
  if (Platform.OS === 'web') return null
  const entries = await readEntries()
  if (entries === null) return null
  await api.putRider(riderId, {
    ...RIDER,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  })
  return api.syncCalendar(riderId, entries)
}
