import { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { useTheme } from '../contexts/ThemeContext';

export function BiometricLockScreen() {
  const { isLocked, authenticate, isBiometricAvailable, biometricKind } = useBiometricLock();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const hasAutoAuthenticatedRef = useRef(false);

  useEffect(() => {
    if (!isLocked) {
      hasAutoAuthenticatedRef.current = false;
      return;
    }
    if (!isBiometricAvailable || hasAutoAuthenticatedRef.current) return;

    hasAutoAuthenticatedRef.current = true;
    void authenticate();
  }, [authenticate, isBiometricAvailable, isLocked]);

  const handleUnlock = useCallback(() => {
    void authenticate();
  }, [authenticate]);

  if (!isLocked) return null;

  return (
    <View style={[styles.overlay, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.surface }]}>
          <Ionicons name="lock-closed" size={48} color={colors.accent} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>GitNotēs is locked</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {isBiometricAvailable
            ? 'Authenticate to unlock'
            : 'Enter your passcode to unlock'}
        </Text>
        <Pressable
          testID="biometric-lock.button.authenticate"
          style={[styles.unlockButton, { backgroundColor: colors.accent }]}
          onPress={handleUnlock}
        >
          <Ionicons
            name={
              !isBiometricAvailable
                ? 'keypad-outline'
                : biometricKind === 'face'
                  ? 'scan-outline'
                  : 'finger-print-outline'
            }
            size={22}
            color="#fff"
          />
          <Text style={styles.unlockText}>Unlock</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  content: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
  },
  unlockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 16,
  },
  unlockText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
