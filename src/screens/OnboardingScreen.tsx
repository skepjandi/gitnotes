import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Alert,
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { useAccounts } from '../contexts/AccountsContext';
import { OnboardingService } from '../services/OnboardingService';
import { GitHubOAuthService, pendingOAuthFlows } from '../services/GitHubOAuthService';
import { GitHubAppService } from '../services/GitHubAppService';
import { Button, Input, Surface } from '../components/ui';
import { ProviderSelector } from '../components/ProviderSelector';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import type { RootStackParamList } from '../navigation/types';
import {
  GIT_HOST_API_BASES,
  type GitHostProvider,
} from '../services/git/GitHost';
import {
  OAUTH_CALLBACK_URL,
  WORKER_BASE_URL,
} from '../types/worker';

interface OnboardingScreenProps {
  onComplete: () => void;
  onSkip: () => void;
}

/**
 * Resolves the backend URL for OAuth/App handlers, normalizes the URL to avoid
 * double /api/v1 paths, and falls back to the Worker default when no override exists.
 */
function resolveBackendUrl(): string {
  const configured = process.env.EXPO_PUBLIC_GITNOTES_WORKER_BASE_URL?.trim();
  const base = configured || WORKER_BASE_URL;
  return base.replace(/\/api\/v1\/?$/, '');
}

/** Auth method options for GitHub. */
export type GitHubAuthMethod = 'pat' | 'oauth' | 'app' | 'quick';

const INFO_STEP_ICONS = [
  'journal-outline',
  'code-slash-outline',
  'folder-outline',
  'rocket-outline',
  'bulb-outline',
] as const;

