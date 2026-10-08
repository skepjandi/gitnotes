// NetInfo mock — CloneSyncService depends on it; default to online so
// tryPushNowImpl attempts push in tests rather than queueing.
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
    addEventListener: jest.fn(() => () => {}),
  },
}));

jest.mock('nativewind', () => ({
  cssInterop: () => {},
  rem: (v: number) => v,
  useColorScheme: () => ({ colorScheme: 'light', setColorScheme: jest.fn() }),
  NativeWindStyleSheet: { setDimensions: jest.fn(), setDirection: jest.fn(), setAppearance: jest.fn() },
}));

jest.mock('react-native-css', () => {
  const React = require('react');

  return {
    cssInterop: () => {},
    styled: <Component>(component: Component): Component => component,
    useCssElement: (
      Component: React.ElementType,
      props: Record<string, unknown>,
      mapping: Readonly<Record<string, unknown>>,
    ) => {
      void mapping;
      return React.createElement(Component, props);
    },
    useUnstableNativeVariable: (name: string) => undefined,
  };
});

jest.mock('@rn-primitives/slot', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Slot = React.forwardRef(({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) =>
    React.createElement(View, { ...props, ref }, children)
  );
  Slot.displayName = 'Slot';
  return { __esModule: true, Slot };
});

jest.mock('@rn-primitives/portal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    PortalHost: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children),
    Portal: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children),
  };
});

// Mocks for the @testing-library/react-native render path.

// expo-crypto ships ESM; the jest transform pipeline can't load it. The
// real surface area we depend on is `randomUUID` (consumed by
// `src/utils/ids.ts`). Tests that need to control its behaviour can still
// override this with a per-file `jest.mock('expo-crypto', ...)`.
jest.mock('react-i18next', () => {
  const en = require('./src/i18n/en.json');

  function resolve(obj: Record<string, unknown>, path: string): string {
    const keys = path.split('.');
    let current: unknown = obj;
    for (const k of keys) {
      if (current && typeof current === 'object' && k in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[k];
      } else {
        return path;
      }
    }
    return typeof current === 'string' ? current : path;
  }

  return {
    useTranslation: () => ({
      t: (key: string, params?: Record<string, string>) => {
        const value = resolve(en, key);
        if (!params) return value;
        return Object.entries(params).reduce(
          (str, [k, v]) => str.replace(`{{${k}}}`, v),
          value,
        );
      },
      i18n: { changeLanguage: jest.fn() },
    }),
    initReactI18next: { type: '3rdParty', init: jest.fn() },
  };
});

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () =>
    `test-${Math.random().toString(36).slice(2, 11)}-${Math.random().toString(36).slice(2, 11)}`,
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('expo-blur', () => {
  const { View } = jest.requireActual('react-native');
  return {
    BlurView: View
  };
});

// Provide a minimal react-native stub that satisfies the export surface needed by
// the component, @testing-library/react-native, and every library in the Jest chain.
// AccessibilityInfo.isReduceMotionEnabled returns a resolved Promise so
// reduceMotionResolved becomes true during the first render and the useEffect hook
// (which guards the hold-animation start) runs without returning early.
jest.mock('react-native', () => {
  const React = require('react');

  // Text must be a proper native text element so @testing-library/react-native's
  // getByText can locate it. Using a string type ('Text') allows the testing
  // library to find text content rendered by <Text>children</Text>.
  const Text = ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('Text', props, children);
  Text.displayName = 'Text';

  const TextInput = ({
    children,
    placeholder,
    value,
    ...props
  }: {
    children?: React.ReactNode;
    placeholder?: string;
    value?: string;
  } & Record<string, unknown>) =>
    React.createElement('TextInput', { ...props, placeholder, value }, children);
  TextInput.displayName = 'TextInput';

  const View = (props: object & { children?: React.ReactNode }) =>
    React.createElement('View', props, props?.children);
  View.displayName = 'View';

  return {
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: jest.fn() }),
    },
    StyleSheet: {
      create: (styles: object) => styles,
      flatten: (style: object) => style,
    },
    Platform: { OS: 'ios', select: (opts: object) => opts },
    PixelRatio: { get: () => 2 },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    Image: View,
    Text,
    TouchableOpacity: View,
    Pressable: View,
    ScrollView: View,
    FlatList: View,
    SectionList: View,
    TextInput,
    useColorScheme: () => 'light',
    Switch: View,
    ActivityIndicator: View,
    RefreshControl: View,
    Modal: View,
    KeyboardAvoidingView: View,
    View,
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
    Alert: {
      alert: jest.fn((_title?: string, _message?: string, _buttons?: unknown[]) => {}),
    },
  };
});

