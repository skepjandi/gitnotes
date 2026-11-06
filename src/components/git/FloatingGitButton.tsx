import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { Surface } from '@/components/ui/Surface';
import { Text } from '@/components/ui/text';
import GitButtonHalo from './GitButtonHalo';
import { GIT_BUTTON_SIZE } from './gitButtonGeometry';
import { useTheme } from '@/contexts/ThemeContext';
import type { AggregatedGitState } from '@/hooks/useAllReposStatus';
import { useFloatingGitButtonPosition } from './useFloatingGitButtonPosition';
import { useFloatingGitButtonPanGesture } from './useFloatingGitButtonPanGesture';
import {
  useFloatingGitButtonAffordances,
  PRESS_SCALE_FACTOR,
  type ReleaseSegment,
} from './useFloatingGitButtonAffordances';
import { useFloatingButtonCollision } from '../floatingButtonLayout';
import { GitButtonRing } from './GitButtonRing';
import { ON_FILLED } from '../../theme/tokens';

interface FloatingGitButtonProps {
  aggregatedState?: AggregatedGitState;
  /** Informational tap — jumps to the Explore section with pending work. */
  onQuickTap?: () => void;
  /** Called once on release with the highest segment reached: stage (≥1/3), commit (≥2/3), push (=1). */
  onReleaseSegment?: (segment: ReleaseSegment) => void;
  /** Nothing pending anywhere: gray the button out and ignore taps. */
  disabled?: boolean;
}

/**
 * Floating git status button — purely informational (issue #1330):
 *   - Tap  → jump to the Explore section holding the pending work
 *            (changes / staging / commits / conflicts)
 *   - Drag → reposition; auto-snap to nearest edge; auto-avoid the AI button
 *   - Hold → nothing (no action menu — this is not a quick-action button)
 *
 * When nothing is pending (no uncommitted, staged, ahead, or conflicts) the
 * button is grayed out and ignores taps. Status hue ring priority:
 * red (conflicts) > blue (pending push) > green (pending changes).
 */
export default function FloatingGitButton({
  aggregatedState,
  onQuickTap,
  onReleaseSegment,
  disabled = false,
}: FloatingGitButtonProps) {
  const { colors } = useTheme();

  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(true);
  const [reduceMotionResolved, setReduceMotionResolved] = useState(false);

  useEffect(() => {
    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!isMounted) return;
      setReduceMotionEnabled(enabled);
      setReduceMotionResolved(true);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        setReduceMotionEnabled(enabled);
        setReduceMotionResolved(true);
      },
    );

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  const state: AggregatedGitState = aggregatedState ?? {
    perRepo: new Map(),
    totalUncommitted: 0,
    totalStaged: 0,
    totalAhead: 0,
    anyConflicts: false,
    anyBusy: false,
    latestChangedRepoId: null,
    mode: 'clean',
    refresh: async () => undefined,
  };

  const { mode, totalUncommitted, totalStaged, totalAhead, anyConflicts } = state;
  const actionCount = totalUncommitted + totalStaged + totalAhead;

  const palette = (() => {
    if (disabled) return { bg: colors.surface, fg: colors.textSecondary };
    if (anyConflicts) return { bg: colors.error, fg: ON_FILLED };
    if (totalStaged > 0) return { bg: colors.warning, fg: ON_FILLED };
    if (totalUncommitted > 0) return { bg: colors.success, fg: ON_FILLED };
    if (totalAhead > 0) return { bg: colors.primary, fg: ON_FILLED };
    return { bg: colors.surface, fg: colors.textSecondary };
  })();

  const hueColor = (() => {
    if (disabled) return null;
    if (anyConflicts) return colors.error;
    if (totalStaged > 0) return colors.warning;
    if (totalUncommitted > 0) return colors.success;
    if (totalAhead > 0) return colors.primary;
    return null;
  })();

  const position = useFloatingGitButtonPosition();
  useFloatingButtonCollision('stage', {
    translateX: position.translateX,
    translateY: position.translateY,
    dragActive: position.dragActive,
    size: GIT_BUTTON_SIZE,
    geometry: position.geometry,
  });

  const affordances = useFloatingGitButtonAffordances({
    reduceMotionEnabled,
    reduceMotionResolved,
    menuOpen: false,
    onReleaseSegment,
  });

  const { entranceProgress, pressProgress, holdProgress } = affordances;
  const { translateX, translateY } = position;

  const handleTap = useCallback(() => {
    if (disabled) return;
    const wasHoldRelease = holdProgress.value >= 1 / 3;
    if (wasHoldRelease) return;
    if (panBeganRef.current) return;
    onQuickTap?.();
  }, [disabled, onQuickTap, holdProgress]);

  const panBeganRef = useRef(false);

  const setPanBegan = useCallback((began: boolean) => {
    panBeganRef.current = began;
  }, []);

  const panGesture = useFloatingGitButtonPanGesture(position, {
    closeMenu: () => undefined,
    setHorizontalDirection: () => undefined,
    setVerticalDirection: () => undefined,
    cancelAffordances: affordances.cancelAffordances,
    setPanBegan,
  });

  const containerStyle = useAnimatedStyle(() => ({
    opacity: entranceProgress.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: 1 - PRESS_SCALE_FACTOR * pressProgress.value },
    ],
  }));

  return (
    <Animated.View
      testID="gitbutton.root"
      pointerEvents="box-none"
      style={[styles.container, containerStyle]}
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View
          testID="gitbutton.frame"
          style={[styles.buttonFrame, disabled ? styles.disabledFrame : null]}
        >
          <GitButtonHalo
            active={hueColor !== null}
            color={hueColor ?? undefined}
            testID="gitbutton.halo"
          />
          <GitButtonRing
            progress={holdProgress}
            colors={[colors.success, colors.warning, colors.primary]}
          />
          <Pressable
            testID="gitbutton.press"
            onPress={handleTap}
            onPressIn={affordances.handlePressIn}
            onPressOut={affordances.handlePressOut}
            onLongPress={affordances.handleHoldComplete}
            delayLongPress={3000}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={
              disabled
                ? 'Git status: everything is committed and pushed'
                : anyConflicts
                  ? 'Git: conflicts need attention — tap to review'
                  : `Git: ${actionCount} pending ${actionCount === 1 ? 'item' : 'items'} — tap to review`
            }
            accessibilityState={{ disabled }}
          >
            <Surface
              elevation={Platform.OS === 'android' ? 'flat' : 'raised'}
              radius="pill"
              testID="gitbutton.surface"
              style={{
                backgroundColor: palette.bg,
                width: GIT_BUTTON_SIZE,
                height: GIT_BUTTON_SIZE,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={mode === 'conflicts' ? 'warning-outline' : 'git-pull-request-outline'}
                size={24}
                color={palette.fg}
                testID="gitbutton.icon"
              />
              {actionCount > 0 && (
                <View
                  testID="gitbutton.badge"
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    right: -4,
                    top: -4,
                    minWidth: 20,
                    paddingHorizontal: 4,
                    paddingVertical: 1,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: colors.background,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text className="text-[10px] font-bold text-foreground">
                    {actionCount > 99 ? '99+' : actionCount}
                  </Text>
                </View>
              )}
            </Surface>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: GIT_BUTTON_SIZE,
    height: GIT_BUTTON_SIZE,
  },
  buttonFrame: {
    width: GIT_BUTTON_SIZE,
    height: GIT_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledFrame: {
    opacity: 0.5,
  },
});
