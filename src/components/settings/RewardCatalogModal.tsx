import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import { HapticService } from '../../utils/haptics';
import {
  RewardEntitlementService,
  type RewardEntry,
  type ReferralStatus,
} from '../../services/RewardEntitlementService';
import { REFERRAL_MILESTONES } from '../../types/worker';
import type { ThemeStyle } from '../../theme/tokens';


export interface RewardCatalogModalProps {
  visible: boolean;
  onRequestClose: () => void;
  onSelectTheme: (style: string) => void;
  onSelectIcon: (iconName: string) => void;
  currentStyle: string;
  currentIcon: string | null;
  appIconSupported: boolean;
}

interface ThemePreview {
  key: ThemeStyle;
  name: string;
  accentColor: string;
  bgColor: string;
}

const THEME_PREVIEWS: readonly ThemePreview[] = [
  { key: 'terminal-mono', name: 'Terminal Mono', accentColor: '#FF8C00', bgColor: '#0D0D0A' },
  { key: 'crt-green', name: 'CRT Green', accentColor: '#4ADE80', bgColor: '#0A0E0A' },
  { key: 'developer-desk', name: 'Developer Desk', accentColor: '#569CD6', bgColor: '#1E1E1E' },
];

const REFERRAL_THEME_MAP: Record<string, ThemeStyle> = {
  'terminal-mono-theme': 'terminal-mono',
  'crt-green-theme': 'crt-green',
  'developer-desk-theme': 'developer-desk',
};

const REFERRAL_ICON_MAP: Record<string, string> = {
  'terminal-mono-icon': 'TerminalMono',
  'amber-terminal-icon': 'AmberTerminal',
  'monochrome-grid-icon': 'MonochromeGrid',
};

