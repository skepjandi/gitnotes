/**
 * PaywallScreen restore button tap test.
 *
 * Verifies:
 * - render PaywallScreen with @testing-library/react-native
 * - press testID="paywall.restore"
 * - restore is called exactly once from that tap interaction
 * - restore is NOT called on mount (before any tap)
 */
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

const mockRestore = jest.fn();
const mockPackageFor = (identifier: string, priceString: string) => ({
  product: { identifier, priceString },
});

jest.mock('@/stores/proStore', () => {
  const mockLoadOfferingsIfNeeded = jest.fn();
  const MockedStore = (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      status: 'free',
      entitlementActive: false,
      trialActive: false,
      trialEndsAt: null,
      entitlementExpiresAt: null,
      offeringsReady: true,
      monthlyPackage: mockPackageFor('monthly', '$0.99'),
      yearlyPackage: mockPackageFor('yearly', '$9.99'),
      lifetimePackage: mockPackageFor('lifetime', '$19.99'),
      currentOffering: null,
      isPurchasing: false,
      isRestoring: false,
      error: null,
      interstitialEligible: false,
      configured: true,
      loadOfferingsIfNeeded: mockLoadOfferingsIfNeeded,
      restore: mockRestore,
    });
  Object.assign(MockedStore, {
    getState: () => ({
      status: 'free',
      entitlementActive: false,
      trialActive: false,
      trialEndsAt: null,
      entitlementExpiresAt: null,
      offeringsReady: true,
      monthlyPackage: mockPackageFor('monthly', '$0.99'),
      yearlyPackage: mockPackageFor('yearly', '$9.99'),
      lifetimePackage: mockPackageFor('lifetime', '$19.99'),
      currentOffering: null,
      isPurchasing: false,
      isRestoring: false,
      error: null,
      interstitialEligible: false,
      configured: true,
      restore: mockRestore,
      loadOfferingsIfNeeded: mockLoadOfferingsIfNeeded,
    }),
    setState: jest.fn(),
    subscribe: () => (() => { /* noop */ }),
    getInitialState: () => ({}),
  });
  return { useProStore: MockedStore };
});

jest.mock('@/services/RevenueCatService', () => ({
  getIntroEligibilities: jest.fn().mockResolvedValue({}),
  trackPaywallImpression: jest.fn(),
}));

jest.mock('@/services/PaywallAnalytics', () => ({
  trackPaywallOpen: jest.fn(),
  trackPaywallClose: jest.fn(),
  trackCtaTap: jest.fn(),
  trackRestoreTap: jest.fn(),
  trackRestoreOutcome: jest.fn(),
}));

jest.mock('@/components/paywall/PaywallPlanGrid', () => {
  const ReactNative = jest.requireActual('react-native');
  const React = jest.requireActual('react');

  return {
    __esModule: true,
    default: ({ plans }: { plans: Array<{ id: string; variant: string }> }) =>
      React.createElement(
        ReactNative.View,
        { testID: 'paywall.plans' },
        plans.map((plan) =>
          React.createElement(
            ReactNative.View,
            { key: plan.id, testID: `paywall.plan.${plan.id}` },
            React.createElement(
              ReactNative.Text,
              { testID: `paywall.plan.${plan.id}.variant` },
              plan.variant,
            ),
          ),
        ),
      ),
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));

jest.mock('@/contexts/ThemeContext', () => {
  const mockColors = {
    background: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    accent: '#0066ff',
    error: '#ff0000',
    surface: '#ffffff',
    border: '#dddddd',
    card: '#eeeeee',
    success: '#00aa00',
    warning: '#ffaa00',
  };
  return {
    useTheme: () => ({ colors: mockColors, style: {}, isDark: false }),
    useTokens: () => ({
      colors: mockColors,
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
      radii: { sm: 4, md: 8, lg: 16, full: 9999 },
      type: 'light' as const,
    }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

import PaywallScreen from '@/screens/PaywallScreen';

describe('PaywallScreen restore button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRestore.mockResolvedValue('nothing');
  });

  it('does NOT call restore on mount', async () => {
    const { getByTestId } = render(<PaywallScreen />);

    await waitFor(() => {
      expect(getByTestId('paywall.restore')).toBeTruthy();
    });

    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('calls restore exactly once when user taps paywall.restore', async () => {
    const { getByTestId } = render(<PaywallScreen />);

    await waitFor(() => {
      expect(getByTestId('paywall.restore')).toBeTruthy();
    });

    fireEvent.press(getByTestId('paywall.restore'));

    await waitFor(() => {
      expect(mockRestore).toHaveBeenCalledTimes(1);
    });
  });

  it('puts Lifetime first and makes it the primary offer', async () => {
    const { getByTestId } = render(<PaywallScreen />);

    await waitFor(() => {
      expect(getByTestId('paywall.plan.lifetime')).toBeTruthy();
    });

    const planGrid = getByTestId('paywall.plans');
    const planChildren = planGrid.props.children as ReactElement<{ testID?: string }>[];
    const planIds = planChildren.map((plan) => plan.props.testID);

    expect(planIds).toEqual([
      'paywall.plan.lifetime',
      'paywall.plan.yearly',
      'paywall.plan.monthly',
    ]);
    expect(getByTestId('paywall.plan.lifetime.variant').props.children).toBe('primary');
    expect(getByTestId('paywall.plan.yearly.variant').props.children).toBe('secondary');
    expect(getByTestId('paywall.plan.monthly.variant').props.children).toBe('secondary');
  });
});
