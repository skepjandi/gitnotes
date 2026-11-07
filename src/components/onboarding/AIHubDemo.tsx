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
  readonly label: TourCopyKey;
  readonly size: number;
  readonly tone: 'primary' | 'accent' | 'muted';
}

/** Icons, labels and size tiers mirror the real FloatingAIHubMenu. */
const HUB_ITEM_STYLES: Record<HubItemId, HubItemStyle> = {
  'new-chat': { icon: 'add', label: 'ai.itemNewChat', size: 52, tone: 'primary' },
  'voice-dump': { icon: 'mic', label: 'ai.itemVoice', size: 52, tone: 'primary' },
  'chat-history': { icon: 'chatbubbles-outline', label: 'ai.itemHistory', size: 40, tone: 'muted' },
  'ai-settings': { icon: 'options-outline', label: 'ai.itemSettings', size: 40, tone: 'muted' },
  'thought-dump': { icon: 'bulb-outline', label: 'ai.itemThought', size: 46, tone: 'accent' },
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
  const tx = useTourText();
  const item = HUB_ITEM_STYLES[id];
  const scale = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    const target = open ? 1 : 0;
    scale.value = reduceMotion
      ? target
      : withDelay(open ? index * 70 : 0, withSpring(target, { damping: 13, stiffness: 220 }));
  }, [open, index, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({ opacity: scale.value, transform: [{ scale: scale.value }] }));

  const background =
    item.tone === 'primary' ? colors.accent : item.tone === 'accent' ? `${colors.accent}33` : colors.surfaceSecondary ?? colors.surface;
  const foreground = item.tone === 'primary' ? '#FFFFFF' : item.tone === 'accent' ? colors.accent : colors.textSecondary;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          position: 'absolute',
          // The hub opens to the left of the button, fanned out vertically (direction -1).
          right: EDGE + FLOATING_AI_BUTTON_SIZE / 2 + x - item.size / 2,
          top: FRAME_HEIGHT / 2 + y - item.size / 2,
          flexDirection: 'row',
          alignItems: 'center',
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={{ width: 84, marginRight: 6, textAlign: 'right', fontSize: 11, fontWeight: '600', color: colors.textSecondary }}
      >
        {tx(item.label)}
      </Text>
      <View
        style={{
          width: item.size,
          height: item.size,
          borderRadius: item.size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          borderWidth: 1,
          borderColor: item.tone === 'muted' ? colors.border : 'transparent',
        }}
      >
        <Ionicons name={item.icon} size={item.size * 0.46} color={foreground} />
      </View>
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
          backgroundColor: colors.accent,
          borderWidth: stage === 1 ? 3 : 0,
          borderColor: `${colors.accent}66`,
          transform: [{ scale: stage === 1 ? 1.08 : 1 }],
        }}
      >
        <Ionicons name="sparkles" size={24} color="#FFFFFF" />
      </View>
    </DemoFrame>
  );
}
