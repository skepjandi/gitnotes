import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { useTheme } from '../contexts/ThemeContext';
import { useAccounts } from '../contexts/AccountsContext';
import {
  GitHubOAuthService,
  pendingOAuthFlows,
  type OAuthCallbackResult,
} from '../services/GitHubOAuthService';
import type { RootStackParamList } from '../navigation/types';

type OAuthCallbackRoute = RouteProp<RootStackParamList, 'OAuthCallback'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function OAuthCallbackScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<OAuthCallbackRoute>();
  const { refreshAccounts } = useAccounts();
  const [result, setResult] = useState<OAuthCallbackResult | null>(null);

  useEffect(() => {
    const { code, state, error, error_description } = route.params ?? {};

    if (error) {
      setResult({ outcome: 'denied', code, message: error_description });
      return;
    }
    if (!code || !state) {
      setResult({ outcome: 'malformed' });
      return;
    }

    const pending = pendingOAuthFlows.get(state);
    if (!pending) {
      setResult({ outcome: 'malformed' });
      return;
    }

    GitHubOAuthService.exchangeCode({
      code,
      codeVerifier: pending.verifier,
      state,
      redirectUri: pending.redirectUri,
      clientId: pending.clientId,
      backendUrl: pending.backendUrl,
      hostId: pending.hostId,
    })
      .then(setResult)
      .catch(() => setResult({ outcome: 'malformed' }));
  }, [route.params]);

  const handleDone = () => {
    navigation.navigate('MainTabs', { screen: 'SettingsTab' });
  };

  useEffect(() => {
    if (result?.outcome === 'success') {
      refreshAccounts().catch(() => undefined);
    }
  }, [refreshAccounts, result]);

  if (!result) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <ActivityIndicator size="large" color={colors.accent} />
          <Text className="text-base" style={{ color: colors.text }}>
            Completing GitHub sign-in…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const success = result.outcome === 'success';
  const denied = result.outcome === 'denied' || result.outcome === 'cancelled';
  const freeTierLimit = result.outcome === 'free_tier_limit_reached';
  const title = success
    ? 'GitHub Connected'
    : denied
      ? 'Sign-in Cancelled'
      : freeTierLimit
        ? 'Account Limit Reached'
        : 'Sign-in Failed';
  const message = success
    ? 'Your GitHub account is now connected.'
    : denied
      ? 'GitHub sign-in was cancelled or denied.'
      : freeTierLimit
        ? 'You have reached the maximum number of accounts on the Free plan. Upgrade to Pro to add more accounts.'
        : result.outcome === 'backend_error' && result.message
          ? result.message
          : 'The GitHub sign-in flow could not be completed. Please try again.';

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text className="text-xl font-bold" style={{ color: colors.text }}>
          {title}
        </Text>
        <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
          {message}
        </Text>
        <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
      </View>
    </SafeAreaView>
  );
}
