import {
  INK_ON_FILLED,
  ON_FILLED,
  contrastRatio,
  readableInk,
  resolveColors,
  type ThemeStyle,
} from '../../src/theme/tokens';

const STYLES: ThemeStyle[] = [
  'neumorphic',
  'flat',
  'neo-brutalist',
  'retrofuturistic',
  'terminal-mono',
  'crt-green',
  'developer-desk',
];

describe('contrastRatio', () => {
  it('is 21 for black on white and symmetric', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('is 1 for identical colors', () => {
    expect(contrastRatio('#7B8CDE', '#7B8CDE')).toBeCloseTo(1, 5);
  });
});

describe('readableInk', () => {
  it('keeps white on the iOS blue and neumorphic-light periwinkle fills', () => {
    expect(readableInk('#007AFF')).toBe(ON_FILLED);
    expect(readableInk('#7B8CDE')).toBe(ON_FILLED);
  });

  it('switches to dark ink on bright fills where white falls under 3:1', () => {
    expect(readableInk('#FFB347')).toBe(INK_ON_FILLED);
    expect(readableInk('#4ADE80')).toBe(INK_ON_FILLED);
    expect(readableInk('#00E5FF')).toBe(INK_ON_FILLED);
    expect(readableInk('#8B9BE8')).toBe(INK_ON_FILLED);
  });

  it.each(STYLES.flatMap((style) => [[style, false] as const, [style, true] as const]))(
    'gives %s (dark=%s) primary and accent fills at least 3:1 ink contrast',
    (style, isDark) => {
      const palette = resolveColors(style, isDark);
      for (const fill of [palette.primary, palette.accent]) {
        expect(contrastRatio(fill, readableInk(fill))).toBeGreaterThanOrEqual(3);
      }
    },
  );
});
