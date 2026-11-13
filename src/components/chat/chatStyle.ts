import { Platform, StyleSheet, type ViewStyle } from 'react-native';

export const CHAT_TYPE = {
  body: { fontSize: 16, lineHeight: 24 },
  status: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
} as const;

export const CARD_RADIUS = 14;

export const HAIRLINE = StyleSheet.hairlineWidth;

export const CONTINUOUS_CORNERS: ViewStyle = Platform.OS === 'ios' ? { borderCurve: 'continuous' } : {};

export const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined });
