import { View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useTheme } from '../../contexts/ThemeContext';
import { useTourText } from './tourCopy';

const PILL_HEIGHT = 8;
const PILL_WIDTH = 8;
const ACTIVE_PILL_WIDTH = 28;

interface PillProps {
  readonly state: 'done' | 'active' | 'upcoming';
  readonly color: string;
  readonly mutedColor: string;
}

function Pill({ state, color, mutedColor }: PillProps) {
  const style = useAnimatedStyle(() => ({
    width: withSpring(state === 'active' ? ACTIVE_PILL_WIDTH : PILL_WIDTH, { damping: 18, stiffness: 260 }),
  }));
  const backgroundColor = state === 'upcoming' ? mutedColor : color;
  return (
    <Animated.View
      style={[
        style,
        {
          height: PILL_HEIGHT,
          borderRadius: PILL_HEIGHT / 2,
          backgroundColor,
          opacity: state === 'done' ? 0.45 : 1,
        },
      ]}
    />
  );
}

interface OnboardingProgressProps {
  readonly current: number;
  readonly total: number;
}

export function OnboardingProgress({ current, total }: OnboardingProgressProps) {
  const { colors } = useTheme();
  const tx = useTourText();
  return (
    <View
      testID="onboarding.progress"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={tx('stepOf', { current: current + 1, total })}
      accessibilityValue={{ min: 1, max: total, now: current + 1 }}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
    >
      {Array.from({ length: total }, (_, index) => (
        <Pill
          key={index}
          state={index < current ? 'done' : index === current ? 'active' : 'upcoming'}
          color={colors.accent}
          mutedColor={colors.border}
        />
      ))}
    </View>
  );
}
