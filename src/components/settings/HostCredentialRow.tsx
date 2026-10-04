import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { GroupRow, Toggle } from '../ui';
import { useTokens } from '../../contexts/ThemeContext';
import type { GitHubAppCredentialRecord } from '../../services/git/contracts/GitHubAppCredential';

export type HostCredentialKind = 'ssh' | 'oauth' | 'github_app' | 'token';

export type HostCredentialRowProps = {
  kind: HostCredentialKind;
  hostId: string;
  sshEnabled: boolean;
  oauthConnected: boolean;
  oauthLoading: boolean;
  oauthError: string | null;
  appCredential: GitHubAppCredentialRecord | null;
  appLoading: boolean;
  appError: string | null;
  hasPat: boolean;
  patLoading: boolean;
  patError: string | null;
  onToggleSSH: () => void;
  onOAuthPress: () => void;
  onAppPress: () => void;
  onPatPress: () => void;
};

function assertNever(value: never): never {
  throw new Error(`Unhandled credential row kind: ${value}`);
}

function ActionLabel({
  label,
  color,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      activeOpacity={0.7}
      style={{ paddingVertical: 4, paddingHorizontal: 2 }}
    >
      <Text style={{ color, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function HostCredentialRow({
  kind,
  hostId,
  sshEnabled,
  oauthConnected,
  oauthLoading,
  oauthError,
  appCredential,
  appLoading,
  appError,
  hasPat,
  patLoading,
  patError,
  onToggleSSH,
  onOAuthPress,
  onAppPress,
  onPatPress,
}: HostCredentialRowProps) {
  const { colors, type } = useTokens();
  const { t } = useTranslation();
  const rowTestID = `settings.row.host.${hostId}.${kind === 'github_app' ? 'github-app' : kind === 'token' ? 'pat' : kind}`;

  switch (kind) {
    case 'ssh':
      return (
        <View testID={rowTestID}>
          <GroupRow
            leading={<Ionicons name="git-branch-outline" size={19} color={colors.textSecondary} />}
            trailing={
              <Toggle
                testID={`settings.toggle.ssh.${hostId}`}
                value={sshEnabled}
                onValueChange={onToggleSSH}
              />
            }
          >
            <Text style={{ color: colors.text, fontSize: type.sm, fontWeight: '600' }}>SSH access</Text>
            <Text style={{ color: colors.textSecondary, fontSize: type.xs, marginTop: 2 }}>
              {sshEnabled ? 'Enabled for Git operations' : 'Use HTTPS for Git operations'}
            </Text>
          </GroupRow>
        </View>
      );
    case 'oauth':
      return (
        <View testID={rowTestID}>
          <GroupRow
            leading={<Ionicons name="logo-github" size={19} color={colors.textSecondary} />}
            trailing={
              <View className="flex-row items-center gap-2">
                {oauthLoading ? <ActivityIndicator size="small" color={colors.primary} testID={`settings.spinner.oauth.${hostId}`} /> : null}
                <ActionLabel
                  label={oauthConnected ? 'Disconnect' : 'Connect'}
                  color={oauthError ? colors.error : oauthConnected ? colors.error : colors.primary}
                  onPress={onOAuthPress}
                  disabled={oauthLoading}
                  testID={`settings.button.connect-oauth.${hostId}`}
                />
              </View>
            }
          >
            <Text style={{ color: colors.text, fontSize: type.sm, fontWeight: '600' }}>OAuth</Text>
            <Text style={{ color: colors.textSecondary, fontSize: type.xs, marginTop: 2 }}>
              {oauthError ?? (oauthConnected ? 'Connected to GitHub' : 'Not connected')}
            </Text>
          </GroupRow>
        </View>
      );
    case 'github_app':
      return (
        <View testID={rowTestID}>
          <GroupRow
            leading={<Ionicons name="cube-outline" size={19} color={colors.textSecondary} />}
            trailing={
              <View className="flex-row items-center gap-2">
                {appCredential?.accountAvatarUrl ? (
                  <Image source={{ uri: appCredential.accountAvatarUrl }} style={{ width: 20, height: 20, borderRadius: 5 }} />
                ) : null}
                {appLoading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                <ActionLabel
                  label={appCredential ? t('common.remove') : 'Install'}
                  color={appError ? colors.error : appCredential ? colors.error : colors.primary}
                  onPress={onAppPress}
                  disabled={appLoading}
                  testID={appCredential ? `settings.button.remove-github-app.${hostId}` : `settings.button.connect-github-app.${hostId}`}
                />
              </View>
            }
          >
            <Text style={{ color: colors.text, fontSize: type.sm, fontWeight: '600' }}>GitHub App</Text>
            <Text style={{ color: colors.textSecondary, fontSize: type.xs, marginTop: 2 }}>
              {appError ?? (appCredential ? `Installed${appCredential.accountLogin ? ` for ${appCredential.accountLogin}` : ''}` : 'Not installed')}
            </Text>
          </GroupRow>
        </View>
      );
    case 'token':
      if (!hasPat) return null;
      return (
        <View testID={rowTestID}>
          <GroupRow
            leading={<Ionicons name="key-outline" size={19} color={colors.textSecondary} />}
            trailing={
              <View className="flex-row items-center gap-2">
                {patLoading ? <ActivityIndicator size="small" color={colors.primary} testID={`settings.spinner.pat.${hostId}`} /> : null}
                <ActionLabel
                  label={t('common.remove')}
                  color={patError ? colors.error : colors.primary}
                  onPress={onPatPress}
                  disabled={patLoading}
                  testID={`settings.button.remove-pat.${hostId}`}
                />
              </View>
            }
          >
            <Text style={{ color: colors.text, fontSize: type.sm, fontWeight: '600' }}>Personal access token</Text>
            <Text style={{ color: colors.textSecondary, fontSize: type.xs, marginTop: 2 }}>
              {patError ?? 'Stored for GitHub API access'}
            </Text>
          </GroupRow>
        </View>
      );
    default:
      return assertNever(kind);
  }
}
