'use strict';

/**
 * Retro filter primitives for logo icon generation.
 *
 * Provides deterministic pixelation, palette mapping, dithering, and texture
 * overlay pipeline using bitmapped for the core processing.
 *
 * The module exports:
 * - FILTER_PRESETS: Five retro filter configurations
 * - paletteToRgb: Parse hex color strings to RGB arrays
 * - createImageData: Create ImageData-compatible structure
 * - applyRetroFilter: Apply pixelation, palette mapping, dithering, and texture
 */

// Initialize @napi-rs/canvas ImageData as global so bitmapped can use it in Node.js
let canvasCreate;
let ImageDataClass;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const canvasModule = require('@napi-rs/canvas');
  ImageDataClass = canvasModule.ImageData;
  canvasCreate = canvasModule.createCanvas;
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = ImageDataClass;
  }
} catch {
  // @napi-rs/canvas not available, will rely on global ImageData or fail loudly
}

const { process } = require('bitmapped');

// Palette color arrays for each preset (hex colors)
const PALETTES = {
  neon: [
    '#00ffff', '#ff00ff', '#ff66ff', '#66ffff',
    '#330066', '#0066ff', '#00ff66', '#ffff00',
    '#ff0066', '#6600ff', '#00ffcc', '#ff6600',
  ],
  gold: [
    '#ffcc00', '#ff9900', '#ff6600', '#cc9900',
    '#ffcc33', '#ffcc66', '#996600', '#cc6600',
    '#ff9933', '#ffcc99', '#996633', '#cc9966',
  ],
  'terminal-mono': [
    '#00ff00', '#33ff33', '#66ff66', '#99ff99',
    '#00cc00', '#33cc33', '#00ff33', '#00cc33',
  ],
  'amber-terminal': [
    '#ffbf00', '#ffaa00', '#ff9500', '#ff8000',
    '#ffcc33', '#ffd666', '#ffb300', '#ff9900',
    '#ffad33', '#ffc266', '#cc8800', '#ffbb00',
  ],
  'monochrome-grid': [
    '#c0c0c0', '#a0a0a0', '#808080', '#606060',
    '#404040', '#e0e0e0', '#d0d0d0', '#b0b0b0',
  ],
};

/**
 * Parse hex color strings to RGB arrays.
 * @param {string[]} hexPalette - Array of hex color strings (e.g., ['#000000', '#ffcc66'])
 * @returns {number[][]} Array of [r, g, b] arrays
 */
function paletteToRgb(hexPalette) {
  return hexPalette.map((hex) => {
    const clean = hex.replace('#', '');
    const full = clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  });
}

/**
 * Convert RGB arrays to bitmapped Palette format.
 * @param {number[][]} rgbPalette - Array of [r, g, b] arrays
 * @returns {Array<{color: {r: number, g: number, b: number}}>} bitmapped Palette
 */
function rgbToBitmappedPalette(rgbPalette) {
  return rgbPalette.map((rgb) => ({ color: { r: rgb[0], g: rgb[1], b: rgb[2] } }));
}

/**
 * Create an ImageData-compatible structure.
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @param {number[]} fill - [r, g, b, a] fill color
 * @returns {{width: number, height: number, data: Uint8ClampedArray}} ImageData-compatible object
 */
function createImageData(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3] ?? 255;
  }
  return { width, height, data };
}

/**
 * Apply deterministic scanline texture overlay.
 * Only affects opaque pixels; transparent pixels are preserved.
 * @param {Uint8ClampedArray} data - Image data (modified in place)
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} intensity - Darkening intensity (0-1)
 */
function applyScanlines(data, width, height, intensity) {
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] > 0) {
        // Darken this scanline
        data[idx] = Math.round(data[idx] * (1 - intensity));
        data[idx + 1] = Math.round(data[idx + 1] * (1 - intensity));
        data[idx + 2] = Math.round(data[idx + 2] * (1 - intensity));
      }
    }
  }
}

/**
 * Apply deterministic grid texture overlay.
 * Only affects opaque pixels; transparent pixels are preserved.
 * @param {Uint8ClampedArray} data - Image data (modified in place)
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} gridSize - Size of grid cells in pixels
 * @param {number} intensity - Darkening intensity (0-1)
 */
function applyGrid(data, width, height, gridSize, intensity) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Deterministic grid based on position (no random noise)
      const isVerticalLine = x % gridSize === 0;
      const isHorizontalLine = y % gridSize === 0;
      if ((isVerticalLine || isHorizontalLine) && (x + y) % gridSize === 0) {
        const idx = (y * width + x) * 4;
        if (data[idx + 3] > 0) {
          // Darken grid intersection
          data[idx] = Math.round(data[idx] * (1 - intensity));
          data[idx + 1] = Math.round(data[idx + 1] * (1 - intensity));
          data[idx + 2] = Math.round(data[idx + 2] * (1 - intensity));
        }
      }
    }
  }
}

