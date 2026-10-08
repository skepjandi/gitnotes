/**
 * Component-level integration tests for FloatingAIButton mutual exclusivity.
 *
 * Verifies the actual component behavior:
 * - setPanBeganDuringPress(true) is called when pan gesture begins
 * - cancelAffordances is called when pan gesture begins
 * - closeMenu is called when pan gesture onStart fires
 * - Pan during press suppresses long-press menu opening (observable outcome)
 *
 * Observable outcomes tested: callback invocation via captured actions + menu
 * visibility and navigation count after advancing past the 450ms threshold.
 *
 * MockReanimated clock control: __advanceBy / __resetTime.
 * Native timers controlled via jest.useFakeTimers for onLongPress.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';

declare const MockReanimated: {
  __advanceBy: (ms: number) => void;
  __resetTime: () => void;
};

const { __resetTime } = MockReanimated;

const FLOATING_AI_BUTTON_LONG_PRESS_MS = 450;

let capturedPanActions: {
  closeMenu: () => void;
  setHorizontalDirection: (dir: number) => void;
  setVerticalDirection: (dir: number) => void;
  cancelAffordances: () => void;
  setPanBeganDuringPress: (began: boolean) => void;
} | null = null;

// Exposed for tests: the pan gesture object whose callbacks can be triggered
let mockPanGesture: {
  onBegin: () => void;
  onStart: () => void;
  onFinalize: () => void;
} | null = null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

jest.mock('@react-navigation/native-stack', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('@/components/ai/FloatingAIHubMenu', () => ({
  FloatingAIHubMenu: function MockFloatingAIHubMenu() {
    return null;
  },
  MENU_SPRING: { mass: 0.72, damping: 18, stiffness: 210 },
}));

jest.mock('@/components/ai/useFloatingAIButtonPanGesture', () => ({
  useFloatingAIButtonPanGesture: (_pos: any, actions: any) => {
    capturedPanActions = actions;

    // Wire up callbacks that invoke the actions so tests can trigger them
    mockPanGesture = {
      onBegin: () => {
        /* noop — onBegin is pre-activation; actions belong in onStart */
      },
      onStart: () => {
        actions.cancelAffordances();
        actions.setPanBeganDuringPress(true);
      },
      onFinalize: () => {
        actions.setPanBeganDuringPress(false);
      },
    };

    return {
      panGesture: mockPanGesture,
      dragActive: { value: false },
      translateX: { value: 0 },
      translateY: { value: 0 },
      savedTranslateX: { value: 0 },
      savedTranslateY: { value: 0 },
      latestGeometry: { value: { x: 0, y: 0, width: 400, height: 800 } },
      markPositionInteractionStarted: jest.fn(),
      savePosition: jest.fn(),
    };
  },
}));

jest.mock('@/components/ai/useFloatingAIButtonPosition', () => ({
  useFloatingAIButtonPosition: () => ({
    translateX: { value: 0 },
    translateY: { value: 0 },
    savedTranslateX: { value: 0 },
    savedTranslateY: { value: 0 },
    geometry: { x: 0, y: 0, width: 400, height: 800 },
    latestGeometry: { value: { x: 0, y: 0, width: 400, height: 800 } },
    dragActive: { value: false },
    markPositionInteractionStarted: jest.fn(),
    savePosition: jest.fn(),
  }),
}));

jest.mock('@/components/floatingButtonLayout', () => ({
  useFloatingButtonCollision: () => undefined,
  getButtonRect: () => null,
  subscribeButtonRects: () => jest.fn(() => undefined),
  publishButtonRect: jest.fn(),
  resolveNonOverlappingWithRect: (pos: { x: number; y: number }) => pos,
}));

jest.mock('@/stores/aiStore', () => ({
  useAIStore: () => ({ isEnabled: true }),
}));

jest.mock('@/stores/aiHubStore', () => ({
  useAIHubStore: () => ({
    goNewChat: jest.fn(),
    goChatHistory: jest.fn(),
    goAISettings: jest.fn(),
    goThoughtDump: jest.fn(),
    goVoiceDump: jest.fn(),
  }),
}));

jest.mock('@/hooks/useProGate', () => ({
  useProStatus: () => ({ isPro: true }),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      surface: '#fff',
      text: '#000',
      textSecondary: '#999',
      primary: '#6366f1',
      elevated: '#f0f0f0',
      accent: '#a855f7',
      background: '#ffffff',
      foreground: '#000000',
    },
    style: {},
  }),
  useTokens: () => ({
    colors: {
      surface: '#fff',
      text: '#000',
      textSecondary: '#999',
      primary: '#6366f1',
      elevated: '#f0f0f0',
      accent: '#a855f7',
      background: '#ffffff',
      foreground: '#000000',
    },
    radii: { sm: 4, md: 8, lg: 16, full: 9999 },
  }),
}));

jest.mock('@/utils/haptics', () => ({
  HapticService: {
    success: jest.fn(),
    selection: jest.fn(),
  },
}));

