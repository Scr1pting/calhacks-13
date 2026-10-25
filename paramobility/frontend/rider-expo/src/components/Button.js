import { Pressable, StyleSheet, Text } from 'react-native'
import { colors, fonts, hitMin, radii, type } from '../theme/tokens'
import { tap } from '../lib/haptics'

// One component covering every button variant in the design:
//   primary          – full-width, 56px, black (e.g. "Confirm")
//   secondary         – full-width, 52px, outlined (e.g. "Book a ride yourself")
//   compact-outline   – inline, 44px, outlined (e.g. "View calendar")
//   compact-solid     – inline, 44px, filled black (e.g. "Plan", chat actions)
// `background`/`color` let a screen override the fill for one specific
// state (e.g. the purple "Listening in" background) without a new variant.
export default function Button({
  variant = 'primary',
  onPress,
  disabled = false,
  icon,
  background,
  color,
  children,
}) {
  const v = VARIANTS[variant]
  // The filled buttons commit to something; they tap back.
  const solid = variant === 'primary' || variant === 'compact-solid'
  return (
    <Pressable
      onPress={(e) => {
        if (solid) tap()
        onPress?.(e)
      }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        v.container,
        background != null && { backgroundColor: background },
        disabled && variant === 'primary' && { backgroundColor: colors.buttonDisabled },
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon}
      <Text style={[styles.label, v.label, color != null && { color }]}>{children}</Text>
    </Pressable>
  )
}

const VARIANTS = {
  primary: {
    container: {
      width: '100%',
      minHeight: 56,
      borderRadius: radii.buttonLg,
      backgroundColor: colors.ink,
      paddingHorizontal: 16,
    },
    label: { fontSize: type.body, fontFamily: fonts.medium, color: colors.white },
  },
  secondary: {
    container: {
      width: '100%',
      minHeight: 52,
      borderRadius: radii.button,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
    },
    label: { fontSize: type.body, fontFamily: fonts.regular, color: colors.ink },
  },
  'compact-outline': {
    container: {
      minHeight: hitMin,
      paddingHorizontal: 16,
      borderRadius: radii.buttonSm,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
    },
    label: { fontSize: type.secondary, fontFamily: fonts.regular, color: colors.ink },
  },
  'compact-solid': {
    container: {
      minHeight: hitMin,
      paddingHorizontal: 18,
      borderRadius: radii.buttonSm,
      backgroundColor: colors.ink,
    },
    label: { fontSize: type.secondary, fontFamily: fonts.medium, color: colors.white },
  },
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pressed: {
    opacity: 0.8,
  },
  label: {},
})
