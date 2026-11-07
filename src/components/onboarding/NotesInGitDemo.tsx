import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { DemoFrame, type IoniconName } from './TourPage';
import { useTourText, type TourCopyKey } from './tourCopy';
import { useDemoStage } from './useDemoStage';

interface Node {
  readonly icon: IoniconName;
  readonly label: TourCopyKey;
}

const NODES: readonly Node[] = [
  { icon: 'document-text-outline', label: 'notes.nodeNote' },
  { icon: 'git-commit-outline', label: 'notes.nodeCommit' },
  { icon: 'git-network-outline', label: 'notes.nodeRepo' },
];

const CAPTIONS: readonly TourCopyKey[] = ['notes.stageEdit', 'notes.stageCommit', 'notes.stagePush'];

/** A note's journey: edit, commit on device, push to the repo. */
export function NotesInGitDemo() {
  const { colors } = useTheme();
  const tx = useTourText();
  const reduceMotion = useReducedMotion();
  const stage = useDemoStage({ stages: NODES.length, stepMs: 1300, reduceMotion });

  return (
    <DemoFrame testID="onboarding.demo.notes" height={212} accessibilityLabel={tx(CAPTIONS[stage])}>
      <View style={{ flex: 1, paddingHorizontal: 20, justifyContent: 'center', gap: 22 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {NODES.map((node, index) => {
            const reached = index <= stage;
            return (
              <View
                key={node.label}
                style={{ flex: index < NODES.length - 1 ? 1 : undefined, flexDirection: 'row', alignItems: 'center' }}
              >
                <View style={{ alignItems: 'center', width: 64 }}>
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 26,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: reached ? colors.accent : colors.surfaceSecondary ?? colors.surface,
                      borderWidth: 1,
                      borderColor: reached ? colors.accent : colors.border,
                    }}
                  >
                    <Ionicons name={node.icon} size={24} color={reached ? '#FFFFFF' : colors.textSecondary} />
                  </View>
                  <Text
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      fontWeight: '700',
                      color: reached ? colors.text : colors.textSecondary,
                    }}
                  >
                    {tx(node.label)}
                  </Text>
                </View>
                {index < NODES.length - 1 ? (
                  <View
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 2,
                      marginBottom: 18,
                      backgroundColor: index < stage ? colors.accent : colors.border,
                    }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{tx(CAPTIONS[stage])}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{tx('notes.hosts')}</Text>
        </View>
      </View>
    </DemoFrame>
  );
}
