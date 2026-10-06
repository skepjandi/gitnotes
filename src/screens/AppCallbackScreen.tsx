/**
 * GitHub App callback screen.
 *
 * Receives deep links:
 * - `gitnotes://app/callback?installation_id=…&state=…` → success
 * - `gitnotes://app/denied` → user denied installation
 * - `gitnotes://app/duplicate` → App already installed
 *
 * Parses the URL, calls GitHubAppService.handleCallback(), and shows
 * a loading → success/error state before navigating back to Settings.
 *
 * The selected repository IDs and repositories are retrieved from the
 * in-memory pending App flow, keyed by the `state` parameter.
 */

import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme } from '../contexts/ThemeContext';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { Button } from '../components/ui';
import { useAccounts } from '../contexts/AccountsContext';
import { useRepoStore } from '../stores/repoStore';
import {
  GitHubAppService,
  pendingAppFlows,
  type AppCallbackResult,
} from '../services/GitHubAppService';
import type { RootStackParamList } from '../navigation/types';

type AppCallbackRoute = RouteProp<RootStackParamList, 'AppCallback'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function AppCallbackScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<AppCallbackRoute>();
  const { refreshAccounts, connectGitHubApp } = useAccounts();
  const refreshRepos = useRepoStore((state) => state.refreshRepos);

  const [result, setResult] = useState<AppCallbackResult | null>(null);

  useEffect(() => {
    const { installation_id, state, error, error_description } = route.params ?? {};

    if (error) {
      setResult({ outcome: 'denied', code: error, message: error_description });
      return;
    }

    if (!installation_id || !state) {
      setResult({ outcome: 'malformed' });
      return;
    }

    const pending = pendingAppFlows.get(state);
    GitHubAppService.handleCallback({ installationId: installation_id, state, pendingFlow: pending })
      .then(setResult)
      .catch(() => setResult({ outcome: 'malformed' }));
  }, [route.params]);

  const handleDone = () => {
    navigation.navigate('MainTabs', { screen: 'SettingsTab' });
  };

  useEffect(() => {
    if (result?.outcome === 'success') {
      refreshAccounts()
        .then(() => connectGitHubApp(result.credential.hostId))
        .then(() => refreshRepos())
        .catch(() => undefined);
    }
  }, [connectGitHubApp, refreshAccounts, refreshRepos, result]);

  if (!result) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <ActivityIndicator size="large" color={colors.accent} />
          <Text className="text-base" style={{ color: colors.text }}>
            Completing GitHub App setup…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  switch (result.outcome) {
    case 'success':
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#34C759' }}>✓</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              GitHub App Connected
            </Text>
            <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
              Installation successful. Your repositories are now connected.
            </Text>
            <Button label="Done" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );

    case 'denied':
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#FF9500' }}>✗</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Installation Denied
            </Text>
            <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
              You denied the GitHub App installation.
            </Text>
            <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );

    case 'duplicate':
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#FF9500' }}>!</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Already Installed
            </Text>
            <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
              This GitHub App is already installed for your account.
            </Text>
            <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );

    case 'wrong_app':
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#FF3B30' }}>✗</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Wrong App
            </Text>
            <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
              The installation URL was for a different GitHub App. Please try again.
            </Text>
            <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );

    case 'owner_not_allowed':
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#FF3B30' }}>✗</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Owner Not Allowed
            </Text>
            <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
              The GitHub App does not allow installations by this account owner.
            </Text>
            <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );

    case 'free_tier_limit_reached':
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#FF3B30' }}>✗</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Account Limit Reached
            </Text>
            <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
              You have reached the maximum number of accounts on the Free plan. Upgrade to Pro to add more accounts.
            </Text>
            <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );

    case 'selection_mismatch':
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#FF3B30' }}>✗</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Repository Selection Changed
            </Text>
            <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
              The repository selection was modified after the installation URL was created.
              Please start over.
            </Text>
            <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );

    case 'malformed':
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#FF3B30' }}>✗</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Invalid Callback
            </Text>
            <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
              The GitHub App callback was malformed or the flow has expired.
            </Text>
            <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );

    case 'backend_error':
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#FF3B30' }}>✗</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Setup Failed
            </Text>
            <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
              {result.message || 'The backend encountered an error. Please try again.'}
            </Text>
            <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );

    default:
      return (
        <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-3xl" style={{ color: '#FF3B30' }}>✗</Text>
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Unknown Error
            </Text>
            <Button label="Back to Settings" onPress={handleDone} className="mt-4" />
          </View>
        </SafeAreaView>
      );
  }
}
