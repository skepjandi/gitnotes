jest.mock('react-native', () => {
  const React = require('react');
  return {
    StyleSheet: { create: (s: object) => s, flatten: (s: object) => s },
    Platform: { OS: 'ios', select: (o: object) => o },
    PixelRatio: { get: () => 2 },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    useColorScheme: () => ({ colorScheme: 'light' }),
    Pressable: ({ children, testID, onPress, style }) =>
      React.createElement('Pressable', { testID, onPress, style }, children),
    View: ({ children, style }) =>
      React.createElement('View', { style }, children),
    Text: ({ children, style }) =>
      React.createElement('Text', { style }, children),
  };
});

jest.mock('react-native-safe-area-context', () => {
  return {
    useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }) => children,
  };
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

import React, { type ReactNode } from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { BiometricLockScreen } from '../../src/components/BiometricLockScreen';

// ---------------------------------------------------------------------------
// Mock BiometricLockContext — controllable per-test via internal ref
// ---------------------------------------------------------------------------
const mockAuthenticate = jest.fn<() => Promise<boolean>>();
const mockContextValue = {
  isLocked: true,
  isBiometricAvailable: true,
  biometricKind: 'face' as const,
  biometricLabel: 'Face ID',
  authenticate: mockAuthenticate,
};

jest.mock('../../src/contexts/BiometricLockContext', () => {
  return {
    useBiometricLock: () => mockContextValue,
    BiometricLockProvider: ({ children }: { children: ReactNode }) => children,
  };
});

// ---------------------------------------------------------------------------
// Mock ThemeContext — flat-light palette
// ---------------------------------------------------------------------------
const flatLightColors = {
  bg: '#f2f2f7',
  surface: '#ffffff',
  highlight: '#ffffff',
  shadow: '#000000',
  text: '#1c1c1e',
  textSecondary: '#6e6e73',
  accent: '#007AFF',
  accentMuted: '#5AC8FA',
  error: '#ff3b30',
  success: '#34C759',
  warning: '#FF9500',
  background: '#f2f2f7',
  surfaceSecondary: '#f2f2f7',
  primary: '#007AFF',
  border: '#c6c6c8',
  card: '#ffffff',
  elevated: '#ffffff',
};

jest.mock('../../src/contexts/ThemeContext', () => {
  const React = require('react');
  const { createContext, useContext } = React;

  const DefaultThemeContext = createContext<{ colors: object }>({ colors: {} } as { colors: object });

  return {
    useTheme: () => {
      const ctx = useContext(DefaultThemeContext);
      return ctx ?? { colors: flatLightColors };
    },
    ThemeProvider: ({ children, themeColors }) =>
      React.createElement(
        DefaultThemeContext.Provider,
        { value: { colors: themeColors ?? flatLightColors } },
        children,
      ),
  };
});

// ---------------------------------------------------------------------------
// Helper: render with overrides
// ---------------------------------------------------------------------------
const { BiometricLockProvider } = require('../../src/contexts/BiometricLockContext');

function renderScreen(contextOverride: Partial<typeof mockContextValue> = {}) {
  Object.assign(mockContextValue, contextOverride);
  return render(<BiometricLockScreen />, {
    wrapper: BiometricLockProvider,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BiometricLockScreen auto-authentication', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockAuthenticate.mockResolvedValue(false);
    mockContextValue.isLocked = true;
    mockContextValue.isBiometricAvailable = true;
  });

  it('calls authenticate automatically once when locked with biometrics available', () => {
    renderScreen({ isLocked: true, isBiometricAvailable: true });

    // Auto-authenticate must be called exactly once on mount
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  });

  it('does NOT call authenticate when locked but biometrics are unavailable', () => {
    renderScreen({ isLocked: true, isBiometricAvailable: false });

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('does NOT call authenticate when biometrics available but not locked', () => {
    renderScreen({ isLocked: false, isBiometricAvailable: true });

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('button still retries authenticate after automatic failure', async () => {
    mockAuthenticate
      .mockResolvedValueOnce(false) // auto-auth fails
      .mockResolvedValueOnce(true);  // button retry succeeds

    const { getByTestId } = renderScreen({
      isLocked: true,
      isBiometricAvailable: true,
    });

    // Auto-auth was already called
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);

    // Press the Unlock button (retry)
    await act(async () => {
      fireEvent.press(getByTestId('biometric-lock.button.authenticate'));
    });

    // authenticate called again via button
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  it('no duplicate auto-authenticate calls on repeated renders', () => {
    const { rerender } = renderScreen({
      isLocked: true,
      isBiometricAvailable: true,
    });

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);

    // Re-render with same props — no new call
    rerender(<BiometricLockScreen />);

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  });

  it('resets guard and auto-prompts again on a new lock session', () => {
    // First lock session
    const { rerender } = renderScreen({
      isLocked: true,
      isBiometricAvailable: true,
    });
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);

    // Simulate unlock — re-render unlocked
    mockContextValue.isLocked = false;
    rerender(<BiometricLockScreen />);

    // Simulate relock — new session
    mockContextValue.isLocked = true;
    rerender(<BiometricLockScreen />);

    // Must auto-authenticate again for the new session
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  it('starts authentication when biometrics become available while already locked', () => {
    const { rerender } = renderScreen({
      isLocked: true,
      isBiometricAvailable: false,
    });

    expect(mockAuthenticate).not.toHaveBeenCalled();

    mockContextValue.isBiometricAvailable = true;
    rerender(<BiometricLockScreen />);

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  });
});