// Shared animation state — module-level so the factory closure AND
// global.MockReanimated both reference the same objects.
type MockSV = Record<string, unknown>;
const mockAnimState: {
  pending: Map<MockSV, { startTime: number; from: number; to: number; duration: number; easing: (t: number) => number }>;
  all: Set<MockSV>;
  now: number;
  EPS: number;
  linearEase: (t: number) => number;
  tick: (deltaMs: number) => void;
} = {
  pending: new Map(),
  all: new Set(),
  now: 0,
  EPS: 1e-6,
  linearEase(t: number): number { return t; },
  tick(deltaMs: number): void {
    this.now += deltaMs;
    for (const sv of this.all) {
      const p = this.pending.get(sv);
      if (!p) continue;
      const elapsed = this.now - p.startTime;
      const t = Math.min(elapsed / p.duration, 1);
      const eased = p.easing(t);
      sv.value = p.from + (p.to - p.from) * eased;
      if (t >= 1 - this.EPS) { sv.value = p.to; this.pending.delete(sv); }
    }
  },
};

jest.mock('react-native-reanimated', () => {
  const RealView = require('react-native').View;
  const S = mockAnimState;

  function useSharedValue(initial: number) {
    let _v = initial;
    const sv: Record<string, unknown> = {};
    Object.defineProperty(sv, 'value', {
      get() { return _v; },
      set(newVal) {
        if (newVal != null && typeof newVal === 'object' && '__anim' in newVal) {
          const anim = (newVal as { __anim: { startTime: number; from: number; to: number; duration: number; easing: (t: number) => number } }).__anim;
          S.pending.set(sv, anim);
          _v = anim.from;
        } else {
          _v = newVal as number;
        }
      },
      enumerable: true,
      configurable: true,
    });
    sv.value = initial;
    S.all.add(sv);
    return sv as unknown as { value: number };
  }

  function withSpring(v: number): number { return v; }

  function withTiming(to: number, opts?: { duration?: number; easing?: (t: number) => number } | number) {
    const options = opts ?? {};
    const duration = typeof options === 'number' ? options : (options.duration ?? 0);
    const easing = typeof options === 'number' ? S.linearEase : (options.easing ?? S.linearEase);
    const anim = { __anim: { startTime: S.now, from: 0, to, duration, easing } };
    return anim;
  }

  function withDelay(_d: unknown, anim: unknown): unknown { return anim; }
  function withSequence(...anims: unknown[]): unknown { return anims[anims.length - 1] ?? anims[0]; }
  function withRepeat(anim: unknown): unknown { return anim; }
  function cancelAnimation(sv: Record<string, unknown>): void { S.pending.delete(sv); }
  function runOnJS(fn: unknown): unknown { return fn; }
  function interpolate(value: number, inputRange: number[], outputRange: number[], extrapolate: string = 'extend'): number {
    const clamped = Math.max(inputRange[0], Math.min(inputRange[inputRange.length - 1], value));
    let idx = 0;
    for (let i = 0; i < inputRange.length - 1; i++) {
      if (clamped >= inputRange[i] && clamped <= inputRange[i + 1]) { idx = i; break; }
    }
    const ratio = (inputRange[idx + 1] !== inputRange[idx])
      ? (clamped - inputRange[idx]) / (inputRange[idx + 1] - inputRange[idx])
      : 0;
    let result = outputRange[idx] + ratio * (outputRange[idx + 1] - outputRange[idx]);
    if (extrapolate === 'clamp') {
      result = Math.max(outputRange[0], Math.min(outputRange[outputRange.length - 1], result));
    }
    return result;
  }

  return {
    __esModule: true,
    default: { View: RealView, createAnimatedComponent: (c: unknown) => c },
    View: RealView,
    useSharedValue,
    useAnimatedStyle: (cb: () => Record<string, unknown>) => cb(),
    useDerivedValue: (cb: () => number) => ({ value: cb() }),
    withSpring,
    withTiming,
    withDelay,
    withSequence,
    withRepeat,
    cancelAnimation,
    runOnJS,
    interpolate,
    Easing: { linear: S.linearEase, in: (v: number) => v, out: (v: number) => v, inOut: (v: number) => v },
    _mockAnimState: S,
  };
});

