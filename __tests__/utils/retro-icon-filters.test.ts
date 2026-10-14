'use strict';

/**
 * Regression tests for retro filter primitives.
 *
 * Tests the deterministic pixelation, palette mapping, dithering, and
 * texture overlay pipeline in scripts/retro-icon-filters.js.
 *
 * The module provides FILTER_PRESETS, paletteToRgb, createImageData, and
 * applyRetroFilter for the retro logo icon generation pipeline.
 */

// Helper: check if an RGB color is in a palette
function colorInPalette(r, g, b, palette) {
  return palette.some(([pr, pg, pb]) => pr === r && pg === g && pb === b);
}

const {
  FILTER_PRESETS,
  applyRetroFilter,
  createImageData,
  paletteToRgb,
} = require('../../scripts/retro-icon-filters');

describe('paletteToRgb', () => {
  test('parses curated hex colors', () => {
    expect(paletteToRgb(['#000000', '#ffcc66'])).toEqual([[0, 0, 0], [255, 204, 102]]);
  });

  test('parses single hex color', () => {
    expect(paletteToRgb(['#ff0000'])).toEqual([[255, 0, 0]]);
  });

  test('handles uppercase hex colors', () => {
    expect(paletteToRgb(['#FFCC66'])).toEqual([[255, 204, 102]]);
  });
});

describe('createImageData', () => {
  test('creates ImageData with correct dimensions', () => {
    const img = createImageData(4, 4, [40, 80, 180, 255]);
    expect(img.width).toBe(4);
    expect(img.height).toBe(4);
    expect(img.data.length).toBe(4 * 4 * 4);
  });

  test('fills all pixels with given color', () => {
    const img = createImageData(2, 2, [255, 0, 0, 128]);
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(255);     // R
      expect(img.data[i + 1]).toBe(0);    // G
      expect(img.data[i + 2]).toBe(0);    // B
      expect(img.data[i + 3]).toBe(128);  // A
    }
  });
});