function RewardRow({
  reward,
  onPress,
  isSelected,
  children,
}: {
  reward: RewardEntry;
  onPress: () => void;
  isSelected: boolean;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      testID={`reward.row.${reward.reward_key}`}
      onPress={onPress}
      disabled={!reward.unlocked}
      style={[
        styles.rewardRow,
        { borderBottomColor: colors.border },
        !reward.unlocked && styles.rewardRowLocked,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${reward.name} ${reward.reward_type}, ${reward.unlocked ? 'unlocked' : `locked, requires ${reward.milestone} referrals`}`}
      accessibilityState={{ disabled: !reward.unlocked }}
    >
      <View style={styles.rewardInfo}>
        {children}
      </View>
      {reward.unlocked && isSelected && (
        <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
      )}
      {!reward.unlocked && (
        <View style={styles.lockBadge}>
          <Ionicons name="lock-closed" size={14} color={colors.textSecondary} />
          <Text style={[styles.lockText, { color: colors.textSecondary }]}>
            {reward.milestone}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function ThemeSwatch({ preview, isDark }: { preview: ThemePreview; isDark: boolean }) {
  return (
    <View style={[styles.swatch, { backgroundColor: isDark ? preview.bgColor : '#F5F5F5' }]}>
      <View style={[styles.swatchInner, { backgroundColor: preview.bgColor }]}>
        <View style={[styles.swatchAccentBar, { backgroundColor: preview.accentColor }]} />
      </View>
    </View>
  );
}

export default function RewardCatalogModal({
  visible,
  onRequestClose,
  onSelectTheme,
  onSelectIcon,
  currentStyle,
  currentIcon,
  appIconSupported,
}: RewardCatalogModalProps) {
  const { colors, isDark } = useTheme();
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await RewardEntitlementService.fetchStatus();
      setStatus(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rewards');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      void loadStatus();
    }
  }, [visible, loadStatus]);

  const handleThemeSelect = useCallback(
    (reward: RewardEntry) => {
      if (!reward.unlocked) return;
      const style = REFERRAL_THEME_MAP[reward.reward_key];
      if (style) {
        HapticService.selection();
        onSelectTheme(style);
      }
    },
    [onSelectTheme],
  );

  const handleIconSelect = useCallback(
    (reward: RewardEntry) => {
      if (!reward.unlocked) return;
      const iconName = REFERRAL_ICON_MAP[reward.reward_key];
      if (iconName) {
        HapticService.selection();
        onSelectIcon(iconName);
      }
    },
    [onSelectIcon],
  );

  const progress = status?.progress ?? 0;
  const total = REFERRAL_MILESTONES[REFERRAL_MILESTONES.length - 1] ?? 20;
  const progressPercent = Math.min(100, Math.round((progress / total) * 100));

  const themeRewards = status?.rewards.filter((r) => r.reward_type === 'theme') ?? [];
  const iconRewards = status?.rewards.filter((r) => r.reward_type === 'icon') ?? [];

  return (
    <Modal
      visible={visible}
      onRequestClose={onRequestClose}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Referral Rewards</Text>
        <TouchableOpacity onPress={onRequestClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {loading && (
          <View style={styles.centerState}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading rewards...</Text>
          </View>
        )}

        {error && !loading && (
          <View style={styles.centerState}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            <TouchableOpacity
              testID="reward-catalog.retry"
              onPress={() => void loadStatus()}
              style={[styles.retryButton, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !error && status && (
          <>
            <View style={styles.progressSection}>
              <View style={styles.progressHeader}>
                <Text style={[styles.progressTitle, { color: colors.text }]}>Your Progress</Text>
                <Text style={[styles.progressCount, { color: colors.textSecondary }]}>
                  {progress} / {total} referrals
                </Text>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: colors.accent, width: `${progressPercent}%` },
                  ]}
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Themes</Text>
              {themeRewards.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No theme rewards unlocked yet
                </Text>
              ) : (
                themeRewards.map((reward) => {
                  const preview = THEME_PREVIEWS.find((p) => p.key === REFERRAL_THEME_MAP[reward.reward_key]);
                  const isSelected = currentStyle === REFERRAL_THEME_MAP[reward.reward_key];
                  return (
                    <RewardRow
                      key={reward.reward_key}
                      reward={reward}
                      onPress={() => handleThemeSelect(reward)}
                      isSelected={isSelected}
                    >
                      <View style={styles.rewardContent}>
                        {preview && (
                          <ThemeSwatch preview={preview} isDark={isDark} />
                        )}
                        <View style={styles.rewardText}>
                          <Text style={[styles.rewardName, { color: colors.text }]}>{reward.name}</Text>
                          <Text style={[styles.rewardMilestone, { color: colors.textSecondary }]}>
                            {reward.unlocked
                              ? 'Unlocked'
                              : `Unlock at ${reward.milestone} referrals`}
                          </Text>
                        </View>
                      </View>
                    </RewardRow>
                  );
                })
              )}
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>App Icons</Text>
              {!appIconSupported ? (
                <Text style={[styles.unavailableText, { color: colors.textSecondary }]}>
                  App icons not supported on this platform
                </Text>
              ) : iconRewards.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No icon rewards unlocked yet
                </Text>
              ) : (
                iconRewards.map((reward) => {
                  const iconName = REFERRAL_ICON_MAP[reward.reward_key];
                  const isSelected = currentIcon === iconName;
                  return (
                    <RewardRow
                      key={reward.reward_key}
                      reward={reward}
                      onPress={() => handleIconSelect(reward)}
                      isSelected={isSelected}
                    >
                      <View style={styles.rewardContent}>
                        <View style={[styles.iconPreview, { backgroundColor: colors.surfaceSecondary }]}>
                          {iconName === 'TerminalMono' ? (
                            <Image
                              source={require('../../../assets/generated/alternate/terminal-mono/icon.png')}
                              style={{ width: 48, height: 48, borderRadius: 10 }}
                              accessibilityLabel={reward.name}
                            />
                          ) : iconName === 'AmberTerminal' ? (
                            <Image
                              source={require('../../../assets/generated/alternate/amber-terminal/icon.png')}
                              style={{ width: 48, height: 48, borderRadius: 10 }}
                              accessibilityLabel={reward.name}
                            />
                          ) : iconName === 'MonochromeGrid' ? (
                            <Image
                              source={require('../../../assets/generated/alternate/monochrome-grid/icon.png')}
                              style={{ width: 48, height: 48, borderRadius: 10 }}
                              accessibilityLabel={reward.name}
                            />
                          ) : (
                            <Ionicons
                              name="apps-outline"
                              size={28}
                              color={reward.unlocked ? colors.accent : colors.textSecondary}
                            />
                          )}
                        </View>
                        <View style={styles.rewardText}>
                          <Text style={[styles.rewardName, { color: colors.text }]}>{reward.name}</Text>
                          <Text style={[styles.rewardMilestone, { color: colors.textSecondary }]}>
                            {reward.unlocked
                              ? 'Unlocked'
                              : `Unlock at ${reward.milestone} referrals`}
                          </Text>
                        </View>
                      </View>
                    </RewardRow>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    maxHeight: 480,
  },
  content: {
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  centerState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
  },
  progressSection: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  progressCount: {
    fontSize: 14,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  unavailableText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rewardRowLocked: {
    opacity: 0.6,
  },
  rewardInfo: {
    flex: 1,
  },
  rewardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  swatchInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swatchAccentBar: {
    width: 24,
    height: 4,
    borderRadius: 2,
  },
  iconPreview: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rewardText: {
    flex: 1,
  },
  rewardName: {
    fontSize: 16,
    fontWeight: '500',
  },
  rewardMilestone: {
    fontSize: 13,
    marginTop: 2,
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lockText: {
    fontSize: 13,
  },
});
