/**
 * Onboarding feature tour: every page renders, the scripted demos step
 * through the behaviour they explain, reduced motion rests on a complete
 * state, and the English copy in en.json stays in sync with tourCopy.ts.
 */
import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
import enLocale from '@/i18n/en.json';
import { TOUR_COPY } from '@/components/onboarding/tourCopy';
import { OnboardingTour, TOUR_PAGE_IDS } from '@/components/onboarding/OnboardingTour';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { useDemoStage } from '@/components/onboarding/useDemoStage';

let mockReduceMotion = false;

jest.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
}));

jest.mock('@/contexts/ThemeContext', () => {
  const colors = {
    background: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    accent: '#0066ff',
    primary: '#0066ff',
    error: '#ff0000',
    surface: '#ffffff',
    border: '#dddddd',
    card: '#eeeeee',
    success: '#00aa00',
    warning: '#ffaa00',
  };
  return {
    useTheme: () => ({ colors, style: {}, isDark: false }),
    useTokens: () => ({
      colors,
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
      radii: { sm: 4, md: 8, lg: 16, pill: 9999 },
      type: 'light' as const,
    }),
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let text = String(options?.defaultValue ?? key);
      for (const [name, value] of Object.entries(options ?? {})) {
        text = text.replace(`{{${name}}}`, String(value));
      }
      return text;
    },
  }),
}));

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const passthrough = (name: string) => {
    const Component = ({ children, ...rest }: { children?: React.ReactNode }) =>
      React.createElement(View, rest, children);
    Component.displayName = name;
    return Component;
  };
  return { __esModule: true, Svg: passthrough('Svg'), Path: passthrough('Path'), default: passthrough('Svg') };
});

