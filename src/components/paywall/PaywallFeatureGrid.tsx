import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Surface } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import { RADII, SPACING } from '../../theme/tokens';

interface FeatureMeta {
  id: string;
  titleKey: string;
  descKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}

// Order matches FEATURE_KEYS in src/screens/PaywallScreen.tsx — the first
// entry is promoted to the full-width hero tile.
const FEATURE_META: FeatureMeta[] = [
  {
    id: 'aiChat',
    titleKey: 'paywall.features.aiChat.title',
    descKey: 'paywall.features.aiChat.description',
    icon: 'chatbubbles',
  },
  {
    id: 'aiActions',
    titleKey: 'paywall.features.aiActions.title',
    descKey: 'paywall.features.aiActions.description',
    icon: 'sparkles',
  },
  {
    id: 'thoughtDump',
    titleKey: 'paywall.features.thoughtDump.title',
    descKey: 'paywall.features.thoughtDump.description',
    icon: 'bulb',
  },
  {
    id: 'voiceDump',
    titleKey: 'paywall.features.voiceDump.title',
    descKey: 'paywall.features.voiceDump.description',
    icon: 'mic',
  },
  {
    id: 'personalizedQuotes',
    titleKey: 'paywall.features.personalizedQuotes.title',
    descKey: 'paywall.features.personalizedQuotes.description',
    icon: 'chatbox-ellipses',
  },
  {
    id: 'githubTools',
    titleKey: 'paywall.features.githubTools.title',
    descKey: 'paywall.features.githubTools.description',
    icon: 'logo-github',
  },
  {
    id: 'canvases',
    titleKey: 'paywall.features.canvases.title',
    descKey: 'paywall.features.canvases.description',
    icon: 'easel',
  },
  {
    id: 'templates',
    titleKey: 'paywall.features.templates.title',
    descKey: 'paywall.features.templates.description',
    icon: 'albums',
  },
  {
    id: 'renderStyles',
    titleKey: 'paywall.features.renderStyles.title',
    descKey: 'paywall.features.renderStyles.description',
    icon: 'color-palette',
  },
  {
    id: 'multiAccount',
    titleKey: 'paywall.features.multiAccount.title',
    descKey: 'paywall.features.multiAccount.description',
    icon: 'people',
  },
  {
    id: 'accentColor',
    titleKey: 'paywall.features.accentColor.title',
    descKey: 'paywall.features.accentColor.description',
    icon: 'color-palette',
  },
  {
    id: 'proAppIcons',
    titleKey: 'paywall.features.proAppIcons.title',
    descKey: 'paywall.features.proAppIcons.description',
    icon: 'image',
  },
  {
    id: 'premiumThemes',
    titleKey: 'paywall.features.premiumThemes.title',
    descKey: 'paywall.features.premiumThemes.description',
    icon: 'color-fill',
  },
  {
    id: 'multiHost',
    titleKey: 'paywall.features.multiHost.title',
    descKey: 'paywall.features.multiHost.description',
    icon: 'git-network',
  },
  {
    id: 'biometricLock',
    titleKey: 'paywall.features.biometricLock.title',
    descKey: 'paywall.features.biometricLock.description',
    icon: 'finger-print',
  },
  {
    id: 'unlimitedRepos',
    titleKey: 'paywall.features.unlimitedRepos.title',
    descKey: 'paywall.features.unlimitedRepos.description',
    icon: 'folder-open',
  },
];

const GAP = SPACING[3];
const CARD_PADDING = SPACING[3];
// Screen horizontal margin consumed by the paywall scroll container (20/edge).
const HORIZONTAL_MARGIN = 40;
const TABLET_BREAKPOINT = 640;

const HERO = { height: 120, badge: 40, icon: 22, titleSize: 17, descSize: 13, descLines: 2 } as const;
const SMALL = { height: 136, badge: 38, icon: 20, titleSize: 14, descSize: 12, descLines: 3 } as const;

export function columnCountForWidth(width: number): 2 | 3 {
  return width >= TABLET_BREAKPOINT ? 3 : 2;
}

export default function PaywallFeatureGrid() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  const cols = columnCountForWidth(width);
  const usable = width - HORIZONTAL_MARGIN;
  const cardW = (usable - (cols - 1) * GAP) / cols;

  return (
    <View testID="paywall.features" style={styles.grid}>
      {FEATURE_META.map((feat, idx) => {
        const isHero = idx === 0;
        const m = isHero ? HERO : SMALL;
        return (
          <Surface
            key={feat.id}
            testID={`paywall.feature.${feat.id}`}
            elevation="raised"
            radius="md"
            accessibilityLabel={`${t(feat.titleKey)}. ${t(feat.descKey)}`}
            style={{
              width: isHero ? usable : cardW,
              height: m.height,
              padding: CARD_PADDING,
              backgroundColor: colors.surface,
            }}
          >
            <View
              style={{
                width: m.badge,
                height: m.badge,
                borderRadius: RADII.sm,
                backgroundColor: colors.primary + '1F',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: SPACING[2],
              }}
            >
              <Ionicons name={feat.icon} size={m.icon} color={colors.primary} />
            </View>
            <Text
              numberOfLines={2}
              style={{ fontSize: m.titleSize, fontWeight: '700', color: colors.text }}
            >
              {t(feat.titleKey)}
            </Text>
            <Text
              numberOfLines={m.descLines}
              style={{ fontSize: m.descSize, color: colors.textSecondary, marginTop: 2 }}
            >
              {t(feat.descKey)}
            </Text>
          </Surface>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
});
