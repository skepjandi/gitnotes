import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, useTokens } from '../contexts/ThemeContext';
import { Modal } from './ui';
import { useAccounts } from '../contexts/AccountsContext';
import { GIT_HOST_API_BASES, GIT_HOST_LABELS, type GitHostProvider } from '../services/git/GitHost';

type ThemeColors = {
  background: string;
  surface: string;
  primary: string;
  text: string;
  textSecondary: string;
  border: string;
  error: string;
};

export interface ConnectHostModalProps {
  visible: boolean;
  onClose: () => void;
  /** When supplied, the modal pre-selects this provider and runs in "add another host" mode. */
  presetProvider?: GitHostProvider;
  /** When supplied, attach the new connection to this account instead of creating a new one. */
  accountId?: string;
  colors: ThemeColors;
}

const ALL_PROVIDERS: { provider: GitHostProvider; helpTextKey: string }[] = [
  { provider: 'github', helpTextKey: 'connectHost.help.github' },
  { provider: 'gitlab', helpTextKey: 'connectHost.help.gitlab' },
  { provider: 'gitea', helpTextKey: 'connectHost.help.gitea' },
  { provider: 'forgejo', helpTextKey: 'connectHost.help.forgejo' },
];

type TokenReason = 'invalid' | 'missing_repo_scope' | 'missing_contents_permission' | 'saml' | 'no_repository_access' | 'network' | 'free_tier_identity_limit_reached';

const getTokenErrorKey = (reason: TokenReason | undefined, provider: string): string => {
  if (provider === 'github' && reason) {
    switch (reason) {
      case 'missing_repo_scope':
        return 'settings.tokenMissingRepoScope';
      case 'missing_contents_permission':
        return 'settings.tokenMissingContentsPermission';
      case 'saml':
        return 'settings.tokenSamlError';
      case 'no_repository_access':
        return 'settings.tokenNoRepoAccess';
      case 'invalid':
        return 'settings.tokenTestInvalid';
      case 'network':
        return 'settings.tokenTestNetwork';
      case 'free_tier_identity_limit_reached':
        return 'settings.tokenTestInvalid';
    }
  }
  return 'connectHost.error.invalidTokenBody';
};

/**
 * Modal that lets a user add a new host connection (or replace a token for
 * an existing one). Operates in 3 conceptual steps:
 *   1. Pick a host (GitHub / GitLab / Gitea / Forgejo).
 *   2. (GitLab/Gitea/Forgejo) optionally override the instance URL for self-hosting.
 *   3. Paste a token and verify — confirmed identity is shown before save.
 */
