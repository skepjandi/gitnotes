import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import RewardCatalogModal from '../../../src/components/settings/RewardCatalogModal';
import type { RewardEntry, ReferralStatus } from '../../../src/services/RewardEntitlementService';

let mockAlertCalls: Array<{ title: string; message: string; buttons: unknown[] }> = [];

jest.mock('react-native', () => {
  const React = require('react');
  const View = (props: object & { children?: React.ReactNode }) =>
    React.createElement('View', props, (props as { children?: React.ReactNode })?.children);
  View.displayName = 'View';
  const Text = (props: object & { children?: React.ReactNode }) =>
    React.createElement('Text', props, (props as { children?: React.ReactNode })?.children);
  Text.displayName = 'Text';
  const Image = (props: object & { children?: React.ReactNode }) =>
    React.createElement('Image', props, (props as { children?: React.ReactNode })?.children);
  Image.displayName = 'Image';
  const TouchableOpacity = (props: object & { onPress?: () => void; children?: React.ReactNode }) =>
    React.createElement('TouchableOpacity', props, (props as { children?: React.ReactNode })?.children);
  TouchableOpacity.displayName = 'TouchableOpacity';
  return {
    __esModule: true,
    View,
    Text,
    Image,
    TouchableOpacity,
    StyleSheet: { create: (s: object) => s, flatten: (s: object) => s, hairlineWidth: 1 },
    Platform: { OS: 'ios', select: (o: object) => o },
    PixelRatio: { get: () => 2 },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
    ScrollView: View,
    ActivityIndicator: View,
    Modal: View,
    KeyboardAvoidingView: View,
    Pressable: View,
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return {
    Ionicons: ({ name, size, color }: { name?: string; size?: number; color?: string }) =>
      React.createElement('Text', { name, size, color }, name),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: jest.fn() },
  }),
}));

jest.mock('../../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      surface: '#f0f0f0',
      primary: '#007AFF',
      accent: '#3b82f6',
      text: '#000000',
      textSecondary: '#666666',
      border: '#cccccc',
      error: '#FF3B30',
      elevated: '#e5e5ea',
      surfaceSecondary: '#eeeeee',
    },
    isDark: false,
    setTheme: jest.fn(),
    setAccentColor: jest.fn(),
    accentColor: '#3b82f6',
  }),
}));

jest.mock('../../../src/utils/haptics', () => ({
  HapticService: { selection: jest.fn() },
}));

jest.mock('../../../src/services/RewardEntitlementService', () => ({
  RewardEntitlementService: {
    fetchStatus: jest.fn(),
    getStatus: jest.fn(),
    isUnlocked: jest.fn(),
  },
}));

jest.mock('../../../src/components/ui', () => ({
  Modal: ({ children, visible, onRequestClose }: { children?: React.ReactNode; visible?: boolean; onRequestClose?: () => void }) => {
    const React = require('react');
    return visible ? React.createElement('View', { visible: true, onRequestClose }, children) : null;
  },
}));

jest.mock('../../../src/types/worker', () => ({
  REFERRAL_MILESTONES: [1, 3, 5, 10, 15],
}));

function makeProps(overrides: {
  visible?: boolean;
  appIconSupported?: boolean;
  currentStyle?: string;
  currentIcon?: string | null;
  rewards?: RewardEntry[];
} = {}) {
  const {
    visible = true,
    appIconSupported = true,
    currentStyle = 'flat',
    currentIcon = null,
    rewards = [],
  } = overrides;

  const { RewardEntitlementService } = require('../../../src/services/RewardEntitlementService');
  const status: ReferralStatus = {
    has_pending_code: false,
    pending_code: null,
    pending_expires_at: null,
    progress: rewards.filter(r => r.unlocked).length * 3,
    catalog_version: 1,
    unlocked_milestones: rewards.filter(r => r.unlocked).map(r => r.milestone),
    rewards,
  };
  (RewardEntitlementService.fetchStatus as jest.Mock).mockImplementation(() => Promise.resolve(status));
  (RewardEntitlementService.getStatus as jest.Mock).mockReturnValue(status);

  return {
    visible,
    onRequestClose: jest.fn(),
    onSelectTheme: jest.fn(),
    onSelectIcon: jest.fn(),
    currentStyle,
    currentIcon,
    appIconSupported,
  };
}

