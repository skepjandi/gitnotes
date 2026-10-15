import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { ScreenHeader, useScreenHeaderHeight, Button, Surface } from '../components/ui';
import PaywallFeatureGrid from '../components/paywall/PaywallFeatureGrid';
import PaywallPlanGrid, { PlanTileData } from '../components/paywall/PaywallPlanGrid';
import { useTheme } from '../contexts/ThemeContext';
import { useProStore } from '../stores/proStore';
import { trackPaywallImpression } from '../services/RevenueCatService';
import * as PaywallAnalytics from '../services/PaywallAnalytics';
import { LEGAL_URLS } from '../utils/constants';

export default function PaywallScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const navigation = useNavigation();
  const headerHeight = useScreenHeaderHeight();
  const insets = useSafeAreaInsets();

  const monthlyPackage = useProStore((s) => s.monthlyPackage);
  const yearlyPackage = useProStore((s) => s.yearlyPackage);
  const lifetimePackage = useProStore((s) => s.lifetimePackage);
  const offeringsReady = useProStore((s) => s.offeringsReady);
  const configured = useProStore((s) => s.configured);
  const currentOffering = useProStore((s) => s.currentOffering);
  const isPurchasing = useProStore((s) => s.isPurchasing);
  const isRestoring = useProStore((s) => s.isRestoring);
  const error = useProStore((s) => s.error);
  const loadOfferingsIfNeeded = useProStore((s) => s.loadOfferingsIfNeeded);
  const purchaseMonthly = useProStore((s) => s.purchaseMonthly);
  const purchaseYearly = useProStore((s) => s.purchaseYearly);
  const purchaseLifetime = useProStore((s) => s.purchaseLifetime);
  const restore = useProStore((s) => s.restore);

  const [restoreNotice, setRestoreNotice] = useState<'nothing' | null>(null);
  const openedAtRef = useRef(Date.now());

  useEffect(() => {
    void loadOfferingsIfNeeded();
  }, [loadOfferingsIfNeeded]);

  // Paywall is a leaf screen (only goBack): every entry path funnels through
  // root-stack navigate('Paywall'), and navigating to an already-focused leaf
  // screen is a no-op — mount == presentation, so exactly one impression per
  // view (#935).
  useEffect(() => {
    const openedAt = openedAtRef.current;
    PaywallAnalytics.trackPaywallOpen();
    if (configured) {
      void trackPaywallImpression(currentOffering ?? undefined);
    }
    return () => {
      PaywallAnalytics.trackPaywallClose(
        Date.now() - openedAt,
        useProStore.getState().status === 'pro',
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthlyPrice = monthlyPackage?.product.priceString;
  const yearlyPrice = yearlyPackage?.product.priceString;
  const lifetimePrice = lifetimePackage?.product.priceString;
  const busy = isPurchasing || isRestoring;

  const handleMonthly = useCallback(() => {
    if (!monthlyPackage) return;
    setRestoreNotice(null);
    PaywallAnalytics.trackCtaTap(monthlyPackage.product.identifier);
    void purchaseMonthly().then(() => {
      if (useProStore.getState().status === 'pro') navigation.goBack();
    });
  }, [monthlyPackage, purchaseMonthly, navigation]);

  const handleYearly = useCallback(() => {
    if (!yearlyPackage) return;
    setRestoreNotice(null);
    PaywallAnalytics.trackCtaTap(yearlyPackage.product.identifier);
    void purchaseYearly().then(() => {
      if (useProStore.getState().status === 'pro') navigation.goBack();
    });
  }, [yearlyPackage, purchaseYearly, navigation]);

  const handleLifetime = useCallback(() => {
    if (!lifetimePackage) return;
    setRestoreNotice(null);
    PaywallAnalytics.trackCtaTap(lifetimePackage.product.identifier);
    void purchaseLifetime().then(() => {
      if (useProStore.getState().status === 'pro') navigation.goBack();
    });
  }, [lifetimePackage, purchaseLifetime, navigation]);

  const handleRestore = useCallback(async () => {
    setRestoreNotice(null);
    PaywallAnalytics.trackRestoreTap();
    const outcome = await restore();
    if (outcome === 'restored') {
      navigation.goBack();
    } else if (outcome === 'nothing') {
      setRestoreNotice('nothing');
    }
    // 'cancelled' — user dismissed the sheet; silent, no message.
  }, [restore, navigation]);

  const plans: PlanTileData[] = [];
  if (lifetimePackage) {
    plans.push({
      id: 'lifetime',
      title: t('paywall.lifetime.title'),
      priceLine: lifetimePrice ? t('paywall.lifetime.cta', { price: lifetimePrice }) : null,
      ctaLabel: t('paywall.action.buy'),
      ctaTestID: 'paywall.lifetime.cta',
      variant: 'primary',
      disabled: busy || !lifetimePrice,
      onPress: handleLifetime,
      icon: 'infinite',
    });
  }
  if (yearlyPackage) {
    plans.push({
      id: 'yearly',
      title: t('paywall.yearly.title'),
      priceLine: yearlyPrice ? t('paywall.yearly.cta', { price: yearlyPrice }) : null,
      ctaLabel: t('paywall.action.subscribe'),
      ctaTestID: 'paywall.yearly.cta',
      variant: 'secondary',
      disabled: busy || !yearlyPrice,
      onPress: handleYearly,
      icon: 'pricetag',
    });
  }
  plans.push({
    id: 'monthly',
    title: t('paywall.monthly.title'),
    priceLine: monthlyPrice ? t('paywall.monthly.price', { price: monthlyPrice }) : null,
    ctaLabel: t('paywall.action.subscribe'),
    ctaTestID: 'paywall.monthly.cta',
    variant: 'secondary',
    disabled: busy || !monthlyPrice,
    onPress: handleMonthly,
    icon: 'calendar',
  });

  return (
    <SafeAreaView edges={['top']} className="flex-1" style={{ backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('paywall.title')}
        actions={
          <TouchableOpacity
            testID="paywall.close"
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, paddingTop: Math.max(56, headerHeight - 24) }}
        testID="paywall.scroll"
      >
        <Text className="text-3xl font-bold text-center" style={{ color: colors.text }}>
          {t('paywall.subtitle')}
        </Text>

        <View
          className="mt-4 rounded-xl border p-4 flex-row items-start gap-3"
          style={{ backgroundColor: colors.accent + '14', borderColor: colors.accent + '44' }}
          testID="paywall.byok-note"
        >
          <Ionicons name="key" size={22} color={colors.accent} />
          <View className="flex-1">
            <Text className="text-sm font-semibold" style={{ color: colors.text }}>
              {t('paywall.byok.title')}
            </Text>
            <Text className="text-[13px] mt-1 leading-[18px]" style={{ color: colors.textSecondary }}>
              {t('paywall.byok.body')}
            </Text>
          </View>
        </View>

        {error ? (
          <View className="mt-6 rounded-xl border p-4 flex-row items-start gap-3" style={{ backgroundColor: colors.error + '14', borderColor: colors.error + '44' }} testID="paywall.error">
            <Ionicons name="alert-circle" size={22} color={colors.error} />
            <View className="flex-1">
              <Text className="text-sm font-semibold" style={{ color: colors.error }}>
                {t('paywall.purchaseError')}
              </Text>
              <Text className="text-[13px] mt-1 leading-[18px]" style={{ color: colors.textSecondary }}>
                {error}
              </Text>
              <Button
                testID="paywall.retry"
                variant="secondary"
                label={t('paywall.retry')}
                onPress={() => void loadOfferingsIfNeeded()}
                style={{ marginTop: 12 }}
              />
            </View>
          </View>
        ) : null}

        {!offeringsReady ? (
          <View className="mt-8 items-center" testID="paywall.loading">
            {error ? (
              <View className="items-center gap-4">
                <Ionicons name="warning-outline" size={48} color={colors.error} />
                <Text className="text-sm text-center" style={{ color: colors.textSecondary }}>
                  {error}
                </Text>
                <Button
                  variant="secondary"
                  onPress={() => void loadOfferingsIfNeeded()}
                  label="Retry"
                />
              </View>
            ) : (
              <ActivityIndicator color={colors.primary} size="large" />
            )}
          </View>
        ) : (
          <>
            {/* Payment options first for ease of access, features below. */}
            <View className="mt-6">
              <PaywallPlanGrid plans={plans} />
            </View>

            <View className="mt-6">
              <PaywallFeatureGrid />
            </View>

            <TouchableOpacity
              testID="paywall.restore"
              className="items-center mt-6"
              disabled={busy}
              onPress={() => void handleRestore()}
            >
              {isRestoring ? (
                <View className="flex-row items-center gap-2" testID="paywall.restoring">
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text className="text-sm font-medium" style={{ color: colors.accent }}>
                    {t('paywall.restoring')}
                  </Text>
                </View>
              ) : (
                <Text className="text-sm font-medium" style={{ color: colors.accent }}>
                  {t('paywall.restore')}
                </Text>
              )}
            </TouchableOpacity>

            {restoreNotice === 'nothing' ? (
              <Surface elevation="raised" radius="md" className="mt-4 p-4" testID="paywall.restore-nothing">
                <Text className="text-[13px] text-center leading-[18px]" style={{ color: colors.textSecondary }}>
                  {t('paywall.nothingToRestore')}
                </Text>
              </Surface>
            ) : null}

            <Text className="text-xs text-center mt-6 leading-[18px]" style={{ color: colors.textSecondary }}>
              {t('paywall.termsNote')}
            </Text>

            <View className="flex-row justify-center gap-4 mt-3">
              <Pressable
                testID="paywall.terms-link"
                role="link"
                accessibilityRole="link"
                onPress={() => void Linking.openURL(LEGAL_URLS.terms)}
              >
                <Text className="text-xs font-medium" style={{ color: colors.accent }}>
                  {t('paywall.footer.terms')}
                </Text>
              </Pressable>
              <Pressable
                testID="paywall.privacy-link"
                role="link"
                accessibilityRole="link"
                onPress={() => void Linking.openURL(LEGAL_URLS.privacy)}
              >
                <Text className="text-xs font-medium" style={{ color: colors.accent }}>
                  {t('paywall.footer.privacy')}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
