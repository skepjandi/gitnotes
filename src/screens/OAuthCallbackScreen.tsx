import { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<OAuthCallbackRoute>();
  const { refreshAccounts } = useAccounts();
  const [result, setResult] = useState<OAuthCallbackResult | null>(null);
  const pendingStateRef = useRef<string | null>(null);

  useEffect(() => {
    const { code, state, error, error_description } = route.params ?? {};

    if (!state) {
      setResult({ outcome: 'malformed' });
      return;
    }

    const pending = pendingOAuthFlows.get(state);
    if (!pending) {
      setResult({ outcome: 'malformed' });
      return;
    }

    pendingStateRef.current = state;

    if (error) {
      const deniedResult = { outcome: 'denied' as const, code: error, message: error_description };
      const pending = pendingOAuthFlows.get(state);
      if (pending) {
        pending.oauthResult = deniedResult;
      }
      setResult(deniedResult);
      return;
    }
    if (!code) {
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

  const handleDoneSimple = () => {
    navigation.navigate('Onboarding', { fromOAuth: true, oauthState: pendingStateRef.current ?? null });
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
            {t('onboarding.oauthCallback.completingSignIn')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const success = result.outcome === 'success';
  const denied = result.outcome === 'denied' || result.outcome === 'cancelled';
  const freeTierLimit = result.outcome === 'free_tier_limit_reached';
  const simpleMode = (() => {
    if (!pendingStateRef.current) return false;
    const pending = pendingOAuthFlows.get(pendingStateRef.current);
    return pending?.returnTo === 'onboarding';
  })();
  const title = success
    ? t('onboarding.oauthCallback.title.success')
    : denied
      ? t('onboarding.oauthCallback.title.denied')
      : freeTierLimit
        ? t('onboarding.oauthCallback.title.freeTierLimit')
        : t('onboarding.oauthCallback.title.failed');
  const message = success
    ? simpleMode
      ? t('onboarding.oauthCallback.message.successSimple')
      : t('onboarding.oauthCallback.message.success')
    : denied
      ? t('onboarding.oauthCallback.message.denied')
      : freeTierLimit
        ? t('onboarding.oauthCallback.message.freeTierLimit')
        : result.outcome === 'backend_error' && result.message
          ? result.message
          : t('onboarding.oauthCallback.message.failed');

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text className="text-xl font-bold" style={{ color: colors.text }}>
          {title}
        </Text>
        <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
          {message}
        </Text>
        {simpleMode ? (
          <Button label={t('onboarding.oauthCallback.continueButton')} onPress={handleDoneSimple} className="mt-4" />
        ) : (
          <Button label={t('onboarding.oauthCallback.backToSettingsButton')} onPress={handleDone} className="mt-4" />
        )}
      </View>
    </SafeAreaView>
  );
}