export default function OnboardingScreen({
  onComplete,
  onSkip,
}: OnboardingScreenProps) {
  const { t } = useTranslation();

  // Standard flow: step 0=Welcome, step 1=Connect Git Host, steps 2-5=Info pages, step 6=AI
  // INFO_STEPS excludes Welcome since it's shown at step 0
  const INFO_STEPS = [
    {
      title: t('onboarding.steps.linkTitle'),
      description: t('onboarding.steps.linkDescription'),
      icon: INFO_STEP_ICONS[1],
    },
    {
      title: t('onboarding.steps.foldersTitle'),
      description: t('onboarding.steps.foldersDescription'),
      icon: INFO_STEP_ICONS[2],
    },
    {
      title: t('onboarding.steps.productiveTitle'),
      description: t('onboarding.steps.productiveDescription'),
      icon: INFO_STEP_ICONS[3],
    },
    {
      title: t('onboarding.steps.dumpTitle'),
      description: t('onboarding.steps.dumpDescription'),
      icon: INFO_STEP_ICONS[4],
    },
  ];

  const HOST_STEP = 0;
  const TOKEN_STEP = HOST_STEP + 1; // Connect a Git Host at index 1
  const INFO_STEP_START = TOKEN_STEP + 1; // Info pages start at index 2
  const AI_STEP = INFO_STEP_START + INFO_STEPS.length; // = 6
  const TOTAL_STEPS = AI_STEP + 1; // = 7, matches 7 progress dots
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Onboarding'>>();
  const { connectHost, refreshAccounts } = useAccounts();

  const [currentStep, setCurrentStep] = useState(0);

  const [selectedProvider, setSelectedProvider] =
    useState<GitHostProvider>('github');
  const [githubAuthMethod, setGithubAuthMethod] =
    useState<GitHubAuthMethod>('pat');
  const [token, setToken] = useState('');
  const [instanceUrl, setInstanceUrl] = useState(
    GIT_HOST_API_BASES.github,
  );
  const [isVerifying, setIsVerifying] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [isGithubAuthLoading, setIsGithubAuthLoading] = useState(false);
  const [githubAuthError, setGithubAuthError] = useState<string | null>(null);

  // Track OAuth result for Welcome step GitHub connect
  const oauthConsumedByState = useRef(new Set<string>());

  useEffect(() => {
    if (!route.params?.fromOAuth) return;
    const stateKey = route.params.oauthState ?? null;
    if (!stateKey) return;
    if (oauthConsumedByState.current.has(stateKey)) return;
    const pending = pendingOAuthFlows.get(stateKey);
    if (!pending) return;
    if (pending.returnTo !== 'onboarding') return;
    oauthConsumedByState.current.add(stateKey);
    if (pending.oauthResult?.outcome === 'success') {
      setCurrentStep(INFO_STEP_START);
      setGithubAuthError(null);
    } else if (pending.oauthResult) {
      const res = pending.oauthResult;
      if (res.outcome === 'denied' || res.outcome === 'cancelled') {
        setGithubAuthError(t('onboarding.simple.signInCancelled'));
      } else if (res.outcome === 'free_tier_limit_reached') {
        setGithubAuthError(t('onboarding.simple.accountLimitReached'));
      } else {
        setGithubAuthError(t('onboarding.simple.signInFailed'));
      }
      pendingOAuthFlows.delete(stateKey);
    }
  }, [route.params?.fromOAuth, route.params?.oauthState, t, INFO_STEP_START]);

  const finish = useCallback(async () => {
    await OnboardingService.completeOnboarding();
    onComplete();
  }, [onComplete]);

  const handleNext = useCallback(async () => {
    if (currentStep < TOKEN_STEP) {
      setCurrentStep(currentStep + 1);
    } else if (currentStep === TOKEN_STEP) {
      const normalizedInstanceUrl = instanceUrl.trim();
      if (
        selectedProvider !== 'github' &&
        normalizedInstanceUrl
      ) {
        let parsedInstanceUrl: URL;
        try {
          parsedInstanceUrl = new URL(normalizedInstanceUrl);
        } catch {
          setTokenError(t('connectHost.error.invalidUrl'));
          return;
        }
        if (
          parsedInstanceUrl.protocol !== 'https:' &&
          parsedInstanceUrl.protocol !== 'http:'
        ) {
          setTokenError(t('connectHost.error.invalidUrl'));
          return;
        }
        if (parsedInstanceUrl.protocol === 'http:') {
          const shouldContinue = await new Promise<boolean>((resolve) => {
            Alert.alert(
              t('provider.insecureUrlTitle'),
              t('provider.insecureUrlBody'),
              [
                {
                  text: t('common.cancel'),
                  style: 'cancel',
                  onPress: () => resolve(false),
                },
                { text: t('common.continue'), onPress: () => resolve(true) },
              ],
            );
          });
          if (!shouldContinue) return;
        }
      }
      // Skip token validation if token is empty
      if (!token.trim()) {
        setCurrentStep(INFO_STEP_START);
        return;
      }
      setIsVerifying(true);
      setTokenError(null);
      const result = await connectHost({
        provider: selectedProvider,
        token: token.trim(),
        instanceBaseUrl:
          selectedProvider === 'github'
            ? null
            : normalizedInstanceUrl || null,
      });
      if (result.ok) {
        await refreshAccounts();
        setIsVerifying(false);
        setCurrentStep(INFO_STEP_START);
      } else {
        setIsVerifying(false);
        setTokenError(result.error ?? 'Invalid token. Please check and try again.');
      }
    } else if (currentStep === AI_STEP) {
      await finish();
    } else {
      // Info steps (step 2+): advance to next info step or AI
      setCurrentStep(currentStep + 1);
    }
  }, [
    currentStep,
    selectedProvider,
    instanceUrl,
    token,
    connectHost,
    refreshAccounts,
    finish,
    AI_STEP,
    TOKEN_STEP,
    INFO_STEP_START,
    t,
  ]);

  const handleSkip = useCallback(async () => {
    await OnboardingService.completeOnboarding();
    onSkip();
  }, [onSkip]);

  /**
   * Initiate GitHub OAuth flow.
   * Follows the same pattern as SettingsScreen.handleConnectOAuth.
   */
  const handleInitiateOAuth = useCallback(async () => {
    setIsGithubAuthLoading(true);
    setGithubAuthError(null);
    try {
      const backendUrl = resolveBackendUrl();
      const clientId = process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID;
      if (!clientId) {
        setGithubAuthError('OAuth not configured on this device');
        return;
      }
      const redirectUri = OAUTH_CALLBACK_URL;
      const result = await GitHubOAuthService.initiate({
        backendUrl,
        redirectUri,
        clientId,
        hostId: null,
        returnTo: 'onboarding',
      });
      if (!result.ok) {
        setGithubAuthError(
          result.reason === 'backend_unreachable'
            ? t('onboarding.simple.serverUnavailable')
            : t('onboarding.simple.couldNotStartSignIn'),
        );
        return;
      }
      const browserResult = await GitHubOAuthService.openAuthorizationUrl(
        result.authorizationUrl,
        redirectUri,
      );
      if (browserResult.outcome === 'failed') {
        setGithubAuthError(t('onboarding.simple.couldNotOpenBrowser'));
        return;
      }
      if (browserResult.outcome === 'cancelled') {
        setGithubAuthError(t('onboarding.simple.signInCancelledSimple'));
        return;
      }
      if (browserResult.outcome === 'callback') {
        const callback = new URL(browserResult.url);
        navigation.navigate('OAuthCallback', {
          code: callback.searchParams.get('code') ?? undefined,
          state: callback.searchParams.get('state') ?? undefined,
          error: callback.searchParams.get('error') ?? undefined,
          error_description:
            callback.searchParams.get('error_description') ?? undefined,
        });
      }
    } catch (err) {
      setGithubAuthError(
        err instanceof Error ? err.message : t('onboarding.simple.signInFailed'),
      );
    } finally {
      setIsGithubAuthLoading(false);
    }
  }, [navigation, t]);

  /**
   * Initiate GitHub App installation flow.
   * Follows the same pattern as SettingsScreen.handleConnectGitHubApp.
   */
  const handleInitiateGitHubApp = useCallback(async () => {
    setIsGithubAuthLoading(true);
    setGithubAuthError(null);
    try {
      const backendUrl = resolveBackendUrl();
      const result = await GitHubAppService.buildInstallUrl({
        backendUrl,
        hostId: null,
        selectedRepositoryIds: [],
      });
      if (!result.ok) {
        setGithubAuthError(
          result.reason === 'backend_unreachable'
            ? t('onboarding.simple.serverUnavailable')
            : result.reason === 'not_configured'
              ? t('onboarding.simple.oauthNotConfigured')
              : t('onboarding.simple.couldNotStartSignIn'),
        );
        return;
      }
      const browserResult = await GitHubAppService.openInstallationUrl(
        result.installationUrl,
      );
      if (browserResult.outcome === 'failed') {
        setGithubAuthError(t('onboarding.simple.couldNotOpenBrowser'));
        return;
      }
      if (browserResult.outcome === 'callback') {
        const callback = GitHubAppService.parseCallbackUrl(browserResult.url);
        if (callback && typeof callback === 'object') {
          navigation.navigate('AppCallback', {
            installation_id: callback.installationId,
            state: callback.state,
          });
        } else {
          navigation.navigate('AppCallback');
        }
      }
    } catch (err) {
      setGithubAuthError(
        err instanceof Error ? err.message : t('onboarding.simple.signInFailed'),
      );
    } finally {
      setIsGithubAuthLoading(false);
    }
  }, [navigation, t]);

  const isTokenStep = currentStep === TOKEN_STEP;
  const isAIStep = currentStep === AI_STEP;

  const showInstanceUrl = selectedProvider !== 'github';
  const isGitHub = selectedProvider === 'github';

  const getTokenSettingsUrl = (): string | null => {
    if (selectedProvider === 'github') {
      return 'https://github.com/settings/personal-access-tokens/new?description=GitNotes';
    }
    if (selectedProvider === 'gitlab') {
      return 'https://gitlab.com/-/profile/personal_access_tokens';
    }
    return null;
  };

  const tokenSettingsUrl = getTokenSettingsUrl();

  const renderGitHubAuthMethodSelector = () => (
    <View className="w-full gap-4" style={{ paddingBottom: 20, paddingTop: 8 }}>
      <View className="flex-row gap-2" style={{ alignSelf: 'center' }}>
        <TouchableOpacity
          testID="onboarding.github-auth.pat"
          className="flex-1 items-center px-3 py-2.5 rounded-lg border"
          style={{
            borderColor:
              githubAuthMethod === 'pat' ? colors.accent : colors.border,
            backgroundColor:
              githubAuthMethod === 'pat'
                ? `${colors.accent}15`
                : 'transparent',
          }}
          onPress={() => {
            setGithubAuthMethod('pat');
            setGithubAuthError(null);
          }}
          disabled={isGithubAuthLoading}
        >
          <Ionicons
            name="key-outline"
            size={18}
            color={
              githubAuthMethod === 'pat' ? colors.accent : colors.textSecondary
            }
          />
          <Text
            className="text-xs font-medium mt-1.5"
            style={{
              color:
                githubAuthMethod === 'pat'
                  ? colors.accent
                  : colors.textSecondary,
            }}
          >
            PAT
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="onboarding.github-auth.oauth"
          className="flex-1 items-center px-3 py-2.5 rounded-lg border"
          style={{
            borderColor:
              githubAuthMethod === 'oauth' ? colors.accent : colors.border,
            backgroundColor:
              githubAuthMethod === 'oauth'
                ? `${colors.accent}15`
                : 'transparent',
          }}
          onPress={() => {
            setGithubAuthMethod('oauth');
            setGithubAuthError(null);
          }}
          disabled={isGithubAuthLoading}
        >
          <Ionicons
            name="logo-github"
            size={18}
            color={
              githubAuthMethod === 'oauth'
                ? colors.accent
                : colors.textSecondary
            }
          />
          <Text
            className="text-xs font-medium mt-1.5"
            style={{
              color:
                githubAuthMethod === 'oauth'
                  ? colors.accent
                  : colors.textSecondary,
            }}
          >
            OAuth
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="onboarding.github-auth.app"
          className="flex-1 items-center px-3 py-2.5 rounded-lg border"
          style={{
            borderColor:
              githubAuthMethod === 'app' ? colors.accent : colors.border,
            backgroundColor:
              githubAuthMethod === 'app'
                ? `${colors.accent}15`
                : 'transparent',
          }}
          onPress={() => {
            setGithubAuthMethod('app');
            setGithubAuthError(null);
          }}
          disabled={isGithubAuthLoading}
        >
          <Ionicons
            name="apps-outline"
            size={18}
            color={
              githubAuthMethod === 'app' ? colors.accent : colors.textSecondary
            }
          />
          <Text
            className="text-xs font-medium mt-1.5"
            style={{
              color:
                githubAuthMethod === 'app'
                  ? colors.accent
                  : colors.textSecondary,
            }}
          >
            GitHub App
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="onboarding.github-auth.quick"
          className="flex-1 items-center px-3 py-2.5 rounded-lg border"
          style={{
            borderColor:
              githubAuthMethod === 'quick' ? colors.accent : colors.border,
            backgroundColor:
              githubAuthMethod === 'quick'
                ? `${colors.accent}15`
                : 'transparent',
          }}
          onPress={() => {
            setGithubAuthMethod('quick');
            setGithubAuthError(null);
          }}
          disabled={isGithubAuthLoading}
        >
          <Ionicons
            name="rocket-outline"
            size={18}
            color={
              githubAuthMethod === 'quick' ? colors.accent : colors.textSecondary
            }
          />
          <Text
            className="text-xs font-medium mt-1.5"
            style={{
              color:
                githubAuthMethod === 'quick'
                  ? colors.accent
                  : colors.textSecondary,
            }}
          >
            {t('settings.quickSetup')}
          </Text>
        </TouchableOpacity>
      </View>

      {githubAuthMethod === 'pat' && (
        <>
          <Input
            testID="onboarding.input.token"
            placeholder={t('onboarding.tokenPlaceholder', {
              defaultValue: 'ghpat_xxxxxxxxxxxxxxxxxxxx',
            })}
            value={token}
            onChangeText={(t_) => {
              setToken(t_);
              setTokenError(null);
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            showSoftInputOnFocus={false}
            containerStyle={{ width: '100%' }}
          />

          {tokenSettingsUrl && (
            <Button
              variant="ghost"
              testID="onboarding.button.open-link"
              onPress={() => Linking.openURL(tokenSettingsUrl)}
              leadingIcon={
                <Ionicons
                  name="open-outline"
                  size={14}
                  color={colors.accent}
                />
              }
              label={t('onboarding.tokenOpenLink', {
                defaultValue: 'Open token settings',
              })}
              textStyle={{ color: colors.text, fontSize: 14, fontWeight: '500' }}
              style={{ marginBottom: 16 }}
            />
          )}

          <View style={{ alignItems: 'center' }}>
            <TouchableOpacity
              testID="onboarding.button.paste-token"
              className="flex-row items-center gap-2 py-3 px-4"
              onPress={async () => {
                const text = await Clipboard.getStringAsync();
                if (text) {
                  setToken(text);
                  setTokenError(null);
                }
              }}
            >
              <Ionicons
                name="clipboard-outline"
                size={16}
                color={colors.accent}
              />
              <Text
                className="text-sm font-medium"
                style={{ color: colors.accent }}
              >
                {t('onboarding.tokenPaste', {
                  defaultValue: 'Paste from Clipboard',
                })}
              </Text>
            </TouchableOpacity>
          </View>
          {tokenError ? (
            <Text className="text-[13px] text-center mt-2" style={{ color: '#FF3B30' }}>
              {tokenError}
            </Text>
          ) : null}
        </>
      )}

      {githubAuthMethod === 'oauth' && (
        <View className="items-center gap-3" style={{ paddingTop: 8 }}>
          <Button
            variant="primary"
            fullWidth
            testID="onboarding.button.oauth"
            disabled={isGithubAuthLoading}
            onPress={handleInitiateOAuth}
            label={
              isGithubAuthLoading
                ? 'Connecting...'
                : 'Sign in with GitHub'
            }
            leadingIcon={
              isGithubAuthLoading ? (
                <ActivityIndicator color={colors.accent} size={18} />
              ) : (
                <Ionicons name="logo-github" size={18} color={colors.accent} />
              )
            }
          />
          <Text
            className="text-xs text-center"
            style={{ color: colors.textSecondary }}
          >
            Opens GitHub in your browser. No token needed.
          </Text>
        </View>
      )}

      {githubAuthMethod === 'app' && (
        <View className="items-center gap-3" style={{ paddingTop: 8 }}>
          <Button
            variant="primary"
            fullWidth
            testID="onboarding.button.app"
            disabled={isGithubAuthLoading}
            onPress={handleInitiateGitHubApp}
            label={
              isGithubAuthLoading
                ? 'Connecting...'
                : 'Install GitHub App'
            }
            leadingIcon={
              isGithubAuthLoading ? (
                <ActivityIndicator color={colors.accent} size={18} />
              ) : (
                <Ionicons name="apps-outline" size={18} color={colors.accent} />
              )
            }
          />
          <Text
            className="text-xs text-center"
            style={{ color: colors.textSecondary }}
          >
            Install the GitNotēs GitHub App for repository access.
          </Text>
        </View>
      )}

      {githubAuthError ? (
        <Text
          className="text-[13px] text-center"
          style={{ color: '#FF3B30' }}
        >
          {githubAuthError}
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row justify-end px-5 pt-2.5">
            <Button
              variant="ghost"
              label="Skip"
              testID="onboarding.button.skip"
              onPress={handleSkip}
            />
          </View>

          {currentStep === HOST_STEP ? (
            <View className="flex-1 px-10 items-center">
              <Surface
                elevation="raised"
                radius="pill"
                className="w-[140px] h-[140px] items-center justify-center mb-6"
              >
                <Ionicons
                  name={INFO_STEP_ICONS[0]}
                  size={72}
                  color={colors.accent}
                />
              </Surface>
              <Text
                className="text-[28px] font-bold text-center"
                style={{ color: colors.text }}
              >
                {t('onboarding.steps.welcomeTitle')}
              </Text>
              <Text
                className="text-base text-center leading-6"
                style={{ color: colors.textSecondary }}
              >
                {t('onboarding.steps.welcomeDescription')}
              </Text>

              <View className="mt-8 gap-3" style={{ width: '100%', maxWidth: 300 }}>
                <Button
                  variant="primary"
                  fullWidth
                  testID="onboarding.button.connect-github"
                  onPress={handleInitiateOAuth}
                  disabled={isGithubAuthLoading}
                  label={
                    isGithubAuthLoading
                      ? t('common.connecting', { defaultValue: 'Connecting...' })
                      : t('onboarding.steps.connectGitHub', { defaultValue: 'Connect to GitHub' })
                  }
                  leadingIcon={
                    isGithubAuthLoading ? (
                      <ActivityIndicator color={colors.accent} size={18} />
                    ) : (
                      <Ionicons name="logo-github" size={20} color={colors.accent} />
                    )
                  }
                />
                {githubAuthError ? (
                  <Text className="text-[13px] text-center" style={{ color: '#FF3B30' }}>
                    {githubAuthError}
                  </Text>
                ) : null}
                <Button
                  variant="outline"
                  fullWidth
                  testID="onboarding.button.custom-setup"
                  onPress={() => setCurrentStep(TOKEN_STEP)}
                  label={t('onboarding.steps.customSetup', { defaultValue: 'Custom Setup' })}
                />
              </View>
            </View>
          ) : isTokenStep ? (
            <View
              className="flex-1 px-10"
              style={{ justifyContent: 'center' }}
            >
              <Surface
                elevation="raised"
                radius="pill"
                className="w-[140px] h-[140px] items-center justify-center mb-6 self-center"
              >
                <Ionicons
                  name="git-network-outline"
                  size={72}
                  color={colors.accent}
                />
              </Surface>

              <Text
                className="text-[28px] font-bold text-center"
                style={{ color: colors.text }}
              >
                {t('onboarding.tokenTitle', {
                  defaultValue: 'Connect a Git Host',
                })}
              </Text>
              <Text
                className="text-base text-center leading-6"
                style={{ color: colors.textSecondary }}
              >
                {t('onboarding.tokenDescription', {
                  defaultValue:
                    'Select your provider and enter a Personal Access Token with read/write repository access. You can skip this and add it later in Settings.',
                })}
              </Text>

              <View className="w-full gap-2 mt-6" style={{ paddingBottom: 20 }}>
                <Text
                  className="text-sm font-medium mb-1"
                  style={{ color: colors.textSecondary }}
                >
                  {t('onboarding.provider.label', { defaultValue: 'Provider' })}
                </Text>
                <ProviderSelector
                  value={selectedProvider}
                  onChange={(provider) => {
                    if (provider === 'all') return;
                    setSelectedProvider(provider);
                    setInstanceUrl(GIT_HOST_API_BASES[provider]);
                    setGithubAuthMethod('pat');
                    setTokenError(null);
                    setGithubAuthError(null);
                  }}
                />
              </View>

              {showInstanceUrl && (
                <Input
                  testID="onboarding.input.instance-url"
                  placeholder={GIT_HOST_API_BASES[selectedProvider]}
                  value={instanceUrl}
                  onChangeText={(t_) => {
                    setInstanceUrl(t_);
                    setTokenError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  containerStyle={{ width: '100%', marginBottom: 12 }}
                />
              )}

              {isGitHub ? (
                renderGitHubAuthMethodSelector()
              ) : (
                <>
                  <Input
                    testID="onboarding.input.token"
                    placeholder={t('onboarding.tokenPlaceholder', {
                      defaultValue: 'glpat_xxxxxxxxxxxxxxxxxxxx',
                    })}
                    value={token}
                    onChangeText={(t_) => {
                      setToken(t_);
                      setTokenError(null);
                    }}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    showSoftInputOnFocus={false}
                    containerStyle={{ width: '100%' }}
                  />

                  {tokenSettingsUrl && (
                    <Button
                      variant="ghost"
                      testID="onboarding.button.open-link"
                      onPress={() => Linking.openURL(tokenSettingsUrl)}
                      leadingIcon={
                        <Ionicons
                          name="open-outline"
                          size={14}
                          color={colors.accent}
                        />
                      }
                      label={t('onboarding.tokenOpenLink', {
                        defaultValue: 'Open token settings',
                      })}
                      textStyle={{
                        color: colors.text,
                        fontSize: 14,
                        fontWeight: '500',
                      }}
                      style={{ marginBottom: 16 }}
                    />
                  )}

                  <View style={{ alignItems: 'center' }}>
                    <TouchableOpacity
                      testID="onboarding.button.paste-token"
                      className="flex-row items-center gap-2 py-3 px-4"
                      onPress={async () => {
                        const text = await Clipboard.getStringAsync();
                        if (text) {
                          setToken(text);
                          setTokenError(null);
                        }
                      }}
                    >
                      <Ionicons
                        name="clipboard-outline"
                        size={16}
                        color={colors.accent}
                      />
                      <Text
                        className="text-sm font-medium"
                        style={{ color: colors.accent }}
                      >
                        {t('onboarding.tokenPaste', {
                          defaultValue: 'Paste from Clipboard',
                        })}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {tokenError ? (
                    <Text
                      className="text-[13px] text-center mt-2"
                      style={{ color: '#FF3B30' }}
                    >
                      {tokenError}
                    </Text>
                  ) : null}
                </>
              )}

            </View>
          ) : isAIStep ? (
            <View className="flex-1 px-10 items-center">
              <Surface
                elevation="raised"
                radius="pill"
                className="w-[140px] h-[140px] items-center justify-center mb-6"
              >
                <Ionicons
                  name="sparkles-outline"
                  size={72}
                  color={colors.accent}
                />
              </Surface>
              <Text
                className="text-[28px] font-bold text-center"
                style={{ color: colors.text }}
              >
                {t('onboarding.pro.title', { defaultValue: 'GitNotēs Pro' })}
              </Text>
              <Text
                className="text-base text-center leading-6"
                style={{ color: colors.textSecondary }}
              >
                {t('onboarding.pro.body', {
                  defaultValue:
                    'The free plan includes 1 account and 1 repo. GitNotēs Pro unlocks AI chat, thought & voice dump, personalized quotes, canvases, templates, more repos and accounts.',
                })}
              </Text>
              <Text
                className="text-[13px] text-center leading-[18px] mt-2 opacity-80"
                style={{ color: colors.textSecondary }}
              >
                {t('onboarding.pro.reminder', {
                  defaultValue:
                    'You can upgrade anytime in Settings → GitNotēs Pro.',
                })}
              </Text>
              <TouchableOpacity
                testID="onboarding.button.configure-api-key"
                onPress={() =>
                  navigation.navigate('MainTabs', { screen: 'SettingsTab' })
                }
                className="mt-4"
              >
                <Text
                  className="text-[13px] font-medium"
                  style={{ color: colors.accent }}
                >
                  Settings
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="flex-1 px-10 items-center">
              <Surface
                elevation="raised"
                radius="pill"
                className="w-[140px] h-[140px] items-center justify-center mb-6"
              >
                <Ionicons
                  name={INFO_STEPS[currentStep - INFO_STEP_START].icon}
                  size={72}
                  color={colors.accent}
                />
              </Surface>
              <Text
                className="text-[28px] font-bold text-center"
                style={{ color: colors.text }}
              >
                {INFO_STEPS[currentStep - INFO_STEP_START].title}
              </Text>
              <Text
                className="text-base text-center leading-6"
                style={{ color: colors.textSecondary }}
              >
                {INFO_STEPS[currentStep - INFO_STEP_START].description}
              </Text>
            </View>
          )}

          <View className="px-5 pb-10">
            <View className="flex-row justify-center mb-6">
              {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
                <Surface
                  key={index}
                  elevation="subtle"
                  radius="pill"
                  inset={index === currentStep}
                  style={{
                    width: 14,
                    height: 14,
                    marginHorizontal: 4,
                    backgroundColor:
                      index === currentStep ? colors.accent : colors.surface,
                  }}
                >
                  <View />
                </Surface>
              ))}
            </View>

            {isAIStep ? (
              <Button
                variant="primary"
                fullWidth
                testID="onboarding.button.pro-continue"
                onPress={handleNext}
                label={t('common.continue', { defaultValue: 'Continue' })}
                trailingIcon={
                  <Ionicons name="checkmark" size={20} color={colors.accent} />
                }
                iconAlign="edge"
              />
            ) : isGitHub && githubAuthMethod !== 'pat' ? (
              // OAuth / App selected — Next skips token step; auth runs in background
              <Button
                variant="primary"
                fullWidth
                testID="onboarding.button.next"
                onPress={handleNext}
                disabled={isGithubAuthLoading}
                label={
                  isGithubAuthLoading
                    ? t('common.connecting', { defaultValue: 'Connecting...' })
                    : t('onboarding.skipForNow', {
                        defaultValue: 'Skip for Now',
                      })
                }
                trailingIcon={
                  isGithubAuthLoading ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Ionicons
                      name="arrow-forward"
                      size={20}
                      color={colors.accent}
                    />
                  )
                }
                iconAlign="edge"
              />
              ) : (
                <Button
                  variant="primary"
                  fullWidth
                  testID="onboarding.button.next"
                  onPress={handleNext}
                  disabled={isVerifying}
                  label={
                    isVerifying
                      ? t('common.connecting', { defaultValue: 'Connecting...' })
                      : isTokenStep
                        ? token.trim()
                          ? t('onboarding.tokenConnect', {
                              defaultValue: 'Connect',
                            })
                          : t('onboarding.skipForNow', {
                              defaultValue: 'Skip for Now',
                            })
                        : currentStep === HOST_STEP
                          ? t('onboarding.steps.nextCustomSetup', {
                              defaultValue: 'Next: Custom Setup',
                            })
                          : t('common.next', { defaultValue: 'Next' })
                  }
                  trailingIcon={
                    isVerifying ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : (
                      <Ionicons
                        name="arrow-forward"
                        size={20}
                        color={colors.accent}
                      />
                    )
                  }
                  iconAlign="edge"
                />
              )}

              <Text className="text-center text-xs mt-6" style={{ color: colors.textSecondary }}>
                Found a bug or have a feature request?{' '}
                <Text
                  testID="onboarding.button.report-issue"
                  style={{ color: colors.accent, fontWeight: '600' }}
                  onPress={() =>
                    Linking.openURL(
                      'https://github.com/skepjandi/gitnotes/issues',
                    )
                  }
                >
                  Report it on GitHub Issues
                </Text>
              </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
