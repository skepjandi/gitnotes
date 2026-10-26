import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { useAccounts } from '../contexts/AccountsContext';
import { GitHubOAuthService, pendingOAuthFlows } from '../services/GitHubOAuthService';
import { GitHubService, type GitHubCreatedRepository } from '../services/GitHubService';
import { useNoteStore } from '../stores/noteStore';
import { useRepoStore } from '../stores/repoStore';
import { Button, Input, Surface } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import type { RootStackParamList } from '../navigation/types';
import { OAUTH_CALLBACK_URL, WORKER_BASE_URL } from '../types/worker';

type QuickSetupStep = 'select' | 'oauth' | 'repo-name' | 'creating' | 'cloning' | 'seeding' | 'done' | 'error';

type QuickSetupRouteProp = RouteProp<RootStackParamList, 'QuickSetup'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

function resolveBackendUrl(): string {
  const configured = process.env.EXPO_PUBLIC_GITNOTES_WORKER_BASE_URL?.trim();
  const base = configured || WORKER_BASE_URL;
  return base.replace(/\/api\/v1\/?$/, '');
}

interface QuickSetupScreenProps {
  onComplete: () => void;
}

export default function QuickSetupScreen({ onComplete }: QuickSetupScreenProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<QuickSetupRouteProp>();
  const { refreshAccounts } = useAccounts();

  const [step, setStep] = useState<QuickSetupStep>('select');
  const [repoName, setRepoName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [createdRepo, setCreatedRepo] = useState<{
    full_name: string;
    name: string;
    default_branch: string;
    hostId: string | undefined;
  } | null>(null);

  // Track OAuth state consumption to prevent stale callbacks
  const consumedStates = useRef(new Set<string>());

  // Handle OAuth callback return via route params
  const handleOAuthReturn = useCallback((oauthState: string | null) => {
    if (!oauthState) return;
    if (consumedStates.current.has(oauthState)) return;
    const pending = pendingOAuthFlows.get(oauthState);
    if (!pending) return;

    consumedStates.current.add(oauthState);
    if (pending.oauthResult?.outcome === 'success') {
      const login = pending.githubLogin ?? '';
      setRepoName(login ? `gitnotes-${login}` : 'gitnotes');
      setStep('repo-name');
    } else if (pending.oauthResult) {
      const res = pending.oauthResult;
        if (res.outcome === 'denied' || res.outcome === 'cancelled') {
          setError(t('onboarding.simple.signInCancelled'));
          setStep('oauth');
        } else if (res.outcome === 'free_tier_limit_reached') {
          setError(t('onboarding.simple.accountLimitReached'));
          setStep('oauth');
      } else {
        setError(t('onboarding.simple.signInFailed'));
        setStep('oauth');
      }
      pendingOAuthFlows.delete(oauthState);
    }
  }, [t]);

  const oauthState = route.params?.oauthState ?? null;
  useEffect(() => {
    if (oauthState && step !== 'error' && step !== 'done') {
      handleOAuthReturn(oauthState);
    }
  }, [handleOAuthReturn, oauthState, step]);

  const handleInitiateOAuth = useCallback(async () => {
    setStep('oauth');
    setIsLoading(true);
    setError(null);
    try {
      const backendUrl = resolveBackendUrl();
      const clientId = process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID;
      if (!clientId) {
        setError(t('onboarding.simple.oauthNotConfigured'));
        setIsLoading(false);
        return;
      }
      const redirectUri = OAUTH_CALLBACK_URL;
      const result = await GitHubOAuthService.initiate({
        backendUrl,
        redirectUri,
        clientId,
        hostId: null,
        returnTo: 'quick-setup',
      });
      if (!result.ok) {
        setError(
          result.reason === 'backend_unreachable'
            ? t('onboarding.simple.serverUnavailable')
            : t('onboarding.simple.couldNotStartSignIn'),
        );
        setIsLoading(false);
        return;
      }
      const browserResult = await GitHubOAuthService.openAuthorizationUrl(
        result.authorizationUrl,
        redirectUri,
      );
      if (browserResult.outcome === 'failed') {
        setError(t('onboarding.simple.couldNotOpenBrowser'));
        setIsLoading(false);
        return;
      }
      if (browserResult.outcome === 'cancelled') {
        setError(t('onboarding.simple.signInCancelledSimple'));
        setIsLoading(false);
        return;
      }
      if (browserResult.outcome === 'callback') {
        const callback = new URL(browserResult.url);
        const callbackState = callback.searchParams.get('state') ?? undefined;
        const pending = callbackState ? pendingOAuthFlows.get(callbackState) : undefined;
        if (pending?.oauthResult?.outcome === 'success') {
          const login = pending.githubLogin ?? '';
          setRepoName(login ? `gitnotes-${login}` : 'gitnotes');
          setStep('repo-name');
        } else {
          navigation.navigate('OAuthCallback', {
            code: callback.searchParams.get('code') ?? undefined,
            state: callbackState,
            error: callback.searchParams.get('error') ?? undefined,
            error_description: callback.searchParams.get('error_description') ?? undefined,
          });
          // The OAuthCallback will navigate back here with oauthState
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.simple.signInFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [navigation, t]);

  const handleCreateRepoAndClone = useCallback(async () => {
    const name = repoName.trim();
    if (!name) {
      setError(t('onboarding.simple.enterRepoName'));
      return;
    }

    let repoData = createdRepo
      ? { full_name: createdRepo.full_name, name: createdRepo.name, default_branch: createdRepo.default_branch, hostId: createdRepo.hostId }
      : null;

    if (!repoData) {
      setStep('creating');
      setError(null);

      // Find the pending OAuth flow with a successful result
      const pending = Array.from(pendingOAuthFlows.values()).find(
        (p) => p.returnTo === 'quick-setup' && p.oauthResult?.outcome === 'success',
      );
      const oauthResult = pending?.oauthResult;
      if (oauthResult?.outcome !== 'success') {
        setError(t('onboarding.simple.notAuthenticated'));
        setStep('oauth');
        return;
      }
      const credential = oauthResult.credential;
      const hostId = credential.hostId;

      let created: GitHubCreatedRepository;
      try {
        created = await GitHubService.createRepository({ name });
      } catch (err: unknown) {
        const httpError = err as { status?: number };
        if (httpError.status === 422) {
          setError(t('onboarding.simple.repoAlreadyExists', { name }));
          setStep('repo-name');
          return;
        }
        if (httpError.status === 401 || httpError.status === 403) {
          setError(t('onboarding.simple.permissionDenied'));
          setStep('oauth');
          return;
        }
        setError(t('onboarding.simple.couldNotCreateRepo'));
        setStep('repo-name');
        return;
      }

      repoData = { full_name: created.full_name, name: created.name, default_branch: created.default_branch, hostId };
      setCreatedRepo(repoData);
    }

    if (!repoData) {
      return;
    }

    const { full_name: repoPath, name: repoNameVal, hostId: repoHostId } = repoData;

    setStep('cloning');
    let repoAdded = false;
    try {
      const result = await useRepoStore.getState().addRepository(
        repoPath,
        repoNameVal,
        'github',
        { allowUnverifiedWrite: true },
        repoHostId,
      );
      repoAdded = !!result;
    } catch (err: unknown) {
      const httpError = err as { message?: string };
      if (httpError?.message?.includes('already exists')) {
        const existing = useRepoStore.getState().repositories.find((r) => r.path === repoPath);
        if (!existing) {
          setError(t('onboarding.simple.couldNotCloneRepo'));
          setStep('error');
          return;
        }
        repoAdded = true;
      } else {
        setError(t('onboarding.simple.couldNotCloneRepo'));
        setStep('error');
        return;
      }
    }
    if (!repoAdded) {
      const existing = useRepoStore.getState().repositories.find((r) => r.path === repoPath);
      if (existing) {
        repoAdded = true;
      } else {
        setError(t('onboarding.simple.couldNotCloneRepo'));
        setStep('error');
        return;
      }
    }

    setStep('seeding');
    const noteStore = useNoteStore.getState();
    const existingNote = noteStore.notes.find((n) => n.title === 'Welcome to GitNotēs' && n.repo === repoPath);
    if (!existingNote) {
      const welcomeContent = [
        '# Welcome to GitNotēs',
        '',
        "You've successfully set up your notes repository!",
        '',
        '## Getting Started',
        '',
        '- Create new notes using the + button',
        '- Organize with folders and tags',
        '- Your notes sync automatically to GitHub',
        '',
        '## Tips',
        '',
        '- Use # for headings',
        '- Create checklists with - [ ]',
        '- Link notes with [[wiki-links]]',
        '',
        'Happy writing!',
      ].join('\n');
      const createdNote = await noteStore.createNote({
        title: 'Welcome to GitNotēs',
        content: welcomeContent,
        format: 'markdown',
        repo: repoPath,
        branch: repoData.default_branch,
        folderPath: 'notes',
        filePath: 'notes/welcome-to-gitnotes.md',
      });
      if (!createdNote) {
        setError(t('onboarding.simple.couldNotSeedNote'));
        setStep('error');
        return;
      }
    }
    setStep('done');
    // Clean up any pending OAuth flow
    for (const [key, pending] of pendingOAuthFlows.entries()) {
      if (pending.returnTo === 'quick-setup') {
        pendingOAuthFlows.delete(key);
        consumedStates.current.delete(key);
      }
    }
    await refreshAccounts();
  }, [repoName, createdRepo, refreshAccounts, t]);

  const handleFinish = useCallback(async () => {
    onComplete();
  }, [onComplete]);

  const handleBackToSelect = useCallback(() => {
    setStep('select');
    setError(null);
    setCreatedRepo(null);
  }, []);

  const renderStep = () => {
    switch (step) {
      case 'select':
        return (
          <>
            <Surface
              elevation="raised"
              radius="pill"
              className="w-[140px] h-[140px] items-center justify-center mb-6 self-center"
            >
              <Ionicons name="rocket-outline" size={72} color={colors.accent} />
            </Surface>
            <Text className="text-[28px] font-bold text-center" style={{ color: colors.text }}>
              {t('onboarding.simple.select.title')}
            </Text>
            <Text className="text-base text-center leading-6 mt-3" style={{ color: colors.textSecondary }}>
              {t('onboarding.simple.select.description')}
            </Text>
            <View className="mt-8 gap-3">
              <Button
                variant="primary"
                fullWidth
                testID="quick-setup.button.sign-in"
                onPress={handleInitiateOAuth}
                label={t('onboarding.simple.select.signInButton')}
                leadingIcon={<Ionicons name="logo-github" size={20} color={colors.accent} />}
              />
            </View>
            {error ? (
              <Text className="text-[13px] text-center mt-4" style={{ color: '#FF3B30' }}>
                {error}
              </Text>
            ) : null}
          </>
        );

      case 'oauth':
        return (
          <>
            <Surface
              elevation="raised"
              radius="pill"
              className="w-[140px] h-[140px] items-center justify-center mb-6 self-center"
            >
              <Ionicons name="logo-github" size={72} color={colors.accent} />
            </Surface>
            <Text className="text-[28px] font-bold text-center" style={{ color: colors.text }}>
              {t('onboarding.simple.oauth.title')}
            </Text>
            <Text className="text-base text-center leading-6 mt-3" style={{ color: colors.textSecondary }}>
              {isLoading ? t('onboarding.simple.oauth.openingGitHub') : error ?? t('onboarding.simple.oauth.pleaseSignIn')}
            </Text>
            {isLoading ? (
              <ActivityIndicator size="large" color={colors.accent} className="mt-6 self-center" />
            ) : (
              <View className="mt-6 gap-3">
                <Button
                  variant="primary"
                  fullWidth
                  testID="quick-setup.button.retry-oauth"
                  onPress={handleInitiateOAuth}
                  label={t('onboarding.simple.oauth.tryAgainButton')}
                />
                <Button
                  variant="ghost"
                  fullWidth
                  testID="quick-setup.button.back"
                  onPress={handleBackToSelect}
                  label={t('onboarding.simple.oauth.backButton')}
                />
              </View>
            )}
          </>
        );

      case 'repo-name':
        return (
          <>
            <Surface
              elevation="raised"
              radius="pill"
              className="w-[140px] h-[140px] items-center justify-center mb-6 self-center"
            >
              <Ionicons name="folder-outline" size={72} color={colors.accent} />
            </Surface>
            <Text className="text-[28px] font-bold text-center" style={{ color: colors.text }}>
              {t('onboarding.simple.repoName.title')}
            </Text>
            <Text className="text-base text-center leading-6 mt-3" style={{ color: colors.textSecondary }}>
              {t('onboarding.simple.repoName.description')}
            </Text>
            <Input
              testID="quick-setup.input.repo-name"
              placeholder={t('onboarding.simple.repoName.placeholder')}
              value={repoName}
              onChangeText={(t) => {
                setRepoName(t);
                setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              containerStyle={{ width: '100%', marginTop: 20 }}
            />
            {error ? (
              <Text className="text-[13px] text-center mt-3" style={{ color: '#FF3B30' }}>
                {error}
              </Text>
            ) : null}
            <Button
              variant="primary"
              fullWidth
              testID="quick-setup.button.create"
              onPress={handleCreateRepoAndClone}
              label={t('onboarding.simple.repoName.createButton')}
              className="mt-4"
              disabled={!repoName.trim()}
            />
          </>
        );

      case 'creating':
        return (
          <>
            <ActivityIndicator size="large" color={colors.accent} className="self-center mb-6" />
            <Text className="text-xl font-bold text-center" style={{ color: colors.text }}>
              {t('onboarding.simple.progress.creatingTitle')}
            </Text>
            <Text className="text-base text-center leading-6 mt-3" style={{ color: colors.textSecondary }}>
              {t('onboarding.simple.progress.creatingBody')}
            </Text>
          </>
        );

      case 'cloning':
        return (
          <>
            <ActivityIndicator size="large" color={colors.accent} className="self-center mb-6" />
            <Text className="text-xl font-bold text-center" style={{ color: colors.text }}>
              {t('onboarding.simple.progress.cloningTitle')}
            </Text>
            <Text className="text-base text-center leading-6 mt-3" style={{ color: colors.textSecondary }}>
              {t('onboarding.simple.progress.cloningBody')}
            </Text>
          </>
        );

      case 'seeding':
        return (
          <>
            <ActivityIndicator size="large" color={colors.accent} className="self-center mb-6" />
            <Text className="text-xl font-bold text-center" style={{ color: colors.text }}>
              {t('onboarding.simple.progress.seedingTitle')}
            </Text>
            <Text className="text-base text-center leading-6 mt-3" style={{ color: colors.textSecondary }}>
              {t('onboarding.simple.progress.seedingBody')}
            </Text>
          </>
        );

      case 'done':
        return (
          <>
            <Surface
              elevation="raised"
              radius="pill"
              className="w-[140px] h-[140px] items-center justify-center mb-6 self-center"
            >
              <Ionicons name="checkmark-circle" size={72} color={colors.accent} />
            </Surface>
            <Text className="text-[28px] font-bold text-center" style={{ color: colors.text }}>
              {t('onboarding.simple.done.title')}
            </Text>
            <Text className="text-base text-center leading-6 mt-3" style={{ color: colors.textSecondary }}>
              {t('onboarding.simple.done.description')}
            </Text>
            <Button
              variant="primary"
              fullWidth
              testID="quick-setup.button.done"
              onPress={handleFinish}
              label={t('onboarding.simple.done.getStartedButton')}
              className="mt-6"
            />
          </>
        );

      case 'error':
        return (
          <>
            <Surface
              elevation="raised"
              radius="pill"
              className="w-[140px] h-[140px] items-center justify-center mb-6 self-center"
            >
              <Ionicons name="alert-circle-outline" size={72} color={colors.accent} />
            </Surface>
            <Text className="text-[28px] font-bold text-center" style={{ color: colors.text }}>
              {t('onboarding.simple.error.title')}
            </Text>
            <Text className="text-base text-center leading-6 mt-3" style={{ color: colors.textSecondary }}>
              {error ?? t('onboarding.simple.unexpectedError')}
            </Text>
            <View className="mt-6 gap-3">
              <Button
                variant="primary"
                fullWidth
                testID="quick-setup.button.retry"
                onPress={() => {
                  if (createdRepo) {
                    handleCreateRepoAndClone();
                  } else {
                    setStep('repo-name');
                    setError(null);
                  }
                }}
                label={t('onboarding.simple.error.tryAgainButton')}
              />
              <Button
                variant="ghost"
                fullWidth
                testID="quick-setup.button.back-select"
                onPress={handleBackToSelect}
                label={t('onboarding.simple.error.backButton')}
              />
            </View>
          </>
        );

      default:
        return null;
    }
  };

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
          <View className="flex-1 px-10" style={{ justifyContent: 'center' }}>
            {renderStep()}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
