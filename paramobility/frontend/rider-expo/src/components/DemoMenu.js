import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import DemoPanel from './DemoPanel'
import { colors } from '../theme/tokens'

// The demo panel as a bottom sheet, opened from the top bar's menu button —
// on a phone there's no room for it beside the app. Jumping to a screen or
// simulating an update closes it, so the result shows right away.
export default function DemoMenu({ visible, onClose, demo }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>{'✕'}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <DemoPanel demo={demo} onAction={onClose} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  header: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  close: {
    fontSize: 18,
    color: colors.textSecondary,
    padding: 4,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
})