(global as unknown as { MockReanimated: {
  __advanceBy: (ms: number) => void;
  __completeAll: () => void;
  __cancelAll: () => void;
  __resetTime: () => void;
  __now: () => number;
}}).MockReanimated = {
  __advanceBy: (ms) => mockAnimState.tick(ms),
  __completeAll: () => mockAnimState.tick(1e12),
  __cancelAll: () => {
    for (const sv of mockAnimState.all as Iterable<Record<string, unknown>>) {
      if (typeof sv.value === 'number') sv.value = 0;
      (mockAnimState.pending as Map<Record<string, unknown>, unknown>).delete(sv);
    }
    mockAnimState.now = 0;
  },
  __resetTime: () => {
    for (const sv of mockAnimState.all as Iterable<Record<string, unknown>>) {
      if (typeof sv.value === 'number') sv.value = 0;
      (mockAnimState.pending as Map<Record<string, unknown>, unknown>).delete(sv);
    }
    mockAnimState.all.clear();
    mockAnimState.now = 0;
  },
  __now: () => mockAnimState.now,
};

// expo-haptics: noop the native calls.
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// AsyncStorage in-memory mock so providers using it for hydration don't crash.
jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      removeItem: jest.fn(async (k: string) => { delete store[k]; }),
      clear: jest.fn(async () => { store = {}; }),
      getAllKeys: jest.fn(async () => Object.keys(store)),
      multiGet: jest.fn(async (keys: string[]) =>
        keys.map((k) => [k, k in store ? store[k] : null] as [string, string | null]),
      ),
      multiSet: jest.fn(async (pairs: ReadonlyArray<readonly [string, string]>) => {
        for (const [k, v] of pairs) store[k] = v;
      }),
      multiRemove: jest.fn(async (keys: readonly string[]) => {
        for (const k of keys) delete store[k];
      }),
    },
  };
});

// reanimated-color-picker pulls in react-native-gesture-handler, which
// depends on a TurboModule that isn't registered in the jest runtime.
// Stub the picker with a passthrough View — its drag interactions can't
// be unit-tested anyway; runtime verification happens on a sim.
jest.mock('reanimated-color-picker', () => {
  const { View } = require('react-native');
  const Stub = ({ children }: { children?: React.ReactNode }) =>
    require('react').createElement(View, null, children);
  return {
    __esModule: true,
    default: Stub,
    Panel1: Stub,
    Panel2: Stub,
    Panel3: Stub,
    Panel4: Stub,
    Panel5: Stub,
    HueSlider: Stub,
    HueCircular: Stub,
    SaturationSlider: Stub,
    BrightnessSlider: Stub,
    LuminanceSlider: Stub,
    LuminanceCircular: Stub,
    HSLSaturationSlider: Stub,
    OpacitySlider: Stub,
    RedSlider: Stub,
    GreenSlider: Stub,
    BlueSlider: Stub,
    Preview: Stub,
    PreviewText: Stub,
    InputWidget: Stub,
    Swatches: Stub,
    ExtraThumb: Stub,
    colorKit: {},
    useColorPickerContext: () => ({}),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 0, height: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaConsumer: ({ children }: { children: (i: typeof insets) => React.ReactNode }) => children(insets),
    SafeAreaView: View,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  supportedAuthenticationTypesAsync: jest.fn(async () => []),
  getEnrolledLevelAsync: jest.fn(async () => 0),
}));

jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
  BackgroundTaskResult: {
    Success: 'Success',
    Failed: 'Failed',
  },
  BackgroundTaskStatus: {
    Available: 'Available',
    Denied: 'Denied',
    Restricted: 'Restricted',
  },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => true),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(async () => ''),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

jest.mock('expo-file-system', () => {
  const noop = () => {};
  const mockDir = { uri: '', path: '', deleteAsync: jest.fn(), exists: jest.fn(() => false) };
  const MockDirectory = jest.fn(() => mockDir);
  const mockFile = { uri: '', path: '', deleteAsync: jest.fn(), exists: jest.fn(() => false), create: jest.fn() };
  const MockFile = jest.fn(() => mockFile);
  const MockPaths = jest.fn();
  Object.defineProperties(MockPaths, {
    cache: { get: jest.fn(() => mockDir) },
    document: { get: jest.fn(() => mockDir) },
    bundle: { get: jest.fn(() => mockDir) },
    appleSharedContainers: { get: jest.fn(() => ({})) },
  });
  return {
    __esModule: true,
    File: MockFile,
    Directory: MockDirectory,
    Paths: MockPaths,
    DownloadTask: jest.fn(),
    UploadTask: jest.fn(),
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },
    UploadType: {},
    FileMode: {},
    default: { File: MockFile, Directory: MockDirectory, Paths: MockPaths },
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockIcon = (props: { name?: string }) =>
    React.createElement(View, { testID: 'icon-' + (props.name || '') });
  return {
    Ionicons: Object.assign(MockIcon, {
      glyphMap: { 'logo-github': 0, 'heart': 1, 'book': 2, 'create': 3, 'trash': 4, 'settings': 5 },
    }),
  };
});

