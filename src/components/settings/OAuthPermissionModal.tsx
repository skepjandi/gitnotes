import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Button, Toggle } from '../ui';
import { useTokens } from '../../contexts/ThemeContext';

export const OAUTH_PROFILE_SCOPE = 'read:user' as const;
export const OAUTH_REPOSITORY_SCOPE = 'repo' as const;
export type OAuthScope = typeof OAUTH_PROFILE_SCOPE | typeof OAUTH_REPOSITORY_SCOPE;

type OAuthPermissionModalProps = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (scopes: OAuthScope[]) => void;
};

const DEFAULT_SCOPES: OAuthScope[] = [OAUTH_PROFILE_SCOPE, OAUTH_REPOSITORY_SCOPE];

export function OAuthPermissionModal({ visible, onClose, onConfirm }: OAuthPermissionModalProps) {
  const { colors } = useTokens();
  const [repositoryAccess, setRepositoryAccess] = useState(true);

  useEffect(() => {
    if (visible) setRepositoryAccess(true);
  }, [visible]);

  const scopes: OAuthScope[] = repositoryAccess
    ? DEFAULT_SCOPES
    : [OAUTH_PROFILE_SCOPE];

  return (
    <Modal visible={visible} onRequestClose={onClose} accessibilityLabel="GitHub OAuth permissions">
      <View className="gap-4">
        <View className="flex-row items-center justify-between">
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>
            GitHub permissions
          </Text>
          <TouchableOpacity testID="oauth-permissions.close" onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
          Choose what GitNotes can access. Repository access is account-wide for OAuth; use GitHub App installation when you need repository-specific access.
        </Text>
        <View className="gap-3">
          <PermissionRow
            title="Profile information"
            description="Identify your GitHub account."
            value
            disabled
            onValueChange={() => undefined}
            testID="oauth-permissions.profile"
            colors={colors}
          />
          <PermissionRow
            title="Repositories"
            description="Read and write repositories available to your GitHub account."
            value={repositoryAccess}
            onValueChange={setRepositoryAccess}
            testID="oauth-permissions.repositories"
            colors={colors}
          />
        </View>
        <Button
          testID="oauth-permissions.continue"
          label="Continue to GitHub"
          onPress={() => onConfirm(scopes)}
          variant="primary"
          fullWidth
          textStyle={{ color: '#fff', fontWeight: '600' }}
        />
      </View>
    </Modal>
  );
}

type PermissionRowProps = {
  title: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  testID: string;
  colors: ReturnType<typeof useTokens>['colors'];
};

function PermissionRow({ title, description, value, disabled, onValueChange, testID, colors }: PermissionRowProps) {
  return (
    <View className="flex-row items-center gap-3 rounded-lg border p-3" style={{ borderColor: colors.border }}>
      <View className="flex-1 gap-1">
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18 }}>{description}</Text>
      </View>
      <Toggle testID={testID} value={value} disabled={disabled} onValueChange={onValueChange} />
    </View>
  );
}