beforeEach(() => {
  mockReduceMotion = false;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('tour copy', () => {
  it('en.json mirrors every string in tourCopy.ts', () => {
    for (const [key, value] of Object.entries(TOUR_COPY)) {
      let node: unknown = enLocale.onboarding.tour;
      for (const part of key.split('.')) {
        node = node !== null && typeof node === 'object' && part in node ? Reflect.get(node, part) : undefined;
      }
      expect({ key, value: node }).toEqual({ key, value });
    }
  });
});

describe('useDemoStage', () => {
  it('advances on each step and dwells on the last stage before looping', () => {
    const { result } = renderHook(() => useDemoStage({ stages: 3, stepMs: 100, endDwellMs: 500, reduceMotion: false }));
    expect(result.current).toBe(0);
    act(() => jest.advanceTimersByTime(100));
    expect(result.current).toBe(1);
    act(() => jest.advanceTimersByTime(100));
    expect(result.current).toBe(2);
    act(() => jest.advanceTimersByTime(499));
    expect(result.current).toBe(2);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(0);
  });

  it('holds the rest stage and never schedules timers under reduced motion', () => {
    const { result } = renderHook(() =>
      useDemoStage({ stages: 4, stepMs: 100, restStage: 2, reduceMotion: true }),
    );
    expect(result.current).toBe(2);
    act(() => jest.advanceTimersByTime(10_000));
    expect(result.current).toBe(2);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('OnboardingTour pages', () => {
  it.each(TOUR_PAGE_IDS)('renders the %s page with its title and explanation', (page) => {
    const { getByTestId, getByText } = render(<OnboardingTour page={page} />);
    expect(getByTestId(`onboarding.page.${page}`)).toBeTruthy();
    expect(getByText(TOUR_COPY[`${page}.title`])).toBeTruthy();
    expect(getByText(TOUR_COPY[`${page}.body`])).toBeTruthy();
  });

  it('explains both gestures of the Git button and the colour legend', () => {
    const { getByText } = render(<OnboardingTour page="git" />);
    expect(getByText(TOUR_COPY['git.p1.lead'])).toBeTruthy();
    expect(getByText(TOUR_COPY['git.p2.lead'])).toBeTruthy();
    expect(getByText(TOUR_COPY['git.legendChanges'])).toBeTruthy();
    expect(getByText(TOUR_COPY['git.legendSynced'])).toBeTruthy();
  });

  it('marks Pro features on the AI and capture pages', () => {
    const ai = render(<OnboardingTour page="ai" />);
    expect(ai.getAllByText(TOUR_COPY.proBadge).length).toBeGreaterThan(0);
    ai.unmount();
    const capture = render(<OnboardingTour page="capture" />);
    expect(capture.getAllByText(TOUR_COPY.proBadge)).toHaveLength(3);
    expect(capture.getByText(TOUR_COPY['capture.footnote'])).toBeTruthy();
  });
});

describe('scripted demos', () => {
  it('Git demo plays idle, stage, commit, push, then synced, and loops', () => {
    const { getByText, queryByText } = render(<OnboardingTour page="git" />);
    // The caption sits in the demo; the page copy never reuses these strings.
    expect(getByText(TOUR_COPY['git.captionIdle'])).toBeTruthy();
    act(() => jest.advanceTimersByTime(950));
    expect(getByText(TOUR_COPY['git.captionStage'])).toBeTruthy();
    act(() => jest.advanceTimersByTime(950));
    expect(getByText(TOUR_COPY['git.captionCommit'])).toBeTruthy();
    act(() => jest.advanceTimersByTime(950));
    expect(getByText(TOUR_COPY['git.captionPush'])).toBeTruthy();
    act(() => jest.advanceTimersByTime(950));
    expect(getByText(TOUR_COPY['git.captionDone'])).toBeTruthy();
    expect(queryByText(TOUR_COPY['git.captionIdle'])).toBeNull();
    act(() => jest.advanceTimersByTime(2000));
    expect(getByText(TOUR_COPY['git.captionIdle'])).toBeTruthy();
  });

  it('Git demo rests on the fully armed ring under reduced motion', () => {
    mockReduceMotion = true;
    const { getByText } = render(<OnboardingTour page="git" />);
    expect(getByText(TOUR_COPY['git.captionPush'])).toBeTruthy();
    act(() => jest.advanceTimersByTime(10_000));
    expect(getByText(TOUR_COPY['git.captionPush'])).toBeTruthy();
  });

  it('AI demo goes from a tap hint to a held press to the opened hub', () => {
    const { getByText } = render(<OnboardingTour page="ai" />);
    expect(getByText(TOUR_COPY['ai.captionIdle'])).toBeTruthy();
    act(() => jest.advanceTimersByTime(1100));
    expect(getByText(TOUR_COPY['ai.captionHold'])).toBeTruthy();
    act(() => jest.advanceTimersByTime(1100));
    expect(getByText(TOUR_COPY['ai.captionOpen'])).toBeTruthy();
  });

  it('AI demo lists all five hub entries', () => {
    const { getByText } = render(<OnboardingTour page="ai" />);
    for (const key of ['ai.itemNewChat', 'ai.itemVoice', 'ai.itemHistory', 'ai.itemSettings', 'ai.itemThought'] as const) {
      expect(getByText(TOUR_COPY[key])).toBeTruthy();
    }
  });

  it('Notes demo walks edit, commit, push', () => {
    const { getByText } = render(<OnboardingTour page="notes" />);
    expect(getByText(TOUR_COPY['notes.stageEdit'])).toBeTruthy();
    act(() => jest.advanceTimersByTime(1300));
    expect(getByText(TOUR_COPY['notes.stageCommit'])).toBeTruthy();
    act(() => jest.advanceTimersByTime(1300));
    expect(getByText(TOUR_COPY['notes.stagePush'])).toBeTruthy();
  });
});

describe('OnboardingProgress', () => {
  it('reports a 1-based position to assistive tech', () => {
    const { getByTestId } = render(<OnboardingProgress current={2} total={8} />);
    const bar = getByTestId('onboarding.progress');
    expect(bar.props.accessibilityValue).toEqual({ min: 1, max: 8, now: 3 });
    expect(bar.props.accessibilityLabel).toBe('Step 3 of 8');
  });
});
