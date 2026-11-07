import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Path, Svg } from 'react-native-svg';
import { useTheme } from '../../contexts/ThemeContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Surface } from '../ui/Surface';
import { DemoFrame } from './TourPage';
import { useTourText, type TourCopyKey } from './tourCopy';
import { useDemoStage } from './useDemoStage';

const BUTTON_SIZE = 56;
const RING_STROKE = 3.5;
const RING_RADIUS = BUTTON_SIZE / 2 + 6;
const CANVAS = RING_RADIUS * 2 + RING_STROKE * 2 + 4;
const CENTER = CANVAS / 2;
const SEGMENT_DEGREES = 116;
const AMBER = '#f59e0b';

/** Stages: 0 idle, 1 stage armed, 2 commit armed, 3 push armed, 4 synced. */
const STAGES = 5;
const CAPTIONS: readonly TourCopyKey[] = [
  'git.captionIdle',
  'git.captionStage',
  'git.captionCommit',
  'git.captionPush',
  'git.captionDone',
];

function arcPath(index: number): string {
  const start = ((-90 + index * 120 + 2) * Math.PI) / 180;
  const end = start + (SEGMENT_DEGREES * Math.PI) / 180;
  const x1 = CENTER + RING_RADIUS * Math.cos(start);
  const y1 = CENTER + RING_RADIUS * Math.sin(start);
  const x2 = CENTER + RING_RADIUS * Math.cos(end);
  const y2 = CENTER + RING_RADIUS * Math.sin(end);
  return `M ${x1} ${y1} A ${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${x2} ${y2}`;
}

const ARCS = [0, 1, 2].map(arcPath);

/** Auto-plays the real button's hold gesture: ring fills in thirds. */
export function GitButtonDemo() {
  const { colors } = useTheme();
  const tx = useTourText();
  const reduceMotion = useReducedMotion();
  const stage = useDemoStage({ stages: STAGES, stepMs: 950, endDwellMs: 2000, restStage: 3, reduceMotion });

  const primary = colors.primary ?? colors.accent;
  const segmentColors = [colors.success, AMBER, primary];
  const synced = stage === STAGES - 1;
  const buttonColor = synced ? colors.surface : colors.success;

  const steps: readonly { key: TourCopyKey; color: string }[] = [
    { key: 'git.stepStage', color: segmentColors[0] },
    { key: 'git.stepCommit', color: segmentColors[1] },
    { key: 'git.stepPush', color: segmentColors[2] },
  ];
  const legend: readonly { key: TourCopyKey; color: string }[] = [
    { key: 'git.legendChanges', color: colors.success },
    { key: 'git.legendStaged', color: AMBER },
    { key: 'git.legendUnpushed', color: primary },
    { key: 'git.legendSynced', color: colors.textSecondary },
  ];

  return (
    <DemoFrame testID="onboarding.demo.git" height={262} accessibilityLabel={tx(CAPTIONS[stage])}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 14 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{tx(CAPTIONS[stage])}</Text>

        <View style={{ width: CANVAS, height: CANVAS, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={CANVAS} height={CANVAS} style={{ position: 'absolute' }}>
            {ARCS.map((d, index) => (
              <Path
                key={d}
                d={d}
                fill="none"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                stroke={stage > index && !synced ? segmentColors[index] : colors.border}
                opacity={stage > index && !synced ? 1 : 0.55}
              />
            ))}
          </Svg>
          <Surface
            elevation="raised"
            radius="pill"
            style={{
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: buttonColor,
            }}
          >
            <Ionicons
              name="git-pull-request-outline"
              size={24}
              color={synced ? colors.textSecondary : '#FFFFFF'}
            />
            {!synced ? (
              <View
                style={{
                  position: 'absolute',
                  right: -4,
                  top: -4,
                  minWidth: 20,
                  paddingHorizontal: 4,
                  paddingVertical: 1,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: colors.card ?? colors.surface,
                  backgroundColor: colors.error,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800' }}>3</Text>
              </View>
            ) : null}
          </Surface>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {steps.map((step, index) => {
            const armed = stage > index && !synced;
            return (
              <View
                key={step.key}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: armed ? step.color : 'transparent',
                  borderWidth: 1,
                  borderColor: armed ? step.color : colors.border,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: armed ? '#FFFFFF' : colors.textSecondary }}>
                  {index + 1}  {tx(step.key)}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 12 }}>
          {legend.map((item) => (
            <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }} />
              <Text style={{ fontSize: 11, color: colors.textSecondary }}>{tx(item.key)}</Text>
            </View>
          ))}
        </View>
      </View>
    </DemoFrame>
  );
}
