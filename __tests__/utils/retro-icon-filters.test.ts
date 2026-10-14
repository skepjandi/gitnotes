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
  });

  test('gold preset has amber/cream/brown palette', () => {
    const gold = FILTER_PRESETS['gold'];
    expect(gold.blockSize).toBe(36);
    expect(gold.palette.length).toBeGreaterThanOrEqual(4);
  });

  test('terminal-mono preset has green terminal palette', () => {
    const terminal = FILTER_PRESETS['terminal-mono'];
    expect(terminal.blockSize).toBe(32);
    expect(terminal.palette.length).toBeGreaterThanOrEqual(4);
  });

  test('amber-terminal preset has orange phosphor palette', () => {
    const amber = FILTER_PRESETS['amber-terminal'];
    expect(amber.blockSize).toBe(32);
    expect(amber.palette.length).toBeGreaterThanOrEqual(4);
  });

  test('monochrome-grid preset has cool gray/blueprint palette', () => {
    const mono = FILTER_PRESETS['monochrome-grid'];
    expect(mono.blockSize).toBe(40);
    expect(mono.palette.length).toBeGreaterThanOrEqual(4);
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
