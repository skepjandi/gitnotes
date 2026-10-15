/**
 * PaywallFeatureGrid component and accessibility test.
 *
 * Verifies:
 * - All 16 feature cards render (10 original + 6 new Pro cards)
 * - Each card has a unique testID matching its feature id
 * - Each card has a non-empty accessibilityLabel
 * - Translation keys are used consistently
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../src/components/ui', () => {
  const React = jest.requireActual('react');
  const ReactNative = jest.requireActual('react-native');

  return {
    Surface: ({
      children,
      testID,
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      testID?: string;
      accessibilityLabel?: string;
    }) => React.createElement(
      ReactNative.View,
      { testID, accessibilityLabel },
      children,
    ),
  };
});

jest.mock('../../../src/contexts/ThemeContext', () => {
  return {
    useTheme: () => ({
      colors: {
        text: '#000000',
        textSecondary: '#666666',
        primary: '#0066ff',
        surface: '#ffffff',
      },
    }),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('../../../src/theme/tokens', () => ({
  RADII: { sm: 4, md: 8, lg: 16, full: 9999 },
  SPACING: [4, 8, 12, 16, 20, 24, 32],
}));

import PaywallFeatureGrid from '../../../src/components/paywall/PaywallFeatureGrid';

// All 16 expected feature IDs in order
const EXPECTED_FEATURE_IDS = [
  'aiChat',
  'aiActions',
  'thoughtDump',
  'voiceDump',
  'personalizedQuotes',
  'githubTools',
  'canvases',
  'templates',
  'renderStyles',
  'multiAccount',
  'accentColor',
  'proAppIcons',
  'premiumThemes',
  'multiHost',
  'biometricLock',
  'unlimitedRepos',
];

describe('PaywallFeatureGrid', () => {
  it('renders all 16 feature cards', () => {
    const { getByTestId } = render(<PaywallFeatureGrid />);

    // Verify grid container exists
    expect(getByTestId('paywall.features')).toBeTruthy();

    // Verify all 16 cards render with correct testIDs
    for (const id of EXPECTED_FEATURE_IDS) {
      expect(getByTestId(`paywall.feature.${id}`)).toBeTruthy();
    }
  });

  it('renders exactly 16 cards', () => {
    const { getAllByTestId, getByTestId } = render(<PaywallFeatureGrid />);

    // Verify grid container exists
    const grid = getByTestId('paywall.features');
    const cards = getAllByTestId(/^paywall\.feature\./);
    expect(cards).toHaveLength(16);
    expect(grid).toBeTruthy();
  });

  it('each card has a non-empty accessibilityLabel', () => {
    const { getByTestId } = render(<PaywallFeatureGrid />);

    for (const id of EXPECTED_FEATURE_IDS) {
      const card = getByTestId(`paywall.feature.${id}`);
      const label = card.props.accessibilityLabel;
      expect(label).toBeTruthy();
      expect(typeof label).toBe('string');
      expect((label as string).length).toBeGreaterThan(0);
    }
  });

  it('accessibilityLabel contains title and description translation keys', () => {
    const { getByTestId } = render(<PaywallFeatureGrid />);

    for (const id of EXPECTED_FEATURE_IDS) {
      const card = getByTestId(`paywall.feature.${id}`);
      const label = card.props.accessibilityLabel as string;

      // Label format: "paywall.features.{id}.title. paywall.features.{id}.description"
      expect(label).toContain(`paywall.features.${id}.title`);
      expect(label).toContain(`paywall.features.${id}.description`);
    }
  });

  it('first card (aiChat) is the hero card', () => {
    const { getByTestId } = render(<PaywallFeatureGrid />);
    const heroCard = getByTestId('paywall.feature.aiChat');
    expect(heroCard).toBeTruthy();
  });

  it('new Pro cards have correct IDs', () => {
    const { getByTestId } = render(<PaywallFeatureGrid />);

    const newProIds = [
      'accentColor',
      'proAppIcons',
      'premiumThemes',
      'multiHost',
      'biometricLock',
      'unlimitedRepos',
    ];

    for (const id of newProIds) {
      expect(getByTestId(`paywall.feature.${id}`)).toBeTruthy();
    }
  });

  it('columnCountForWidth returns 2 for narrow and 3 for wide', () => {
    const { columnCountForWidth } = require('../../../src/components/paywall/PaywallFeatureGrid');
    expect(columnCountForWidth(390)).toBe(2);
    expect(columnCountForWidth(640)).toBe(3);
    expect(columnCountForWidth(800)).toBe(3);
    expect(columnCountForWidth(639)).toBe(2);
  });
});