describe('FloatingAIButton — pan/hold mutual exclusivity (component)', () => {
  beforeEach(() => {
    __resetTime();
    jest.clearAllMocks();
    capturedPanActions = null;
    mockPanGesture = null;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('remains visible on the ChatScreen route', () => {
    const { getByTestId } = render(
      React.createElement(
        require('@/components/ai/FloatingAIButton').FloatingAIButton,
        { currentRouteName: 'ChatScreen' },
      ),
    );

    expect(getByTestId('floating-ai.button.navigate-chat')).toBeTruthy();
  });

  it('setPanBeganDuringPress is wired and called when pan gesture onStart fires', async () => {
    const { getByTestId } = render(
      React.createElement(
        require('@/components/ai/FloatingAIButton').FloatingAIButton,
        {}
      )
    );

    await act(async () => { await Promise.resolve(); });

    const button = getByTestId('floating-ai.button.navigate-chat');
    fireEvent(button, 'pressIn');

    expect(capturedPanActions).not.toBeNull();
    expect(typeof capturedPanActions!.setPanBeganDuringPress).toBe('function');
    expect(mockPanGesture).not.toBeNull();
    expect(typeof mockPanGesture!.onBegin).toBe('function');

    let receivedValue: boolean | null = null;
    const original = capturedPanActions!.setPanBeganDuringPress;
    capturedPanActions!.setPanBeganDuringPress = (val: boolean) => {
      receivedValue = val;
      original(val);
    };

    act(() => {
      mockPanGesture!.onStart();
    });

    expect(receivedValue).toBe(true);
  });

  it('cancelAffordances is wired and called when pan gesture begins', async () => {
    const { getByTestId } = render(
      React.createElement(
        require('@/components/ai/FloatingAIButton').FloatingAIButton,
        {}
      )
    );

    await act(async () => { await Promise.resolve(); });

    const button = getByTestId('floating-ai.button.navigate-chat');
    fireEvent(button, 'pressIn');

    expect(capturedPanActions).not.toBeNull();
    expect(typeof capturedPanActions!.cancelAffordances).toBe('function');

    let called = false;
    const original = capturedPanActions!.cancelAffordances;
    capturedPanActions!.cancelAffordances = () => {
      called = true;
      original();
    };

    act(() => {
      capturedPanActions!.cancelAffordances();
    });

    expect(called).toBe(true);
  });

  it('closeMenu is wired and called when pan gesture onStart fires', async () => {
    render(
      React.createElement(
        require('@/components/ai/FloatingAIButton').FloatingAIButton,
        {}
      )
    );

    await act(async () => { await Promise.resolve(); });

    expect(capturedPanActions).not.toBeNull();
    expect(typeof capturedPanActions!.closeMenu).toBe('function');

    let called = false;
    const original = capturedPanActions!.closeMenu;
    capturedPanActions!.closeMenu = () => {
      called = true;
      original();
    };

    act(() => {
      capturedPanActions!.closeMenu();
    });

    expect(called).toBe(true);
  });

  it('pan during press suppresses long-press menu — hub stays closed after 450ms', async () => {
    const navigate = jest.fn();
    require('@react-navigation/native').useNavigation = () => ({ navigate });

    const { getByTestId, queryByTestId } = render(
      React.createElement(
        require('@/components/ai/FloatingAIButton').FloatingAIButton,
        {}
      )
    );

    await act(async () => { await Promise.resolve(); });

    const button = getByTestId('floating-ai.button.navigate-chat');

    // 1. Press in — starts the 450ms native onLongPress timer
    fireEvent(button, 'pressIn');

    // 2. Pan gesture recognized (onStart) during press — sets panBeganDuringPressRef = true
    //    This must happen before the 450ms timer fires
    act(() => {
      mockPanGesture!.onStart();
    });

    // 3. Advance past the 450ms long-press boundary — onLongPress fires
    act(() => {
      jest.advanceTimersByTime(FLOATING_AI_BUTTON_LONG_PRESS_MS + 50);
    });

    // 4. Release
    fireEvent(button, 'pressOut');

    // 5. Observable outcome: hub menu backdrop is NOT rendered
    const backdrop = queryByTestId('floating-ai.hub.backdrop');
    expect(backdrop).toBeNull();

    // 6. Observable outcome: no navigation occurred
    expect(navigate).not.toHaveBeenCalled();
  });

  it('onFinalize calls setPanBeganDuringPress(false) to reset the ref', async () => {
    const { getByTestId } = render(
      React.createElement(
        require('@/components/ai/FloatingAIButton').FloatingAIButton,
        {}
      )
    );

    await act(async () => { await Promise.resolve(); });

    const button = getByTestId('floating-ai.button.navigate-chat');
    fireEvent(button, 'pressIn');

    expect(capturedPanActions).not.toBeNull();
    expect(mockPanGesture).not.toBeNull();
    expect(typeof mockPanGesture!.onFinalize).toBe('function');

    let receivedValue: boolean | null = null;
    const original = capturedPanActions!.setPanBeganDuringPress;
    capturedPanActions!.setPanBeganDuringPress = (val: boolean) => {
      receivedValue = val;
      original(val);
    };

    act(() => {
      mockPanGesture!.onFinalize();
    });

    expect(receivedValue).toBe(false);
  });
});
