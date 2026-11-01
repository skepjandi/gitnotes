import { buildElevation } from '../../../src/theme/elevation';
import { SPACING, type ThemeStyle } from '../../../src/theme/tokens';

const HEADING_PADDING = 16;
const GROUP_ROW_PADDING = SPACING[4];

const BORDERED_THEMES: ThemeStyle[] = [
  'flat',
  'neumorphic',
  'neo-brutalist',
  'retrofuturistic',
  'terminal-mono',
  'crt-green',
  'developer-desk',
];

function borderWidthFor(style: ThemeStyle, platform: 'ios' | 'android'): number {
  const { outer } = buildElevation({
    tier: 'raised',
    inset: false,
    style,
    colors: {
      bg: '#000', surface: '#111', highlight: '#222', shadow: '#000', text: '#fff',
      textSecondary: '#aaa', accent: '#0af', accentMuted: '#08a', error: '#f00',
      success: '#0f0', warning: '#fa0', background: '#000', surfaceSecondary: '#222',
      primary: '#0af', border: '#f0f', card: '#111', elevated: '#222',
    },
    platform,
  });
  return (outer.borderWidth as number | undefined) ?? 0;
}

describe('app-icon picker heading clearance across themes', () => {
  it('heading inset clears the widest surface border in every theme', () => {
    for (const style of BORDERED_THEMES) {
      for (const platform of ['ios', 'android'] as const) {
        const borderWidth = borderWidthFor(style, platform);
        expect(HEADING_PADDING).toBeGreaterThan(borderWidth);
      }
    }
  });

  it('heading inset matches the GroupRow content inset', () => {
    expect(HEADING_PADDING).toBe(GROUP_ROW_PADDING);
  });
});