export function ConnectHostModal({
  visible,
  onClose,
  presetProvider,
  accountId,
  colors: colorsProp,
}: ConnectHostModalProps) {
  const { t } = useTranslation();
  const themeColors = useTheme().colors;
  const { spacing } = useTokens();
  const colors = colorsProp ?? themeColors;
  const { testToken, connectHost, accountSummaries } = useAccounts();

  const [provider, setProvider] = useState<GitHostProvider>(presetProvider ?? 'github');
  const [instanceBaseUrl, setInstanceBaseUrl] = useState<string>(GIT_HOST_API_BASES[provider]);
  const [token, setToken] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Reset state when modal closes or preset changes.
  useEffect(() => {
    if (visible) {
      const initial = presetProvider ?? 'github';
      setProvider(initial);
      setInstanceBaseUrl(GIT_HOST_API_BASES[initial]);
      setToken('');
      setTokenVisible(false);
      setIsTesting(false);
    }
  }, [visible, presetProvider]);

  const supportsSelfHost = provider !== 'github';

  const handleSelectProvider = useCallback(
    (next: GitHostProvider) => {
      setProvider(next);
      setInstanceBaseUrl(GIT_HOST_API_BASES[next]);
    },
    [],
  );

  const handleTest = useCallback(async () => {
    if (!token.trim()) {
      Alert.alert(t('connectHost.error.tokenRequired'));
      return;
    }
    if (supportsSelfHost && instanceBaseUrl) {
      try {
        // Sanity check the URL.
        const parsed = new URL(instanceBaseUrl.trim());
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          Alert.alert(t('connectHost.error.invalidUrl'));
          return;
        }
      } catch {
        Alert.alert(t('connectHost.error.invalidUrl'));
        return;
      }
    }

    setIsTesting(true);
    try {
      const result = await testToken(
        provider,
        token.trim(),
        supportsSelfHost ? instanceBaseUrl.trim() : null,
      );
      if (result.ok) {
        Alert.alert(t('connectHost.success.testTitle'), t('connectHost.success.testBody'));
      } else {
        const errorKey = getTokenErrorKey(result.reason, provider);
        Alert.alert(t('connectHost.error.invalidToken'), t(errorKey));
      }
    } catch (err) {
      Alert.alert(
        t('connectHost.error.networkTitle'),
        err instanceof Error ? err.message : t('connectHost.error.networkBody'),
      );
    } finally {
      setIsTesting(false);
    }
  }, [provider, token, supportsSelfHost, instanceBaseUrl, testToken, t]);

  const handleSave = useCallback(async () => {
    if (!token.trim()) {
      Alert.alert(t('connectHost.error.tokenRequired'));
      return;
    }
    setIsTesting(true);
    try {
      const result = await connectHost({
        provider,
        token: token.trim(),
        instanceBaseUrl: supportsSelfHost ? instanceBaseUrl.trim() : undefined,
        accountId,
      });
      if (!result.ok) {
        const errorKey = getTokenErrorKey(result.reason, provider);
        Alert.alert(t('connectHost.error.invalidToken'), t(errorKey));
        return;
      }
      onClose();
    } catch (err) {
      Alert.alert(
        t('connectHost.error.networkTitle'),
        err instanceof Error ? err.message : t('connectHost.error.networkBody'),
      );
    } finally {
      setIsTesting(false);
    }
  }, [provider, token, supportsSelfHost, instanceBaseUrl, accountId, connectHost, onClose, t]);

  const accountLoginHint = useMemo(() => {
    if (!accountId) return null;
    for (const summary of accountSummaries) {
      if (summary.account.id === accountId) return summary.account.login;
    }
    return null;
  }, [accountId, accountSummaries]);

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      bottomSheet
      contentStyle={{ padding: 16, paddingBottom: 34, backgroundColor: colors.background }}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text
          style={{
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
            marginBottom: spacing[2],
          }}
        >
          {t('connectHost.title')}
        </Text>
        {accountLoginHint ? (
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 13,
              marginBottom: spacing[3],
            }}
          >
            {t('connectHost.attachingTo', { login: accountLoginHint })}
          </Text>
        ) : null}

        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 13,
            marginBottom: spacing[2],
          }}
        >
          {t('connectHost.providerLabel')}
        </Text>
        <View style={[styles.row, { marginBottom: spacing[3] }]}>
          {ALL_PROVIDERS.map((entry) => {
            const isSelected = provider === entry.provider;
            return (
              <TouchableOpacity
                key={entry.provider}
                onPress={() => handleSelectProvider(entry.provider)}
                testID={`connect-host-provider-${entry.provider}`}
                style={{
                  flex: 1,
                  paddingVertical: spacing[3],
                  borderRadius: 12,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: isSelected ? colors.primary : colors.border,
                  backgroundColor: isSelected ? colors.primary + '12' : colors.surface,
                }}
              >
                <Text
                  style={{
                    color: isSelected ? colors.primary : colors.text,
                    fontSize: 13,
                    fontWeight: '600',
                  }}
                >
                  {GIT_HOST_LABELS[entry.provider]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {supportsSelfHost ? (
          <>
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 13,
                marginBottom: spacing[2],
              }}
            >
              {t('connectHost.instanceUrlLabel')}
            </Text>
            <TextInput
              value={instanceBaseUrl}
              onChangeText={(v) => {
                setInstanceBaseUrl(v);
              }}
              placeholder={GIT_HOST_API_BASES[provider]}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              testID="connect-host-instance-url-input"
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: spacing[3],
                paddingVertical: spacing[3],
                color: colors.text,
                backgroundColor: colors.surface,
                fontSize: 14,
                marginBottom: spacing[3],
              }}
            />
          </>
        ) : null}

        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 13,
            marginBottom: spacing[2],
          }}
        >
          {t('connectHost.tokenLabel')}
        </Text>
        <View style={[styles.tokenRow, { marginBottom: spacing[3] }]}>
          <TextInput
            value={token}
              onChangeText={(v) => {
                setToken(v);
              }}
            placeholder={t('connectHost.tokenPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!tokenVisible}
            showSoftInputOnFocus={false}
            testID="connect-host-token-input"
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              paddingHorizontal: spacing[3],
              paddingVertical: spacing[3],
              color: colors.text,
              backgroundColor: colors.surface,
              fontSize: 14,
            }}
          />
          <TouchableOpacity
            onPress={() => setTokenVisible((v) => !v)}
            testID="connect-host-token-toggle"
            style={{
              paddingHorizontal: spacing[3],
              paddingVertical: spacing[3],
              marginLeft: spacing[2],
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
              {tokenVisible ? t('connectHost.hide') : t('connectHost.show')}
            </Text>
          </TouchableOpacity>
        </View>

        {provider === 'github' ? (
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 12,
              marginBottom: spacing[2],
            }}
          >
            {t('connectHost.help.github')}
          </Text>
        ) : null}

        <View style={[styles.row, { marginTop: spacing[2] }]}>
          <TouchableOpacity
            onPress={onClose}
            style={{
              flex: 1,
              paddingVertical: spacing[3],
              borderRadius: 12,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
              {t('common.cancel')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleTest}
            disabled={isTesting || !token.trim()}
            testID="connect-host-test"
            style={{
              flex: 1,
              paddingVertical: spacing[3],
              borderRadius: 12,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: colors.border,
              opacity: isTesting || !token.trim() ? 0.6 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                {t('connectHost.test')}
              </Text>
              {isTesting ? <ActivityIndicator size="small" color={colors.text} /> : null}
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            disabled={isTesting || !token.trim()}
            testID="connect-host-save"
            style={{
              flex: 1,
              paddingVertical: spacing[3],
              borderRadius: 12,
              alignItems: 'center',
              backgroundColor:
                isTesting || !token.trim() ? colors.surface : colors.primary,
              borderWidth: 1,
              borderColor:
                isTesting || !token.trim() ? colors.border : colors.primary,
              opacity: isTesting || !token.trim() ? 0.6 : 1,
            }}
          >
            {isTesting ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text
                style={{
                  color:
                    isTesting || !token.trim() ? colors.textSecondary : '#fff',
                  fontSize: 14,
                  fontWeight: '600',
                }}
              >
                {t('connectHost.save')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 12,
  },
});
