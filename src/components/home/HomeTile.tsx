import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { readableInk } from '../../theme/tokens';

export type HomeTileVariant = 'primary' | 'secondary' | 'accent';

/** Minimum tile height per variant; tiles grow when their copy needs more room. */
export const HOME_TILE_MIN_HEIGHT: Record<HomeTileVariant, number> = {
  primary: 132,
  secondary: 132,
  accent: 168,
};

/** Tile border-radius per variant */
export const HOME_TILE_RADIUS: Record<HomeTileVariant, number> = {
  primary: 22,
  secondary: 18,
  accent: 22,
};

interface HomeTileProps {
  /** Visual hierarchy variant */
  variant: HomeTileVariant;
  /** Ionicons glyph used in the badge and as the oversized background watermark */
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
  testID?: string;
  /**
   * Lay the tile out as a full-width block. Leave off for tiles that share a
   * row — they split the width with `flex: 1`.
   */
  block?: boolean;
}

/**
 * Home dashboard tile.
 *
 * The icon badge sits at the top of the tile and the copy at the bottom, both in
 * normal flow, so long copy grows the tile instead of overlapping the badge.
 * Filled variants (primary, accent) carry the ink `readableInk` picks for their fill; the secondary variant uses
 * the surface color with themed ink. Every variant shows its glyph as a large
 * watermark bleeding off the bottom-right corner.
 */
export function HomeTile({
  variant,
  icon,
  title,
  subtitle,
  onPress,
  onLongPress,
  testID,
  block = false,
}: HomeTileProps) {
  const { colors } = useTheme();
  const isFilled = variant !== 'secondary';
  const isCompact = variant === 'secondary';

  const fill = variant === 'primary' ? colors.primary : colors.accent;
  const backgroundColor = isFilled ? fill : colors.surface;
  const ink = readableInk(fill);
  const titleColor = isFilled ? ink : colors.text;
  const subtitleColor = isFilled ? `${ink}DB` : colors.textSecondary;
  const affordanceColor = isFilled ? `${ink}CC` : colors.textSecondary;
  const watermarkColor = isFilled ? ink : colors.primary;
  const watermarkOpacity = isFilled ? 0.14 : 0.08;
  const edgeColor = isFilled ? `${ink}38` : colors.border;

  const badgeSize = isCompact ? 40 : 38;
  const badgeBackground = variant === 'primary' ? ink : variant === 'accent' ? `${ink}38` : `${colors.primary}1F`;
  const badgeIconColor = variant === 'primary' ? fill : isFilled ? ink : colors.primary;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.tile,
        block ? styles.block : styles.cell,
        {
          minHeight: HOME_TILE_MIN_HEIGHT[variant],
          borderRadius: HOME_TILE_RADIUS[variant],
          backgroundColor,
          borderWidth: isFilled ? 1 : StyleSheet.hairlineWidth,
          borderColor: edgeColor,
          opacity: pressed ? 0.92 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        } as ViewStyle,
      ]}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
    >
      <View
        testID={testID ? `${testID}.watermark` : undefined}
        style={styles.watermark}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
      >
        <Ionicons name={icon} size={132} color={watermarkColor} style={{ opacity: watermarkOpacity }} />
      </View>

      <View style={styles.topRow}>
        <View
          testID={testID ? `${testID}.badge` : undefined}
          style={[
            styles.badge,
            { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: badgeBackground },
          ]}
        >
          <Ionicons name={icon} size={Math.round(badgeSize * 0.52)} color={badgeIconColor} />
        </View>
        <Ionicons name="arrow-forward" size={16} color={affordanceColor} />
      </View>

      <View testID={testID ? `${testID}.content` : undefined} style={styles.content}>
        <Text
          style={[styles.title, isCompact && styles.titleCompact, { color: titleColor }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? <Text style={[styles.subtitle, { color: subtitleColor }]}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    padding: 16,
    overflow: 'hidden',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  cell: {
    flex: 1,
  },
  block: {
    alignSelf: 'stretch',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermark: {
    position: 'absolute',
    right: -22,
    bottom: -28,
    transform: [{ rotate: '-12deg' }],
  },
  content: {
    gap: 4,
    marginTop: 14,
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  titleCompact: {
    fontSize: 16,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12.5,
    fontWeight: '500',
    lineHeight: 17,
  },
});

export default HomeTile;
