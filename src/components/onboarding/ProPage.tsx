import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { Surface } from '../ui/Surface';
import { TourPage, type IoniconName } from './TourPage';
import { useTourText, type TourCopyKey } from './tourCopy';

const PRO_FEATURES: readonly { icon: IoniconName; label: TourCopyKey }[] = [
  { icon: 'sparkles-outline', label: 'pro.ai' },
  { icon: 'mic-outline', label: 'pro.dump' },
  { icon: 'chatbox-ellipses-outline', label: 'pro.quotes' },
  { icon: 'brush-outline', label: 'pro.canvases' },
  { icon: 'copy-outline', label: 'pro.templates' },
  { icon: 'git-branch-outline', label: 'pro.more' },
];

interface ProPageProps {
  readonly onOpenSettings: () => void;
}

/** Last page: what the free plan covers and what Pro adds. */
export function ProPage({ onOpenSettings }: ProPageProps) {
  const { colors } = useTheme();
  const tx = useTourText();
  return (
    <TourPage
      testID="onboarding.page.pro"
      eyebrow={tx('pro.proTitle')}
      title={tx('pro.title')}
      body={tx('pro.freeBody')}
      demo={
        <Surface elevation="raised" radius="lg" style={{ width: '100%', padding: 16, gap: 4 }}>
          {PRO_FEATURES.map((feature) => (
            <View key={feature.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 }}>
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: `${colors.accent}1F`,
                }}
              >
                <Ionicons name={feature.icon} size={16} color={colors.accent} />
              </View>
              <Text style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' }}>{tx(feature.label)}</Text>
              <Ionicons name="checkmark" size={18} color={colors.accent} />
            </View>
          ))}
        </Surface>
      }
      footnote={tx('pro.reminder')}
    >
      <TouchableOpacity
        testID="onboarding.button.configure-api-key"
        accessibilityRole="button"
        onPress={onOpenSettings}
        style={{ alignSelf: 'flex-start', marginTop: 8, paddingVertical: 8 }}
      >
        <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '700' }}>{tx('pro.settings')}</Text>
      </TouchableOpacity>
    </TourPage>
  );
}