// FILTER_PRESETS with distinct block sizes, palettes, dithering, and textures
const FILTER_PRESETS = {
  neon: {
    blockSize: 48,
    palette: paletteToRgb(PALETTES.neon),
    dithering: 'bayer',
    texture: 'none',
    distanceAlgorithm: 'oklab',
  },
  gold: {
    blockSize: 36,
    palette: paletteToRgb(PALETTES.gold),
    dithering: 'atkinson',
    texture: 'scanlines',
    distanceAlgorithm: 'oklab',
  },
  'terminal-mono': {
    blockSize: 32,
    palette: paletteToRgb(PALETTES['terminal-mono']),
    dithering: 'none', // nearest palette mapping
    texture: 'none',
    distanceAlgorithm: 'euclidean',
  },
  'amber-terminal': {
    blockSize: 32,
    palette: paletteToRgb(PALETTES['amber-terminal']),
    dithering: 'atkinson',
    texture: 'scanlines',
    distanceAlgorithm: 'oklab',
  },
  'monochrome-grid': {
    blockSize: 40,
    palette: paletteToRgb(PALETTES['monochrome-grid']),
    dithering: 'bayer',
    texture: 'grid',
    distanceAlgorithm: 'oklab',
  },
};

/**
 * Apply retro filter to an ImageData object.
 * Uses bitmapped for pixelation, palette mapping, and dithering.
 * Applies deterministic texture overlay (scanlines or grid) after processing.
 * Transparent pixels are preserved throughout.
 *
 * @param {{width: number, height: number, data: Uint8ClampedArray}} imageData - Source ImageData
 * @param {{blockSize: number, palette: number[][], dithering: string, texture: string, distanceAlgorithm: string}} preset - Filter preset
 * @returns {{width: number, height: number, data: Uint8ClampedArray}} Processed ImageData
 * @throws {Error} If bitmapped processing fails or ImageData is not available
 */
function applyRetroFilter(imageData, preset) {
  const { width, height, data: originalData } = imageData;

  // Verify ImageData is available (either global or @napi-rs/canvas)
  if (typeof globalThis.ImageData === 'undefined' && !ImageDataClass) {
    throw new Error('ImageData is not available. Ensure @napi-rs/canvas is installed or polyfill ImageData globally.');
  }

  // Store original alpha channel for transparent pixel preservation
  const originalAlpha = new Uint8ClampedArray(originalData.length);
  for (let i = 0; i < originalData.length; i += 4) {
    originalAlpha[i + 3] = originalData[i + 3];
  }

  // Create a copy with opaque alpha for bitmapped processing
  // (bitmapped processes all pixels including transparent ones)
  const processingData = new Uint8ClampedArray(originalData.length);
  for (let i = 0; i < originalData.length; i += 4) {
    processingData[i] = originalData[i];
    processingData[i + 1] = originalData[i + 1];
    processingData[i + 2] = originalData[i + 2];
    processingData[i + 3] = originalData[i + 3] > 0 ? 255 : 0;
  }

  // Create proper ImageData using @napi-rs/canvas if available, otherwise use global
  let processingImageData;
  if (canvasCreate && ImageDataClass) {
    // Use @napi-rs/canvas to create proper ImageData
    const canvas = canvasCreate(width, height);
    const ctx = canvas.getContext('2d');
    processingImageData = ctx.createImageData(width, height);
    processingImageData.data.set(processingData);
  } else {
    // Fall back to plain object (should work if globalThis.ImageData was polyfilled)
    processingImageData = { width, height, data: processingData };
  }

  // Apply bitmapped processing with palette
  const bitmappedPalette = rgbToBitmappedPalette(preset.palette);

  const result = process(processingImageData, {
    blockSize: preset.blockSize,
    palette: bitmappedPalette,
    dithering: preset.dithering,
    distanceAlgorithm: preset.distanceAlgorithm,
  });

  // Extract result data - use the data property from the result ImageData
  const resultData = result.imageData.data;

  // Restore original alpha channel (preserve transparent pixels)
  const outputData = new Uint8ClampedArray(originalData.length);
  for (let i = 0; i < resultData.length; i += 4) {
    outputData[i] = resultData[i];
    outputData[i + 1] = resultData[i + 1];
    outputData[i + 2] = resultData[i + 2];
    outputData[i + 3] = originalAlpha[i + 3];
  }

  // Apply deterministic texture overlay (only on opaque pixels)
  if (preset.texture === 'scanlines') {
    applyScanlines(outputData, width, height, 0.15);
  } else if (preset.texture === 'grid') {
    applyGrid(outputData, width, height, 4, 0.2);
  }

  return { width, height, data: outputData };
}

module.exports = {
  FILTER_PRESETS,
  paletteToRgb,
  createImageData,
  applyRetroFilter,
};
