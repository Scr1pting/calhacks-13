import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors, fonts, type } from '../theme/tokens'

// The review/jump menu from the design prototype's own side panel, adapted
// for mobile as a modal (there's no room for a side-by-side panel on a
// phone) — opened from the top bar's menu button. Development/review tool,
// not part of the rider-facing product.
export default function DemoMenu({ visible, onClose, stepGroups, simulate }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Denise's journey</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <Text style={styles.close}>{'✕'}</Text>
            </Pressable>
          </View>
          <Text style={styles.desc}>
            Jump to any step, or simulate an event. All times, percentages and
            availability are sample data.
          </Text>

          <View style={styles.section}>
            <Text style={styles.heading}>Simulate</Text>
            {simulate.map((sm) => (
              <Pressable
                key={sm.label}
                style={styles.simButton}
                onPress={() => {
                  sm.onClick()
                  onClose()
                }}
              >
                <Text style={styles.simLabel}>{sm.label}</Text>
              </Pressable>
            ))}
          </View>

          {stepGroups.map((group) => (
            <View key={group.title} style={styles.section}>
              <Text style={styles.heading}>{group.title}</Text>
              {group.steps.map((step) => (
                <Pressable
                  key={step.key}
                  style={[styles.stepButton, step.active && styles.stepButtonActive]}
                  onPress={() => {
                    step.onClick()
                    onClose()
                  }}
                >
                  <Text style={[styles.stepNum, step.active && { color: colors.white }]}>{step.num}</Text>
                  <Text style={[styles.stepLabel, step.active && { color: colors.white }]}>{step.label}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,22,24,0.4)',
  },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.screenBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    padding: 24,
    gap: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontFamily: fonts.medium,
    fontSize: 22,
    color: colors.ink,
  },
  close: {
    fontSize: 18,
    color: colors.textSecondary,
    padding: 8,
  },
  desc: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.textSecondary,
    marginTop: -12,
  },
  section: {
    gap: 8,
  },
  heading: {
    fontFamily: fonts.semiBold,
    fontSize: type.eyebrow,
    letterSpacing: type.eyebrow * 0.06,
    color: colors.textSecondary,
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
  simLabel: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    color: colors.ink,
  },
  stepButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepButtonActive: {
    backgroundColor: colors.ink,
  },
  stepNum: {
    fontFamily: fonts.regular,
    fontSize: type.eyebrow,
    opacity: 0.6,
    width: 22,
    color: colors.ink,
  },
  stepLabel: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    color: colors.ink,
  },
})
