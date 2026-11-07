import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import {
  FLOATING_AI_BUTTON_SIZE,
  FLOATING_AI_HUB_ITEMS,
  type HubItemId,
} from '../ai/floatingAIButtonGeometry';
import { DemoFrame, type IoniconName } from './TourPage';
import { useTourText, type TourCopyKey } from './tourCopy';
import { useDemoStage } from './useDemoStage';

const FRAME_HEIGHT = 290;
const EDGE = 24;

interface HubItemStyle {
  readonly icon: IoniconName;
  readonly size: number;
  readonly iconSize: number;
  readonly tone: 'primary' | 'accent' | 'muted';
}

/** Icons, size tiers and colors mirror the real FloatingAIHubMenu. */
const HUB_ITEM_STYLES: Record<HubItemId, HubItemStyle> = {
  'new-chat': { icon: 'add', size: 56, iconSize: 24, tone: 'primary' },
  'voice-dump': { icon: 'mic', size: 56, iconSize: 24, tone: 'primary' },
  'chat-history': { icon: 'chatbubbles-outline', size: 46, iconSize: 18, tone: 'muted' },
  'ai-settings': { icon: 'options-outline', size: 46, iconSize: 18, tone: 'muted' },
  'thought-dump': { icon: 'bulb-outline', size: 50, iconSize: 22, tone: 'accent' },
};

/** Stages: 0 idle, 1 holding, 2 hub open. */
const CAPTIONS: readonly TourCopyKey[] = ['ai.captionIdle', 'ai.captionHold', 'ai.captionOpen'];

interface HubBubbleProps {
  readonly id: HubItemId;
  readonly x: number;
  readonly y: number;
  readonly index: number;
  readonly open: boolean;
  readonly reduceMotion: boolean;
}

function HubBubble({ id, x, y, index, open, reduceMotion }: HubBubbleProps) {
  const { colors } = useTheme();
  const item = HUB_ITEM_STYLES[id];
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    const target = open ? 1 : 0;
    progress.value = reduceMotion
      ? target
      : withDelay(open ? index * 50 : 0, withSpring(target, { damping: 14, stiffness: 200 }));
  }, [open, index, reduceMotion, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    // The hub opens to the left of the button, fanned out vertically.
    transform: [
      { translateX: -x * progress.value },
      { translateY: y * progress.value },
      { scale: 0.72 + 0.28 * progress.value },
    ],
  }));

  const background =
    item.tone === 'primary' ? colors.primary : item.tone === 'accent' ? colors.accent : colors.textSecondary;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          position: 'absolute',
          right: EDGE + (FLOATING_AI_BUTTON_SIZE - item.size) / 2,
          top: FRAME_HEIGHT / 2 - item.size / 2,
          width: item.size,
          height: item.size,
          borderRadius: item.size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
        },
      ]}
    >
      <Ionicons name={item.icon} size={item.iconSize} color={colors.surface} />
    </Animated.View>
  );
}

/** Tap starts a chat; a long press fans out the radial hub. */
export function AIHubDemo() {
  const { colors } = useTheme();
  const tx = useTourText();
  const reduceMotion = useReducedMotion();
  const stage = useDemoStage({ stages: CAPTIONS.length, stepMs: 1100, endDwellMs: 2600, reduceMotion });
  const open = stage === 2;

  return (
    <DemoFrame testID="onboarding.demo.ai" height={FRAME_HEIGHT} accessibilityLabel={tx(CAPTIONS[stage])}>
      <Text style={{ position: 'absolute', left: 16, top: 14, color: colors.text, fontSize: 14, fontWeight: '700' }}>
        {tx(CAPTIONS[stage])}
      </Text>
      {FLOATING_AI_HUB_ITEMS.map((item, index) => (
        <HubBubble key={item.id} id={item.id} x={item.x} y={item.y} index={index} open={open} reduceMotion={reduceMotion} />
      ))}
      <View
        style={{
          position: 'absolute',
          right: EDGE,
          top: FRAME_HEIGHT / 2 - FLOATING_AI_BUTTON_SIZE / 2,
          width: FLOATING_AI_BUTTON_SIZE,
          height: FLOATING_AI_BUTTON_SIZE,
          borderRadius: FLOATING_AI_BUTTON_SIZE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.primary,
          borderWidth: stage === 1 ? 3 : 0,
          borderColor: `${colors.primary}66`,
          transform: [{ scale: stage === 1 ? 1.08 : 1 }],
        }}
      >
        <Ionicons name="sparkles" size={24} color={colors.surface} />
      </View>
    </DemoFrame>
  );
}
