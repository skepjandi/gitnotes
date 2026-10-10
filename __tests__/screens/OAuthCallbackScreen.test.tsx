/**
 * OAuthCallbackScreen regression tests.
 *
 * Verifies correct routing after GitHub OAuth callback for:
 * - Onboarding (simple) vs Settings return paths
 * - Success, denied, cancelled, and backend_error outcomes
 * - No pending state (malformed callback) falls back to Settings
 *
 * Bug fixed: previously, denied/cancelled onboarding OAuth incorrectly
 * routed to Settings because pendingStateRef was set AFTER the error
 * check, so simpleMode was always false on error paths.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => {
  const mockNavigate = jest.fn();
  const mockGoBack = jest.fn();
  const mockUseRoute = jest.fn(() => ({ params: {} }));
  return {
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
    }),
    useRoute: () => mockUseRoute(),
    __mockNavigate: mockNavigate,
    __mockGoBack: mockGoBack,
    __mockUseRoute: mockUseRoute,
  };
});

jest.mock('@/contexts/ThemeContext', () => {
  const mockColors = {
    background: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    accent: '#0066ff',
    error: '#ff0000',
    surface: '#eeeeee',
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

jest.mock('@/contexts/AccountsContext', () => ({
  useAccounts: () => ({
    refreshAccounts: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../../src/services/GitHubOAuthService', () => {
  const mockPendingOAuthFlows = new Map();
  const mockExchangeCode = jest.fn((params: { state?: string }) => {
    return Promise.resolve();
  });
  return {
    __mockExchangeCode: mockExchangeCode,
    GitHubOAuthService: {
      exchangeCode: (...args: unknown[]) => mockExchangeCode(...args),
    },
    pendingOAuthFlows: mockPendingOAuthFlows,
    default: {
      exchangeCode: (...args: unknown[]) => mockExchangeCode(...args),
    },
    setHttpClient: jest.fn(),
  };
});

const mockNavigate = (jest.requireMock('@react-navigation/native') as { __mockNavigate: jest.Mock }).__mockNavigate;
const mockGoBack = (jest.requireMock('@react-navigation/native') as { __mockGoBack: jest.Mock }).__mockGoBack;
const mockUseRoute = (jest.requireMock('@react-navigation/native') as { __mockUseRoute: jest.Mock }).__mockUseRoute;
const mockExchangeCode = (jest.requireMock('../../src/services/GitHubOAuthService') as { __mockExchangeCode: jest.Mock }).__mockExchangeCode;
const mockPendingOAuthFlows = (jest.requireMock('../../src/services/GitHubOAuthService') as { pendingOAuthFlows: Map<string, unknown> }).pendingOAuthFlows;

import OAuthCallbackScreen from '@/screens/OAuthCallbackScreen';

describe('OAuthCallbackScreen', () => {
  beforeEach(() => {
    mockPendingOAuthFlows.clear();
    mockExchangeCode.mockReset();
    mockExchangeCode.mockImplementation(() => new Promise(() => { /* noop */ }));
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockUseRoute.mockReset();
    mockUseRoute.mockReturnValue({ params: {} });
  });

  describe('onboarding flow (returnTo: onboarding)', () => {
    beforeEach(() => {
      mockPendingOAuthFlows.set('onboarding-state', {
        verifier: 'test-verifier',
        backendUrl: 'https://backend.example.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-1',
        returnTo: 'onboarding',
        githubLogin: 'testuser',
      });
      mockUseRoute.mockReturnValue({
        params: { code: 'auth-code-123', state: 'onboarding-state' },
      });
    });

    it('shows Continue button on OAuth success', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'success',
        credential: {
          id: 'host-1:oauth',
          hostId: 'host-1',
          kind: 'oauth',
          addedAt: Date.now(),
          accessToken: 'test-access-token',
          login: 'testuser',
          userId: 123,
          expiresAt: Date.now() + 3600000,
          renewal: {
            refreshToken: 'test-refresh-token',
            refreshExpiresAt: Date.now() + 86400000,
            backendUrl: 'https://backend.example.com',
          },
        },
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(mockExchangeCode).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(getByText('Continue')).toBeTruthy();
      });

      expect(() => getByText('Back to Settings')).toThrow();
    });

    it('navigates to Onboarding with fromOAuth: true on Continue press after success', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'success',
        credential: {
          id: 'host-1:oauth',
          hostId: 'host-1',
          kind: 'oauth',
          addedAt: Date.now(),
          accessToken: 'test-access-token',
          login: 'testuser',
          userId: 123,
          expiresAt: Date.now() + 3600000,
          renewal: {
            refreshToken: 'test-refresh-token',
            refreshExpiresAt: Date.now() + 86400000,
            backendUrl: 'https://backend.example.com',
          },
        },
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Continue')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByText('Continue'));
      });

      expect(mockNavigate).toHaveBeenCalledWith('Onboarding', { fromOAuth: true, oauthState: 'onboarding-state' });
    });

    it('shows Continue button (not Back to Settings) on OAuth denied', async () => {
      mockUseRoute.mockReturnValue({
        params: { state: 'onboarding-state', error: 'access_denied', error_description: 'The user denied the request' },
      });

      const { getByText } = render(
        <OAuthCallbackScreen />
      );

      await waitFor(() => {
        expect(getByText('Continue')).toBeTruthy();
      });

      expect(() => getByText('Back to Settings')).toThrow();
    });

    it('shows Continue button (not Back to Settings) on OAuth cancelled', async () => {
      mockUseRoute.mockReturnValue({
        params: { state: 'onboarding-state', error: 'cancelled', error_description: 'User cancelled' },
      });

      const { getByText } = render(
        <OAuthCallbackScreen />
      );

      await waitFor(() => {
        expect(getByText('Continue')).toBeTruthy();
      });

      expect(() => getByText('Back to Settings')).toThrow();
    });

    it('shows Continue button on backend_error outcome', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'backend_error',
        code: 'exchange_denied',
        message: 'Token exchange failed',
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Continue')).toBeTruthy();
      });

      expect(() => getByText('Back to Settings')).toThrow();
    });

    it('shows Continue button (not Back to Settings) on free_tier_limit_reached', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'free_tier_limit_reached',
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Continue')).toBeTruthy();
      });

      expect(() => getByText('Back to Settings')).toThrow();
    });

    it('shows onboarding-specific success message', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'success',
        credential: {
          id: 'host-1:oauth',
          hostId: 'host-1',
          kind: 'oauth',
          addedAt: Date.now(),
          accessToken: 'test-access-token',
          login: 'testuser',
          userId: 123,
          expiresAt: Date.now() + 3600000,
          renewal: {
            refreshToken: 'test-refresh-token',
            refreshExpiresAt: Date.now() + 86400000,
            backendUrl: 'https://backend.example.com',
          },
        },
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Your GitHub account is connected. Setting up your notes…')).toBeTruthy();
      });
    });

    it('shows "GitHub Connected" title on success', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'success',
        credential: {
          id: 'host-1:oauth',
          hostId: 'host-1',
          kind: 'oauth',
          addedAt: Date.now(),
          accessToken: 'test-access-token',
          login: 'testuser',
          userId: 123,
          expiresAt: Date.now() + 3600000,
          renewal: {
            refreshToken: 'test-refresh-token',
            refreshExpiresAt: Date.now() + 86400000,
            backendUrl: 'https://backend.example.com',
          },
        },
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('GitHub Connected')).toBeTruthy();
      });
    });

    it('shows "Sign-in Cancelled" title on denied', async () => {
      mockUseRoute.mockReturnValue({
        params: { state: 'onboarding-state', error: 'access_denied', error_description: 'The user denied the request' },
      });

      const { getByText } = render(
        <OAuthCallbackScreen />
      );

      await waitFor(() => {
        expect(getByText('Sign-in Cancelled')).toBeTruthy();
      });
    });

    it('stores denied result in pending flow before navigating to Onboarding on error', async () => {
      mockUseRoute.mockReturnValue({
        params: { state: 'onboarding-state', error: 'access_denied', error_description: 'The user denied the request' },
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Continue')).toBeTruthy();
      });

      const pending = mockPendingOAuthFlows.get('onboarding-state');
      expect(pending).toBeDefined();
      expect((pending as { oauthResult?: unknown }).oauthResult).toMatchObject({
        outcome: 'denied',
        code: 'access_denied',
        message: 'The user denied the request',
      });
    });

    it('keeps success oauthResult in pending flow available for createRepository after Continue', async () => {
      const successResult = {
        outcome: 'success' as const,
        credential: {
          id: 'host-1:oauth',
          hostId: 'host-1',
          kind: 'oauth',
          addedAt: Date.now(),
          accessToken: 'test-access-token',
          login: 'testuser',
          userId: 123,
          expiresAt: Date.now() + 3600000,
          renewal: {
            refreshToken: 'test-refresh-token',
            refreshExpiresAt: Date.now() + 86400000,
            backendUrl: 'https://backend.example.com',
          },
        },
      };
      mockExchangeCode.mockImplementation((params: { state?: string }) => {
        const entry = mockPendingOAuthFlows.get(params?.state ?? '');
        if (entry) (entry as { oauthResult?: unknown }).oauthResult = successResult;
        return Promise.resolve(successResult);
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Continue')).toBeTruthy();
      });

      const pendingBefore = mockPendingOAuthFlows.get('onboarding-state');
      expect(pendingBefore).toBeDefined();
      expect((pendingBefore as { oauthResult?: unknown }).oauthResult).toMatchObject({
        outcome: 'success',
      });

      await act(async () => {
        fireEvent.press(getByText('Continue'));
      });

      expect(mockNavigate).toHaveBeenCalledWith('Onboarding', { fromOAuth: true, oauthState: 'onboarding-state' });
      const pendingAfter = mockPendingOAuthFlows.get('onboarding-state');
      expect(pendingAfter).toBeDefined();
      expect((pendingAfter as { oauthResult?: unknown }).oauthResult).toMatchObject({
        outcome: 'success',
      });
    });

    it('shows "Sign-in Failed" title on backend_error', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'backend_error',
        code: 'exchange_denied',
        message: 'Token exchange failed',
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Sign-in Failed')).toBeTruthy();
      });
    });

    it('shows "Account Limit Reached" title on free_tier_limit_reached', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'free_tier_limit_reached',
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Account Limit Reached')).toBeTruthy();
      });
    });
  });

  describe('settings flow (returnTo: settings)', () => {
    beforeEach(() => {
      mockPendingOAuthFlows.set('settings-state', {
        verifier: 'test-verifier',
        backendUrl: 'https://backend.example.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-2',
        returnTo: 'settings',
        githubLogin: 'settingsuser',
      });
      mockUseRoute.mockReturnValue({
        params: { code: 'auth-code-456', state: 'settings-state' },
      });
    });

    it('shows Back to Settings button on OAuth success', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'success',
        credential: {
          id: 'host-2:oauth',
          hostId: 'host-2',
          kind: 'oauth',
          addedAt: Date.now(),
          accessToken: 'test-access-token',
          login: 'settingsuser',
          userId: 456,
          expiresAt: Date.now() + 3600000,
          renewal: {
            refreshToken: 'test-refresh-token',
            refreshExpiresAt: Date.now() + 86400000,
            backendUrl: 'https://backend.example.com',
          },
        },
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Back to Settings')).toBeTruthy();
      });

      expect(() => getByText('Continue')).toThrow();
    });

    it('navigates to MainTabs/SettingsTab on Back to Settings press after success', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'success',
        credential: {
          id: 'host-2:oauth',
          hostId: 'host-2',
          kind: 'oauth',
          addedAt: Date.now(),
          accessToken: 'test-access-token',
          login: 'settingsuser',
          userId: 456,
          expiresAt: Date.now() + 3600000,
          renewal: {
            refreshToken: 'test-refresh-token',
            refreshExpiresAt: Date.now() + 86400000,
            backendUrl: 'https://backend.example.com',
          },
        },
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Back to Settings')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByText('Back to Settings'));
      });

      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'SettingsTab' });
    });

    it('shows Back to Settings button on OAuth denied', async () => {
      mockUseRoute.mockReturnValue({
        params: { state: 'settings-state', error: 'access_denied', error_description: 'User denied' },
      });

      const { getByText } = render(
        <OAuthCallbackScreen />
      );

      await waitFor(() => {
        expect(getByText('Back to Settings')).toBeTruthy();
      });

      expect(() => getByText('Continue')).toThrow();
    });

    it('shows Back to Settings button on backend_error outcome', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'backend_error',
        code: 'exchange_denied',
        message: 'Server error',
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Back to Settings')).toBeTruthy();
      });

      expect(() => getByText('Continue')).toThrow();
    });

    it('shows generic success message', async () => {
      mockExchangeCode.mockResolvedValueOnce({
        outcome: 'success',
        credential: {
          id: 'host-2:oauth',
          hostId: 'host-2',
          kind: 'oauth',
          addedAt: Date.now(),
          accessToken: 'test-access-token',
          login: 'settingsuser',
          userId: 456,
          expiresAt: Date.now() + 3600000,
          renewal: {
            refreshToken: 'test-refresh-token',
            refreshExpiresAt: Date.now() + 86400000,
            backendUrl: 'https://backend.example.com',
          },
        },
      });

      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Your GitHub account is now connected.')).toBeTruthy();
      });
    });
  });

  describe('no pending state (malformed callback)', () => {
    it('shows Back to Settings when state not found in pending flows', async () => {
      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Back to Settings')).toBeTruthy();
      });

      expect(() => getByText('Continue')).toThrow();
    });

    it('shows Back to Settings when callback has no state at all', async () => {
      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Back to Settings')).toBeTruthy();
      });
    });

    it('shows Back to Settings when callback has no code or state', async () => {
      const { getByText } = render(<OAuthCallbackScreen />);

      await waitFor(() => {
        expect(getByText('Back to Settings')).toBeTruthy();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading indicator before result is set', async () => {
      mockPendingOAuthFlows.set('loading-state', {
        verifier: 'test-verifier',
        backendUrl: 'https://backend.example.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-1',
        returnTo: 'onboarding',
      });
      mockUseRoute.mockReturnValue({
        params: { code: 'auth-code-loading', state: 'loading-state' },
      });
      mockExchangeCode.mockImplementation(
        () => new Promise(() => { /* noop */ }) // never resolves
      );

      const { queryByText } = render(<OAuthCallbackScreen />);

      expect(queryByText('Completing GitHub sign-in…')).toBeTruthy();
    });
  });
});
