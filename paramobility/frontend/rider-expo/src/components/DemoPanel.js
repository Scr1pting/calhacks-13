import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors, fonts, type } from '../theme/tokens'

// The demo controls: what the backend knows about the current trip, its
// recent activity, buttons that send real ride updates (as the van's
// tracking would), and every screen to jump to. Shown beside the phone frame
// on a wide browser, or in DemoMenu (from the top bar's menu button) on a
// phone. Development/demo tool, not part of the rider-facing product.
//
// `onAction` runs after a jump or a simulated update, so the menu can close.
export default function DemoPanel({ demo, onAction }) {
  const act = (run) => () => {
    run()
    onAction?.()
  }

  return (
    <View style={styles.panel}>
      <View style={styles.intro}>
        <Text style={styles.title}>Denise's journey</Text>
        <Text style={styles.desc}>
          The app talks to the live backend at {demo.apiBase}.{' '}
          {demo.calendarSource === 'phone'
            ? 'The calendar is this phone’s own'
            : 'The calendar is a mock'}{' '}
          and the East Bay Paratransit booking call is a mock; planning, monitoring, the clinic calls
          and chat are real.
        </Text>
        <Text style={styles.desc}>It’s {demo.riderClock}.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>JUDGE DEMO</Text>
        <Pressable accessibilityRole="button" style={styles.demoButton} onPress={act(demo.onStartDemo)}>
          <Text style={styles.demoLabel}>Start judge demo</Text>
        </Pressable>
      </View>

      <CallNumber calls={demo.calls} />

      <View style={styles.section}>
        <Text style={styles.heading}>SIMULATE</Text>
        {demo.simulate.map((sm) => (
          <Pressable
            key={sm.label}
            accessibilityRole="button"
            style={[styles.simButton, sm.disabled && styles.disabled]}
            disabled={sm.disabled}
            onPress={act(sm.onClick)}
          >
            <Text style={styles.simLabel}>{sm.label}</Text>
          </Pressable>
        ))}
      </View>

      {demo.groups.map((g) => (
        <View key={g.title} style={styles.section}>
          <Text style={styles.heading}>{g.title}</Text>
          {g.steps.map((st) => (
            <Pressable
              key={st.label}
              accessibilityRole="button"
              style={[styles.navButton, st.active && styles.navButtonActive]}
              onPress={act(st.onClick)}
            >
              <Text style={[styles.navN, st.active && styles.activeText]}>{st.n}</Text>
              <Text style={[styles.navLabel, st.active && styles.activeText]}>{st.label}</Text>
            </Pressable>
          ))}
        </View>
      ))}

      {demo.graveyard?.length > 0 && (
        <View style={styles.section}>
          <Pressable accessibilityRole="button" onPress={demo.onToggleGraveyard}>
            <Text style={styles.heading}>
              {demo.graveyardOpen ? 'GRAVEYARD ▲' : 'GRAVEYARD (older/internal screens) ▼'}
            </Text>
          </Pressable>
          {demo.graveyardOpen &&
            demo.graveyard.map((g) => (
              <View key={g.title} style={styles.section}>
                <Text style={styles.heading}>{g.title}</Text>
                {g.steps.map((st) => (
                  <Pressable
                    key={st.label}
                    accessibilityRole="button"
                    style={[styles.navButton, st.active && styles.navButtonActive]}
                    onPress={act(st.onClick)}
                  >
                    <Text style={[styles.navN, st.active && styles.activeText]}>{st.n}</Text>
                    <Text style={[styles.navLabel, st.active && styles.activeText]}>{st.label}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
        </View>
      )}

      {demo.trip && (
        <View style={styles.section}>
          <Text style={styles.heading}>CURRENT TRIP</Text>
          <Text style={styles.tripTitle}>{demo.trip.title}</Text>
          <View style={styles.rows}>
            {demo.trip.rows.map(([label, value]) => (
              <View key={label} style={styles.row}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text style={styles.rowValue}>{value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {demo.activity.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.heading}>RECENT ACTIVITY</Text>
          <View style={styles.activity}>
            {demo.activity.map((a) => (
              <Text key={a.id} style={styles.activityText}>
                <Text style={styles.activityTime}>{a.time} </Text>
                {a.text}
              </Text>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

// The number Leeway calls as "the clinic". The server checks it before any
// call: a valid US number, not an agency or premium line, approved (by the
// server's allowlist or its PIN), and not called too often.
function CallNumber({ calls }) {
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState({ busy: false, error: '' })

  async function submit() {
    if (!consent) return setState({ busy: false, error: 'Confirm you can answer this phone first.' })
    setState({ busy: true, error: '' })
    try {
      await calls.set(phone, pin)
      setPhone('')
      setPin('')
      setConsent(false)
      setState({ busy: false, error: '' })
    } catch (err) {
      setState({ busy: false, error: err.message })
    }
  }

  const disabled = state.busy || !phone.trim()
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>CALLS TO THE CLINIC</Text>
      {calls.phone ? (
        <Text style={styles.desc}>
          Leeway calls <Text style={styles.bold}>{calls.phone}</Text> as the clinic, for rides planned
          from now on.{' '}
          <Text accessibilityRole="button" style={styles.link} onPress={calls.clear}>
            Turn calls off
          </Text>
        </Text>
      ) : (
        <Text style={[styles.desc, styles.warn]}>
          Calls are off. Add a phone you can answer to hear the agent call.
        </Text>
      )}
      <TextInput
        style={styles.input}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        accessibilityLabel="Number to call"
        placeholder="(415) 555-0123"
        placeholderTextColor={colors.textSecondary}
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        style={styles.input}
        secureTextEntry
        keyboardType="number-pad"
        autoComplete="off"
        accessibilityLabel="Server PIN"
        placeholder="PIN (for a new number)"
        placeholderTextColor={colors.textSecondary}
        value={pin}
        onChangeText={setPin}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
        style={styles.check}
        onPress={() => setConsent((c) => !c)}
      >
        <View style={[styles.checkBox, consent && styles.checkBoxOn]}>
          {consent && <Text style={styles.checkMark}>{'✓'}</Text>}
        </View>
        <Text style={styles.checkLabel}>I can answer this phone, and agree to a call from an AI assistant.</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={[styles.simButton, disabled && styles.disabled]}
        disabled={disabled}
        onPress={submit}
      >
        <Text style={styles.simLabel}>
          {state.busy ? 'Checking…' : calls.phone ? 'Use this number instead' : 'Use this number'}
        </Text>
      </Pressable>
      {!!state.error && (
        <Text style={[styles.desc, styles.warn]} accessibilityRole="alert">
          {state.error}
        </Text>
      )}
    </View>
  )
}

const MUTED = '#5C6168'

const styles = StyleSheet.create({
  panel: { gap: 26 },
  intro: { gap: 6 },
  title: { fontFamily: fonts.medium, fontSize: 24, letterSpacing: -0.24, color: colors.ink },
  desc: { fontFamily: fonts.regular, fontSize: type.secondary, lineHeight: type.secondary * 1.45, color: MUTED },
  bold: { fontFamily: fonts.semiBold, color: colors.ink },
  warn: { color: colors.warningText },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  section: { gap: 8 },
  heading: {
    fontFamily: fonts.semiBold,
    fontSize: type.eyebrow,
    letterSpacing: type.eyebrow * 0.06,
    color: MUTED,
    paddingBottom: 4,
  },
  simButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D3D1CB',
    backgroundColor: '#F7F6F2',
    justifyContent: 'center',
  },
  simLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.ink },
  disabled: { opacity: 0.45 },
  demoButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.ink,
    justifyContent: 'center',
  },
  demoLabel: { fontFamily: fonts.medium, fontSize: type.body, color: colors.white, textAlign: 'center' },
  navButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navButtonActive: { backgroundColor: colors.ink },
  navN: { fontFamily: fonts.regular, fontSize: type.eyebrow, opacity: 0.6, width: 22, color: colors.ink },
  navLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.ink },
  activeText: { color: colors.white },
  tripTitle: { fontFamily: fonts.medium, fontSize: type.secondary, color: colors.ink },
  rows: { gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: MUTED },
  rowValue: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.ink, fontVariant: ['tabular-nums'] },
  activity: { gap: 8 },
  activityText: { fontFamily: fonts.regular, fontSize: type.secondary, lineHeight: type.secondary * 1.4, color: colors.ink },
  activityTime: { color: MUTED, fontVariant: ['tabular-nums'] },
  input: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D3D1CB',
    backgroundColor: colors.white,
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    color: colors.ink,
  },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  checkBox: {
    width: 20,
    height: 20,
    marginTop: 1,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: MUTED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  checkMark: { color: colors.white, fontSize: 12 },
  checkLabel: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: MUTED,
  },
})