jest.mock('./src/components/ui/EmptyState', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    EmptyState: function MockEmptyState({ title, subtitle, testID }: { title: string; subtitle?: string; icon?: string; testID?: string }) {
      return React.createElement(View, { testID: testID || 'empty-state' },
        React.createElement(Text, null, title),
        subtitle && React.createElement(Text, null, subtitle)
      );
    },
  };
});

jest.mock('./src/components/notes/NotesEmptyState', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    NotesEmptyState: function MockNotesEmptyState({ isFiltered }: { isFiltered: boolean }) {
      return React.createElement(View, { testID: 'notes-empty-state' },
        React.createElement(Text, null, isFiltered ? 'No matching notes' : 'No notes yet'),
        React.createElement(Text, null, isFiltered ? 'Try adjusting your search or filters' : 'Create your first note to get started')
      );
    },
  };
});

jest.mock('./src/components/todos/TodosEmptyState', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    TodosEmptyState: function MockTodosEmptyState({ isFiltered }: { isFiltered: boolean }) {
      return React.createElement(View, { testID: 'todos-empty-state' },
        React.createElement(Text, null, isFiltered ? 'No matching todos' : 'No todos yet'),
        React.createElement(Text, null, isFiltered ? 'Try adjusting your filters' : 'Create your first todo to get started')
      );
    },
  };
});

jest.mock('expo-clipboard', () => ({
  getClipboardAsync: jest.fn(async () => ''),
  setClipboardAsync: jest.fn(async () => undefined),
  hasClipboardAsync: jest.fn(async () => false),
}));

jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: View };
});

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  const mockGesture = () => ({
    activeOffsetX: () => mockGesture(),
    activeOffsetY: () => mockGesture(),
    failOffsetY: () => mockGesture(),
    onBegin: () => mockGesture(),
    onStart: () => mockGesture(),
    onUpdate: () => mockGesture(),
    onEnd: () => mockGesture(),
    onFinalize: () => mockGesture(),
    runOnJS: () => mockGesture(),
  });
  return {
    Gesture: {
      Pan: mockGesture,
      Tap: mockGesture,
      Fling: mockGesture,
      LongPress: mockGesture,
      Native: mockGesture,
      native: mockGesture,
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: View,
    Swipeable: View,
    DrawerLayout: View,
    State: {},
    PanGestureHandler: View,
    TapGestureHandler: View,
    FlingGestureHandler: View,
    LongPressGestureHandler: View,
    NativeViewGestureHandler: View,
    ScrollView: View,
    FlatList: View,
  };
});

jest.mock('expo-modules-core', () => ({
  EventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  })),
  NativeModulesProxy: {},
  requireNativeModule: jest.fn(),
  requireOptionalNativeModule: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'cancel' })),
}));

// expo-sqlite ships a native module that crashes in Jest because
// requireNativeModule is a jest.fn() stub rather than a real native getter.
// Mock the async DB API surface that DocumentIndex (and consumers like
// GitBranchCoordinator via DocumentIndex imports) actually call.
jest.mock('expo-sqlite', () => {
  const mockDb = {
    execAsync: jest.fn(async () => { /* noop */ }),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 0 })),
    getFirstAsync: jest.fn(async () => null),
    getAllAsync: jest.fn(async () => []),
    withExclusiveTransactionAsync: jest.fn(async (fn: (txn: {
      runAsync: jest.Mock<Promise<{ lastInsertRowId: number }>, []>;
    }) => Promise<void>) => {
      await fn({ runAsync: jest.fn(async () => ({ lastInsertRowId: 0 })) });
    }),
  };
  return {
    __esModule: true,
    openDatabaseAsync: jest.fn(async () => mockDb),
  };
});

jest.mock('expo', () => ({
  fetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
  FileSystem: { readAsStringAsync: jest.fn(async () => '') },
  Crypto: { randomUUID: () => 'test-uuid' },
  requireNativeModule: jest.fn(() => ({})),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'test-push-token' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'test-device-token' })),
  getRegistrationForRemoteNotificationsAsync: jest.fn(async () => null),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  addNotificationReceivedListener: jest.fn(),
  addNotificationsReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  removeNotificationSubscription: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  dismissAllNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'notification-id'),
  cancelScheduledNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
  getPresentedNotificationsAsync: jest.fn(async () => []),
}));

