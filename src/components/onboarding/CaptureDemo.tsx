import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { DemoFrame, ProChip, type IoniconName } from './TourPage';
import { useTourText, type TourCopyKey } from './tourCopy';
import { useDemoStage } from './useDemoStage';

interface Tile {
  readonly icon: IoniconName;
  readonly lead: TourCopyKey;
  readonly text: TourCopyKey;
  readonly pro: boolean;
}

/** Pro flags follow the copy in `onboarding.tour.pro.*` (canvases, templates, thought dump). */
const TILES: readonly Tile[] = [
  { icon: 'bulb-outline', lead: 'capture.thought.lead', text: 'capture.thought.text', pro: true },
  { icon: 'calendar-outline', lead: 'capture.journal.lead', text: 'capture.journal.text', pro: false },
  { icon: 'brush-outline', lead: 'capture.canvas.lead', text: 'capture.canvas.text', pro: true },
  { icon: 'copy-outline', lead: 'capture.templates.lead', text: 'capture.templates.text', pro: true },
  { icon: 'notifications-outline', lead: 'capture.reminders.lead', text: 'capture.reminders.text', pro: false },
  { icon: 'git-network-outline', lead: 'capture.links.lead', text: 'capture.links.text', pro: false },
];

/** Six capture tools; the spotlight walks through them. */
export function CaptureDemo() {
  const { colors } = useTheme();
  const tx = useTourText();
  const reduceMotion = useReducedMotion();
  const active = useDemoStage({ stages: TILES.length, stepMs: 1100, endDwellMs: 1100, reduceMotion });

  return (
    <DemoFrame testID="onboarding.demo.capture">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 12 }}>
        {TILES.map((tile, index) => {
          const spotlight = !reduceMotion && index === active;
          return (
            <View
              key={tile.lead}
              style={{
                width: '48%',
                flexGrow: 1,
                gap: 8,
                padding: 12,
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: spotlight ? colors.accent : colors.border,
                backgroundColor: spotlight ? `${colors.accent}14` : 'transparent',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Ionicons name={tile.icon} size={22} color={spotlight ? colors.accent : colors.text} />
                {tile.pro ? <ProChip /> : null}
              </View>
              <View>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{tx(tile.lead)}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 1 }}>
                  {tx(tile.text)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </DemoFrame>
  );
}
