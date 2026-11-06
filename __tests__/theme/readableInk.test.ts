import { INK_ON_FILLED, ON_FILLED, contrastRatio, readableInk } from '../../src/theme/tokens';

describe('readableInk', () => {
  it('keeps white where it clears WCAG AA', () => {
    expect(readableInk('#15803D')).toBe(ON_FILLED);
    expect(contrastRatio('#15803D', ON_FILLED)).toBeGreaterThanOrEqual(4.5);
  });

  it('switches to the dark ink on mid-tone fills white cannot carry', () => {
    expect(readableInk('#7B8CDE')).toBe(INK_ON_FILLED);
    expect(contrastRatio('#7B8CDE', ON_FILLED)).toBeLessThan(4.5);
    expect(contrastRatio('#7B8CDE', INK_ON_FILLED)).toBeGreaterThanOrEqual(4.5);
  });

  it('switches to the dark ink on bright fills', () => {
    expect(readableInk('#4ADE80')).toBe(INK_ON_FILLED);
    expect(readableInk('#FBBF24')).toBe(INK_ON_FILLED);
  });

  it('always picks the higher contrast ink when neither clears AA', () => {
    const fill = '#808080';
    const onWhite = contrastRatio(fill, ON_FILLED);
    const onDark = contrastRatio(fill, INK_ON_FILLED);
    const expected = onDark > onWhite ? INK_ON_FILLED : ON_FILLED;
    expect(readableInk(fill)).toBe(expected);
  });

  it('reads white on the iOS system blue', () => {
    expect(readableInk('#007AFF')).toBe(INK_ON_FILLED);
    expect(contrastRatio('#007AFF', INK_ON_FILLED)).toBeGreaterThanOrEqual(4.5);
  });
});