// ---- Paywall mocks (RevenueCat + ProStore) ----
// react-native-purchases is a native module; the global mock keeps every test
// file loadable in jest. Tests that need per-test control re-mock the module
// (standard pattern, same as the AsyncStorage mock above).
jest.mock('react-native-purchases', () => {
  const Purchases = {
    setLogLevel: jest.fn(),
    configure: jest.fn(async () => undefined),
    getOfferings: jest.fn(async () => ({ current: null })),
    purchasePackage: jest.fn(async () => ({
      customerInfo: { entitlements: { active: { 'GitNotēs Pro': { isActive: true, periodType: 'NORMAL' } } } },
    })),
    restorePurchases: jest.fn(async () => ({ entitlements: { active: {} } })),
    getCustomerInfo: jest.fn(async () => ({
      entitlements: { active: {} },
      originalApplicationVersion: null,
      originalPurchaseDate: null,
    })),
    addCustomerInfoUpdateListener: jest.fn(() => () => {}),
    removeCustomerInfoUpdateListener: jest.fn(),
    checkTrialOrIntroductoryPriceEligibility: jest.fn(async () => ({})),
    trackCustomPaywallImpression: jest.fn(async () => undefined),
    LOG_LEVEL: { WARN: 'WARN', DEBUG: 'DEBUG', VERBOSE: 'VERBOSE' },
    INTRO_ELIGIBILITY_STATUS: {
      INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0,
      INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1,
      INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2,
      INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3,
    },
    PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' },
  };
  return {
    __esModule: true,
    default: Purchases,
    STOREKIT_VERSION: { STOREKIT_1: 'STOREKIT_1', STOREKIT_2: 'STOREKIT_2' },
    __resetPurchasesMocks: () => {
      for (const fn of Object.values(Purchases)) {
        if (typeof fn === 'function' && 'mockClear' in fn) (fn as jest.Mock).mockClear();
      }
    },
  };
});

// ProStore defaults to PRO in jest so the ~160 pre-existing test files keep
// passing once gating reads useProStore. Gating tests flip state via
// __setProState. proStore.test.ts uses jest.requireActual to test the real store.
const mockProStoreState: Record<string, unknown> = {
  status: 'pro',
  entitlementActive: true,
  trialActive: false,
  trialEndsAt: null,
  isPurchasing: false,
  isRestoring: false,
  error: null,
  interstitialEligible: false,
  monthlyPackage: null,
  yearlyPackage: null,
  lifetimePackage: null,
  offeringsReady: true,
  currentOffering: null,
  configured: true,
  initialize: jest.fn(async () => undefined),
  refresh: jest.fn(async () => undefined),
  purchaseMonthly: jest.fn(async () => undefined),
  purchaseYearly: jest.fn(async () => undefined),
  purchaseLifetime: jest.fn(async () => undefined),
  restore: jest.fn(async () => undefined),
  loadOfferingsIfNeeded: jest.fn(async () => undefined),
  markInterstitialShown: jest.fn(async () => undefined),
  bindAccount: jest.fn(async () => undefined),
  unbindAccount: jest.fn(async () => undefined),
};
jest.mock('./src/stores/proStore', () => {
  const useProStore = (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mockProStoreState);
  Object.assign(useProStore, {
    getState: () => mockProStoreState,
    setState: (partial: Record<string, unknown>) => Object.assign(mockProStoreState, partial),
    subscribe: () => () => {},
    getInitialState: () => mockProStoreState,
  });
  return {
    useProStore,
    selectIsPro: (state: { entitlementActive?: boolean }) =>
      Boolean(state?.entitlementActive),
    __setProState: (partial: Record<string, unknown>) => Object.assign(mockProStoreState, partial),
  };
});

// Global mock for the new multi-provider host hooks — existing tests render
// ExploreScreen without wrapping in a QueryClientProvider, and these hooks
// use @tanstack/react-query internally. Returning a synthetic "success" state
// with empty data keeps the hub views out of the render path for tests that
// don't explicitly exercise PR/issue views. The hook's OWN tests opt out
// of this mock via jest.unmock at the top of the file.
jest.mock('./src/hooks/useGitHostQueries', () => ({
  useGitHostPullRequests: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, refetch: jest.fn() }),
  useGitHostIssues: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, refetch: jest.fn() }),
}));