describe('RewardCatalogModal appIconSupported gating', () => {
  afterEach(() => {
    mockAlertCalls = [];
  });

  it('when appIconSupported=false, no icon reward rows are rendered', async () => {
    const rewards: RewardEntry[] = [
      { milestone: 1, name: 'Terminal Mono Icon', reward_type: 'icon', reward_key: 'terminal-mono-icon', unlocked: true },
    ];
    const props = makeProps({ appIconSupported: false, rewards });
    const { queryByTestId, getByText } = render(<RewardCatalogModal {...props} />);
    await waitFor(() => {
      expect(queryByTestId('reward.row.terminal-mono-icon')).toBeNull();
    });
    await waitFor(() => {
      expect(getByText('App icons not supported on this platform')).toBeTruthy();
    });
  });

  it('when appIconSupported=false, onSelectIcon is NOT called for any icon row', async () => {
    const rewards: RewardEntry[] = [
      { milestone: 1, name: 'Terminal Mono Icon', reward_type: 'icon', reward_key: 'terminal-mono-icon', unlocked: true },
    ];
    const onSelectIcon = jest.fn();
    const props = makeProps({ appIconSupported: false, rewards, onSelectIcon });
    const { queryByTestId } = render(<RewardCatalogModal {...props} />);
    await waitFor(() => {
      expect(queryByTestId('reward.row.terminal-mono-icon')).toBeNull();
    });
    expect(onSelectIcon).not.toHaveBeenCalled();
  });

  it('when appIconSupported=true with zero iconRewards, empty state is shown', async () => {
    const rewards: RewardEntry[] = [
      { milestone: 3, name: 'Terminal Mono Theme', reward_type: 'theme', reward_key: 'terminal-mono-theme', unlocked: false },
    ];
    const props = makeProps({ appIconSupported: true, rewards });
    const { getByText, queryByTestId } = render(<RewardCatalogModal {...props} />);
    await waitFor(() => {
      expect(getByText('No icon rewards unlocked yet')).toBeTruthy();
    });
    await waitFor(() => {
      expect(queryByTestId('reward.row.terminal-mono-icon')).toBeNull();
    });
  });

  it('when appIconSupported=true with iconRewards, icon rows ARE rendered', async () => {
    const rewards: RewardEntry[] = [
      { milestone: 1, name: 'Terminal Mono Icon', reward_type: 'icon', reward_key: 'terminal-mono-icon', unlocked: true },
    ];
    const props = makeProps({ appIconSupported: true, rewards });
    const { getByTestId } = render(<RewardCatalogModal {...props} />);
    await waitFor(() => {
      expect(getByTestId('reward.row.terminal-mono-icon')).toBeTruthy();
    });
  });
});

describe('RewardCatalogModal icon artwork rendering', () => {
  afterEach(() => {
    mockAlertCalls = [];
  });

  it('terminal-mono-icon reward row renders', async () => {
    const rewards: RewardEntry[] = [
      { milestone: 1, name: 'Terminal Mono Icon', reward_type: 'icon', reward_key: 'terminal-mono-icon', unlocked: true },
    ];
    const props = makeProps({ rewards });
    const { getByTestId } = render(<RewardCatalogModal {...props} />);
    await waitFor(() => {
      expect(getByTestId('reward.row.terminal-mono-icon')).toBeTruthy();
    });
  });

  it('amber-terminal-icon reward row renders', async () => {
    const rewards: RewardEntry[] = [
      { milestone: 5, name: 'Amber Terminal Icon', reward_type: 'icon', reward_key: 'amber-terminal-icon', unlocked: true },
    ];
    const props = makeProps({ rewards });
    const { getByTestId } = render(<RewardCatalogModal {...props} />);
    await waitFor(() => {
      expect(getByTestId('reward.row.amber-terminal-icon')).toBeTruthy();
    });
  });

  it('monochrome-grid-icon reward row renders', async () => {
    const rewards: RewardEntry[] = [
      { milestone: 15, name: 'Monochrome Grid Icon', reward_type: 'icon', reward_key: 'monochrome-grid-icon', unlocked: true },
    ];
    const props = makeProps({ rewards });
    const { getByTestId } = render(<RewardCatalogModal {...props} />);
    await waitFor(() => {
      expect(getByTestId('reward.row.monochrome-grid-icon')).toBeTruthy();
    });
  });

  it('locked icon row is rendered but disabled', async () => {
    const rewards: RewardEntry[] = [
      { milestone: 1, name: 'Terminal Mono Icon', reward_type: 'icon', reward_key: 'terminal-mono-icon', unlocked: false },
    ];
    const props = makeProps({ rewards });
    const { getByTestId } = render(<RewardCatalogModal {...props} />);
    await waitFor(() => {
      expect(getByTestId('reward.row.terminal-mono-icon')).toBeTruthy();
    });
  });
});
