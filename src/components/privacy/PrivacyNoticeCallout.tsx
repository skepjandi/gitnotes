import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../contexts/ThemeContext';
import { PrivacyNoticeService } from '../../services/PrivacyNoticeService';

const PRIVACY_POLICY_URL = 'https://gitnotes.org/privacy';

/**
 * Next-launch notice for material privacy-policy changes. Shown once per
 * policy version and dismissed locally on the device.
 */
export function PrivacyNoticeCallout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;

    void PrivacyNoticeService.shouldShowNotice().then((shouldShow) => {
      if (mounted) setVisible(shouldShow);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    void PrivacyNoticeService.dismissNotice();
  }, []);

  const handleOpenPolicy = useCallback(() => {
    void Linking.openURL(PRIVACY_POLICY_URL).catch(() => undefined);
  }, []);

  if (!visible) return null;

  return (
    <View
      testID="privacy-notice-callout"
      accessible
      accessibilityLabel={t('privacyNotice.title')}
      className="mb-3 rounded-2xl border p-4"
      style={{ backgroundColor: `${colors.accent}14`, borderColor: `${colors.accent}44` }}
    >
      <Text className="text-base font-semibold" style={{ color: colors.text }}>
        {t('privacyNotice.title')}
      </Text>
      <Text className="mt-1 text-sm" style={{ color: colors.textSecondary }}>
        {t('privacyNotice.body')}
      </Text>
      <View className="mt-3 flex-row gap-3">
        <Pressable
          testID="privacy-notice-read-policy"
          accessibilityRole="button"
          accessibilityLabel={t('privacyNotice.readPolicy')}
          onPress={handleOpenPolicy}
          className="rounded-xl px-3 py-2"
          style={{ backgroundColor: colors.accent }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.surface }}>
            {t('privacyNotice.readPolicy')}
          </Text>
        </Pressable>
        <Pressable
          testID="privacy-notice-dismiss"
          accessibilityRole="button"
          accessibilityLabel={t('privacyNotice.dismiss')}
          onPress={handleDismiss}
          className="rounded-xl border px-3 py-2"
          style={{ borderColor: colors.border }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.text }}>
            {t('privacyNotice.dismiss')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
