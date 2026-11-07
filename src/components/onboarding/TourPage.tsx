import { useEffect, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Surface } from '../ui/Surface';
import { useTourText } from './tourCopy';

export type IoniconName = keyof typeof Ionicons.glyphMap;

export function ProChip() {
  const { colors } = useTheme();
  const tx = useTourText();
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 6,
        backgroundColor: `${colors.accent}22`,
        borderWidth: 1,
        borderColor: `${colors.accent}55`,
      }}
    >
      <Text style={{ color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 }}>
        {tx('proBadge')}
      </Text>
    </View>
  );
}

interface DemoFrameProps {
  readonly children: ReactNode;
  readonly height?: number;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}

/** Raised card that hosts a page's live demo. */
export function DemoFrame({ children, height, testID, accessibilityLabel }: DemoFrameProps) {
  return (
    <Surface
      elevation="raised"
      radius="lg"
      testID={testID}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      style={{ width: '100%', height }}
    >
      {/* Clip demo content here: overflow hidden on the Surface itself would drop its shadow. */}
      <View style={{ flex: height === undefined ? undefined : 1, overflow: 'hidden', borderRadius: 16 }}>{children}</View>
    </Surface>
  );
}

export interface TourPoint {
  readonly icon: IoniconName;
  readonly lead: string;
  readonly text: string;
  readonly pro?: boolean;
}

interface TourPointRowProps extends TourPoint {
  readonly highlighted?: boolean;
}

function TourPointRow({ icon, lead, text, pro, highlighted }: TourPointRowProps) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 10,
        marginHorizontal: -10,
        borderRadius: 12,
        backgroundColor: highlighted ? `${colors.accent}14` : 'transparent',
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${colors.accent}1F`,
        }}
      >
        <Ionicons name={icon} size={17} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{lead}</Text>
          {pro ? <ProChip /> : null}
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 1 }}>{text}</Text>
      </View>
    </View>
  );
}

interface TourPageProps {
  readonly testID: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly demo: ReactNode;
  readonly points?: readonly TourPoint[];
  readonly highlightIndex?: number;
  readonly footnote?: string;
  readonly children?: ReactNode;
}

/**
 * One page of the feature tour: a live demo on top, then an editorial,
 * left-aligned explanation. The whole page eases in once per mount.
 */
export function TourPage({ testID, eyebrow, title, body, demo, points, highlightIndex, footnote, children }: TourPageProps) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const entrance = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    entrance.value = reduceMotion ? 1 : withTiming(1, { duration: 360 });
  }, [entrance, reduceMotion]);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ translateY: (1 - entrance.value) * 14 }],
  }));

  return (
    <Animated.View testID={testID} style={[{ paddingHorizontal: 24, paddingTop: 4, paddingBottom: 16 }, entranceStyle]}>
      {demo}
      <Text
        style={{
          color: colors.accent,
          fontSize: 12,
          fontWeight: '800',
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          marginTop: 24,
        }}
      >
        {eyebrow}
      </Text>
      <Text
        accessibilityRole="header"
        style={{ color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6, lineHeight: 33, marginTop: 6 }}
      >
        {title}
      </Text>
      <Text style={{ color: colors.textSecondary, fontSize: 16, lineHeight: 23, marginTop: 10 }}>{body}</Text>
      {points && points.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          {points.map((point, index) => (
            <TourPointRow key={point.lead} {...point} highlighted={highlightIndex === index} />
          ))}
        </View>
      ) : null}
      {footnote ? (
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 12, opacity: 0.85 }}>{footnote}</Text>
      ) : null}
      {children}
    </Animated.View>
  );
}
