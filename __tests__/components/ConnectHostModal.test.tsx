/**
 * Tests for ConnectHostModal token rejection guidance.
 *
 * Verifies that handleTest and handleSave show reason-specific i18n
 * guidance from settings.token* keys when token validation fails.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ConnectHostModal } from '@/components/ConnectHostModal';

// ─── Mock react-native ───────────────────────────────────────────────────────
jest.mock('react-native', () => {
  const fn = jest.fn();
  const React = require('react');
  return {
    __esModule: true,
    View: 'View',
    Text: 'Text',
    TextInput: ({ testID, placeholder, ...rest }: { testID?: string; placeholder?: string; [key: string]: unknown }) =>
      React.createElement('TextInput', { testID, placeholder, ...rest }),
    ScrollView: 'ScrollView',
    Pressable: 'Pressable',
    ActivityIndicator: 'ActivityIndicator',
    SafeAreaView: 'SafeAreaView',
    Alert: { alert: jest.fn() },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    StyleSheet: { create: (style: unknown) => style, flatten: fn },
    AppState: { addEventListener: fn, removeEventListener: fn, currentState: 'active' },
    Keyboard: { dismiss: fn, addListener: fn, removeListener: fn },
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    TouchableOpacity: 'TouchableOpacity',
    Image: 'Image',
    FlatList: 'FlatList',
    SectionList: 'SectionList',
    RefreshControl: 'RefreshControl',
    Switch: 'Switch',
    Modal: 'Modal',
    StatusBar: 'StatusBar',
    Dimensions: { get: () => ({ width: 375, height: 812 }), addEventListener: fn, removeEventListener: fn },
    PixelRatio: { get: () => 2, getFontScale: () => 1 },
    NativeModules: {},
    DevMenu: {},
    DevSettings: {},
  };
});

// ─── Mock react-i18next ───────────────────────────────────────────────────────
const T_MOCK = (key: string) => key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: T_MOCK,
    i18n: { language: 'en' },
  }),
}));

// ─── Mock ThemeContext ────────────────────────────────────────────────────────
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      background: '#ffffff',
      surface: '#f5f5f5',
      primary: '#007AFF',
      text: '#000000',
      textSecondary: '#666666',
      border: '#cccccc',
      error: '#FF3B30',
    },
  }),
  useTokens: () => ({
    spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
    colors: {
      background: '#ffffff',
      surface: '#f5f5f5',
      primary: '#007AFF',
      text: '#000000',
      textSecondary: '#666666',
      border: '#cccccc',
      error: '#FF3B30',
    },
  }),
}));

// ─── Mock Modal ───────────────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  Modal: jest.fn(({ children }) => children ?? null),
}));

// ─── Mock AccountsContext ────────────────────────────────────────────────────
const mockTestToken = jest.fn();
const mockConnectHost = jest.fn();

jest.mock('@/contexts/AccountsContext', () => ({
  useAccounts: () => ({
    testToken: mockTestToken,
    connectHost: mockConnectHost,
    accountSummaries: [],
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
const alert = Alert.alert as jest.MockedFunction<typeof Alert.alert>;

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
  colors: {
    background: '#ffffff',
    surface: '#f5f5f5',
    primary: '#007AFF',
    text: '#000000',
    textSecondary: '#666666',
    border: '#cccccc',
    error: '#FF3B30',
  },
};

const renderModal = (props = {}) => {
  return render(<ConnectHostModal {...defaultProps} {...props} />);
};

const enterToken = (getByPlaceholderText: (text: string) => ReturnType<typeof render>['getByPlaceholderText'], token: string) => {
  const tokenInput = getByPlaceholderText('connectHost.tokenPlaceholder');
  fireEvent.changeText(tokenInput, token);
};

// ─── Tests ─────────────────────────────────────────────────────────────────────
describe('ConnectHostModal token error guidance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTestToken.mockReset();
    mockConnectHost.mockReset();
  });

  it('requires Forgejo repository details before testing a scoped token', async () => {
    const { getByPlaceholderText, getByText, getByTestId } = renderModal();
    fireEvent.press(getByTestId('connect-host-provider-forgejo'));
    fireEvent(getByTestId('connect-host-forgejo-repo-scoped-toggle'), 'valueChange', true);
    enterToken(getByPlaceholderText, 'forgejo_repo_token');

    await act(async () => {
      fireEvent.press(getByText('connectHost.test'));
    });

    expect(alert).toHaveBeenCalledWith(
      'connectHost.error.forgejoRepositoryDetailsRequired',
    );
    expect(mockTestToken).not.toHaveBeenCalled();
  });

  it('passes the Forgejo repo target for repo-scoped token validation and save', async () => {
    mockTestToken.mockResolvedValueOnce({ ok: true });
    mockConnectHost.mockResolvedValueOnce({ ok: true });

    const { getByPlaceholderText, getByText, getByTestId } = renderModal();
    fireEvent.press(getByTestId('connect-host-provider-forgejo'));
    fireEvent(getByTestId('connect-host-forgejo-repo-scoped-toggle'), 'valueChange', true);
    fireEvent.changeText(getByTestId('connect-host-forgejo-username-input'), 'writer');
    fireEvent.changeText(getByTestId('connect-host-forgejo-repository-input'), 'team/notes');
    enterToken(getByPlaceholderText, 'forgejo_repo_token');

    await act(async () => {
      fireEvent.press(getByText('connectHost.test'));
    });
    await act(async () => {
      fireEvent.press(getByText('connectHost.save'));
    });

    expect(mockTestToken).toHaveBeenCalledWith(
      'forgejo',
      'forgejo_repo_token',
      'https://codeberg.org/api/v1',
      { owner: 'team', repo: 'notes', username: 'writer' },
    );
    expect(mockConnectHost).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'forgejo',
        token: 'forgejo_repo_token',
        forgejoRepositoryToken: { owner: 'team', repo: 'notes', username: 'writer' },
      }),
    );
  });

  describe('handleTest', () => {
    it('shows tokenMissingRepoScope guidance for missing_repo_scope reason', async () => {
      mockTestToken.mockResolvedValueOnce({ ok: false, reason: 'missing_repo_scope' });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.test'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'settings.tokenMissingRepoScope',
        );
      });
    });

    it('shows tokenMissingContentsPermission guidance for missing_contents_permission reason', async () => {
      mockTestToken.mockResolvedValueOnce({ ok: false, reason: 'missing_contents_permission' });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.test'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'settings.tokenMissingContentsPermission',
        );
      });
    });

    it('shows tokenSamlError guidance for saml reason', async () => {
      mockTestToken.mockResolvedValueOnce({ ok: false, reason: 'saml' });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.test'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'settings.tokenSamlError',
        );
      });
    });

    it('shows tokenNoRepoAccess guidance for no_repository_access reason', async () => {
      mockTestToken.mockResolvedValueOnce({ ok: false, reason: 'no_repository_access' });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.test'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'settings.tokenNoRepoAccess',
        );
      });
    });

    it('shows tokenTestInvalid guidance for invalid reason', async () => {
      mockTestToken.mockResolvedValueOnce({ ok: false, reason: 'invalid' });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.test'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'settings.tokenTestInvalid',
        );
      });
    });

    it('shows tokenTestNetwork guidance for network reason', async () => {
      mockTestToken.mockResolvedValueOnce({ ok: false, reason: 'network' });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.test'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'settings.tokenTestNetwork',
        );
      });
    });

    it('shows generic fallback for non-GitHub providers', async () => {
      mockTestToken.mockResolvedValueOnce({ ok: false, reason: 'invalid' });

      const { getByPlaceholderText, getByText, getByTestId } = renderModal();

      // Select GitLab provider
      const gitlabButton = getByTestId('connect-host-provider-gitlab');
      fireEvent.press(gitlabButton);

      enterToken(getByPlaceholderText, 'glpat_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.test'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'connectHost.error.invalidTokenBody',
        );
      });
    });

    it('shows success alert when token is valid', async () => {
      mockTestToken.mockResolvedValueOnce({ ok: true });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_valid_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.test'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.success.testTitle',
          'connectHost.success.testBody',
        );
      });
    });
  });

  describe('handleSave', () => {
    it('shows tokenMissingRepoScope guidance for missing_repo_scope reason', async () => {
      mockConnectHost.mockResolvedValueOnce({ ok: false, reason: 'missing_repo_scope' });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.save'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'settings.tokenMissingRepoScope',
        );
      });
    });

    it('shows tokenSamlError guidance for saml reason', async () => {
      mockConnectHost.mockResolvedValueOnce({ ok: false, reason: 'saml' });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.save'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'settings.tokenSamlError',
        );
      });
    });

    it('shows tokenNoRepoAccess guidance for no_repository_access reason', async () => {
      mockConnectHost.mockResolvedValueOnce({ ok: false, reason: 'no_repository_access' });

      const { getByPlaceholderText, getByText } = renderModal();
      enterToken(getByPlaceholderText, 'ghp_test_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.save'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'settings.tokenNoRepoAccess',
        );
      });
    });

    it('shows generic fallback for non-GitHub providers on save', async () => {
      mockConnectHost.mockResolvedValueOnce({ ok: false, reason: 'invalid' });

      const { getByPlaceholderText, getByText, getByTestId } = renderModal();

      // Select Gitea provider
      const giteaButton = getByTestId('connect-host-provider-gitea');
      fireEvent.press(giteaButton);

      enterToken(getByPlaceholderText, 'gitea_token');
      await act(async () => {
        fireEvent.press(getByText('connectHost.save'));
      });

      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          'connectHost.error.invalidToken',
          'connectHost.error.invalidTokenBody',
        );
      });
    });
  });
});