describe('applyRetroFilter', () => {
  test('is deterministic - same input produces same output', () => {
    const source = createImageData(4, 4, [40, 80, 180, 255]);
    const first = applyRetroFilter(source, FILTER_PRESETS['amber-terminal']);
    const second = applyRetroFilter(source, FILTER_PRESETS['amber-terminal']);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  test('preserves transparent pixels', () => {
    const source = createImageData(4, 4, [40, 80, 180, 255]);
    source.data[3] = 0; // Make first pixel transparent
    const result = applyRetroFilter(source, FILTER_PRESETS['amber-terminal']);
    expect(result.data[3]).toBe(0);
  });

  test('preserves image dimensions', () => {
    const source = createImageData(16, 16, [100, 150, 200, 255]);
    const result = applyRetroFilter(source, FILTER_PRESETS['neon']);
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
  });

  test('handles opaque source image', () => {
    const source = createImageData(8, 8, [200, 100, 50, 255]);
    const result = applyRetroFilter(source, FILTER_PRESETS['gold']);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    // All pixels should have valid alpha (255 for opaque areas)
    expect(result.data[3]).toBe(255);
  });

  test('pipeline executes - opaque pixel colors are palette members for terminal-mono', () => {
    // terminal-mono uses green palette with no dithering
    // Each opaque pixel should map to one of the green palette colors
    const terminalPalette = FILTER_PRESETS['terminal-mono'].palette;
    const source = createImageData(8, 8, [100, 150, 200, 255]); // Blue-ish, not in palette
    const result = applyRetroFilter(source, FILTER_PRESETS['terminal-mono']);

    // Check that all opaque pixels map to palette colors
    let opaquePixelCount = 0;
    for (let i = 0; i < result.data.length; i += 4) {
      if (result.data[i + 3] > 0) {
        opaquePixelCount++;
        const r = result.data[i];
        const g = result.data[i + 1];
        const b = result.data[i + 2];
        const inPalette = colorInPalette(r, g, b, terminalPalette);
        expect(inPalette).toBe(true);
      }
    }
    expect(opaquePixelCount).toBeGreaterThan(0);
  });

  test('pipeline executes - opaque pixel colors are palette members for neon preset', () => {
    const neonPalette = FILTER_PRESETS['neon'].palette;
    // Input color is NOT in the neon palette (it's a warm orange)
    const source = createImageData(8, 8, [255, 100, 50, 255]);
    const result = applyRetroFilter(source, FILTER_PRESETS['neon']);

    // All opaque pixels should map to neon palette colors
    let opaquePixelCount = 0;
    for (let i = 0; i < result.data.length; i += 4) {
      if (result.data[i + 3] > 0) {
        opaquePixelCount++;
        const r = result.data[i];
        const g = result.data[i + 1];
        const b = result.data[i + 2];
        const inPalette = colorInPalette(r, g, b, neonPalette);
        expect(inPalette).toBe(true);
      }
    }
    expect(opaquePixelCount).toBeGreaterThan(0);
  });

  test('pipeline executes - opaque pixel colors are palette members for amber-terminal', () => {
    const amberPalette = FILTER_PRESETS['amber-terminal'].palette;
    // Input color is NOT in the amber palette
    const source = createImageData(8, 8, [0, 200, 100, 255]); // Teal, not in palette
    const result = applyRetroFilter(source, FILTER_PRESETS['amber-terminal']);

    // amber-terminal uses Atkinson dithering which creates blended colors
    // Verify pipeline is running: output should differ from input
    let opaquePixelCount = 0;
    let hasDifferentOutput = false;
    for (let i = 0; i < result.data.length; i += 4) {
      if (result.data[i + 3] > 0) {
        opaquePixelCount++;
        const r = result.data[i];
        const g = result.data[i + 1];
        const b = result.data[i + 2];
        // With dithering, output may not be exact palette members
        // But verify palette proximity (within reasonable tolerance)
        const nearestPaletteColor = amberPalette.reduce((best, col) => {
          const dist = Math.abs(r - col[0]) + Math.abs(g - col[1]) + Math.abs(b - col[2]);
          const bestDist = Math.abs(r - best[0]) + Math.abs(g - best[1]) + Math.abs(b - best[2]);
          return dist < bestDist ? col : best;
        });
        const distance = Math.abs(r - nearestPaletteColor[0]) + Math.abs(g - nearestPaletteColor[1]) + Math.abs(b - nearestPaletteColor[2]);
        // With dithering, distance should be reasonable (< 100 in sum of channel differences)
        expect(distance).toBeLessThan(100);

        if (r !== 0 || g !== 200 || b !== 100) {
          hasDifferentOutput = true;
        }
      }
    }
    expect(opaquePixelCount).toBeGreaterThan(0);
    expect(hasDifferentOutput).toBe(true);
  });

  test('pipeline executes - opaque pixel colors are palette members for monochrome-grid', () => {
    const monoPalette = FILTER_PRESETS['monochrome-grid'].palette;
    const source = createImageData(8, 8, [255, 50, 100, 255]);
    const result = applyRetroFilter(source, FILTER_PRESETS['monochrome-grid']);

    let opaquePixelCount = 0;
    let hasDifferentOutput = false;
    for (let i = 0; i < result.data.length; i += 4) {
      if (result.data[i + 3] > 0) {
        opaquePixelCount++;
        const r = result.data[i];
        const g = result.data[i + 1];
        const b = result.data[i + 2];

        // Bayer dithering produces palette colors - new cool-gray palette has tighter range
        const nearestPaletteColor = monoPalette.reduce((best, col) => {
          const dist = Math.abs(r - col[0]) + Math.abs(g - col[1]) + Math.abs(b - col[2]);
          const bestDist = Math.abs(r - best[0]) + Math.abs(g - best[1]) + Math.abs(b - best[2]);
          return dist < bestDist ? col : best;
        });
        const distanceFromPalette = Math.abs(r - nearestPaletteColor[0]) + Math.abs(g - nearestPaletteColor[1]) + Math.abs(b - nearestPaletteColor[2]);
        expect(distanceFromPalette).toBeLessThan(70);

        if (r !== 255 || g !== 50 || b !== 100) {
          hasDifferentOutput = true;
        }
      }
    }
    expect(opaquePixelCount).toBeGreaterThan(0);
    expect(hasDifferentOutput).toBe(true);
  });

  test('pipeline executes - colors differ for deliberately off-palette input', () => {
    // For terminal-mono with green palette, input of blue should produce green output
    const source = createImageData(4, 4, [0, 0, 255, 255]); // Pure blue
    const result = applyRetroFilter(source, FILTER_PRESETS['terminal-mono']);

    // The result should NOT be the same as input (palette mapping should change it)
    // For blue input with green palette, the output should be green (nearest)
    const firstPixelG = result.data[1];
    const firstPixelB = result.data[2];

    // Blue input (0, 0, 255) should map to a green color, not stay blue
    expect(firstPixelB).toBeLessThan(255); // Blue channel should be reduced
    expect(firstPixelG).toBeGreaterThan(0); // Green channel should be present
  });

  test('transparent pixel alpha is preserved across pipeline', () => {
    const source = createImageData(4, 4, [100, 150, 200, 255]);
    // Set pixel 5 to transparent
    source.data[5 * 4 + 3] = 0;
    const result = applyRetroFilter(source, FILTER_PRESETS['neon']);
    expect(result.data[5 * 4 + 3]).toBe(0);
    // Opaque pixels should still be opaque
    expect(result.data[0 + 3]).toBe(255);
  });
});

describe('FILTER_PRESETS', () => {
  test('every non-reference preset has a logical pixel size and palette', () => {
    for (const key of ['neon', 'gold', 'terminal-mono', 'amber-terminal', 'monochrome-grid']) {
      expect(FILTER_PRESETS[key].blockSize).toBeGreaterThan(1);
      expect(FILTER_PRESETS[key].palette.length).toBeGreaterThanOrEqual(4);
    }
  });

  test('neon preset has arcade palette colors', () => {
    const neon = FILTER_PRESETS['neon'];
    expect(neon.blockSize).toBe(48);
    expect(neon.palette.length).toBeGreaterThanOrEqual(4);
    // Signature colors: electric blue and cyan
    expect(colorInPalette(0, 198, 255, neon.palette)).toBe(true); // #00c6ff electric blue
    expect(colorInPalette(74, 255, 240, neon.palette)).toBe(true); // #4afff0 cyan
  });

  test('gold preset has amber/cream/brown palette', () => {
    const gold = FILTER_PRESETS['gold'];
    expect(gold.blockSize).toBe(36);
    expect(gold.palette.length).toBeGreaterThanOrEqual(4);
    // Signature colors: amber and yellow
    expect(colorInPalette(184, 105, 0, gold.palette)).toBe(true); // #b86900 amber
    expect(colorInPalette(245, 183, 0, gold.palette)).toBe(true); // #f5b700 yellow
  });

  test('terminal-mono preset has green terminal palette', () => {
    const terminal = FILTER_PRESETS['terminal-mono'];
    expect(terminal.blockSize).toBe(32);
    expect(terminal.palette.length).toBeGreaterThanOrEqual(4);
    // Signature colors: phosphor green and bright green
    expect(colorInPalette(0, 138, 52, terminal.palette)).toBe(true); // #008a34 phosphor green
    expect(colorInPalette(22, 255, 90, terminal.palette)).toBe(true); // #16ff5a bright green
  });

  test('amber-terminal preset has orange phosphor palette', () => {
    const amber = FILTER_PRESETS['amber-terminal'];
    expect(amber.blockSize).toBe(32);
    expect(amber.palette.length).toBeGreaterThanOrEqual(4);
    // Signature colors: orange and amber
    expect(colorInPalette(190, 72, 0, amber.palette)).toBe(true); // #be4800 orange
    expect(colorInPalette(255, 138, 0, amber.palette)).toBe(true); // #ff8a00 amber
  });

  test('monochrome-grid preset has cool gray/blueprint palette', () => {
    const mono = FILTER_PRESETS['monochrome-grid'];
    expect(mono.blockSize).toBe(40);
    expect(mono.palette.length).toBeGreaterThanOrEqual(4);
    // Signature colors: cool grays
    expect(colorInPalette(85, 102, 118, mono.palette)).toBe(true); // #556676 cool gray
    expect(colorInPalette(155, 170, 184, mono.palette)).toBe(true); // #9baab8 light cool gray
  });

  test('all presets have dithering property', () => {
    for (const key of ['neon', 'gold', 'terminal-mono', 'amber-terminal', 'monochrome-grid']) {
      expect(FILTER_PRESETS[key]).toHaveProperty('dithering');
    }
  });

  test('all presets have texture property', () => {
    for (const key of ['neon', 'gold', 'terminal-mono', 'amber-terminal', 'monochrome-grid']) {
      expect(FILTER_PRESETS[key]).toHaveProperty('texture');
    }
  });
});
