#!/usr/bin/env node
/**
 * Branding asset pipeline — single-master-SVG → generated app assets.
 *
 * Reads `assets/logo.svg` (the one source of truth) and writes high-resolution
 * PNG branding assets into `assets/generated/`:
 *
 *   icon.png            1024×1024  iOS / Expo generic app icon (no rounded corners)
 *   adaptive-icon.png   1024×1024  Android adaptive icon FOREGROUND (transparent bg)
 *   splash-icon.png     1024×1024  square splash source, logo ≈ image width
 *                                  (on-screen size = app.json imageWidth: 300dp ≈ 75% device width)
 *   favicon.png          512×512   web favicon source
 *   monochrome-icon.png 1024×1024  Android themed icon — grayscale depth mask
 *
 * Plus alternate icon families under `assets/generated/alternate/{variant}/`:
 *   icon.png            1024×1024  iOS / Expo alternate app icon
 *   adaptive-icon.png   1024×1024  Android adaptive icon FOREGROUND
 *   monochrome-icon.png 1024×1024  Android themed icon foreground mask
 *
 * Seven palette variants:
 *   base              — EXACT byte-for-byte copy of top-level defaults (icon.png,
 *                        adaptive-icon.png, monochrome-icon.png).  DO NOT pass through
 *                        recolorBuffer — hueShift=0 still causes rounding differences.
 *   grayscale         — neutral luminance mask (HSV recolor)
 *   neon              — retro pixel-art filter with cyan/violet arcade palette
 *   gold              — retro pixel-art filter with amber/cream palette + scanlines
 *   terminal-mono     — retro pixel-art filter with green terminal palette
 *   amber-terminal    — retro pixel-art filter with orange phosphor palette + scanlines
 *   monochrome-grid   — retro pixel-art filter with cool gray palette + grid texture
 *
 * The artwork is auto-cropped to its alpha bounding box, scaled to a target
 * fraction of the canvas (safe padding), and composited centered on a
 * transparent square canvas. Aspect ratio is preserved throughout, so the
 * rendered logo is always square.
 *
 * Usage:
 *   node scripts/generate-branding.js          # generate all assets
 *   node scripts/generate-branding.js --check  # verify all outputs
 *
 * Exit code is non-zero on any failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const MASTER_SVG = path.join(ROOT, 'assets', 'logo.svg');
const OUT_DIR = path.join(ROOT, 'assets', 'generated');
const ALTERNATE_DIR = path.join(OUT_DIR, 'alternate');

const RENDER_PREVIEW_SIZE = 2048;
const KERNEL = sharp.kernel.lanczos3;

// Retro filter integration
const {
  FILTER_PRESETS,
  createImageData: makeRetroImageData,
  applyRetroFilter,
} = require('./retro-icon-filters');

const TARGETS = [
  { name: 'icon.png', size: 1024, fraction: 0.82 },
  { name: 'adaptive-icon.png', size: 1024, fraction: 0.5 },
  { name: 'splash-icon.png', size: 1024, fraction: 0.96 },
  { name: 'favicon.png', size: 512, fraction: 0.85 },
  { name: 'monochrome-icon.png', size: 1024, fraction: 0.5, monochrome: true },
];

const VARIANT_TARGET_NAMES = ['icon.png', 'adaptive-icon.png', 'monochrome-icon.png'];

const VARIANTS = {
  base: { hueShift: 0, saturationScale: 1.0, isGrayscale: false, isBase: true },
  grayscale: { hueShift: 0, saturationScale: 0, isGrayscale: true },
  // Retro-filtered variants: isRetro=true skips recolorBuffer and applies applyRetroFilter
  neon: { isRetro: true, retroPreset: 'neon' },
  gold: { isRetro: true, retroPreset: 'gold' },
  'terminal-mono': { isRetro: true, retroPreset: 'terminal-mono' },
  'amber-terminal': { isRetro: true, retroPreset: 'amber-terminal' },
  'monochrome-grid': { isRetro: true, retroPreset: 'monochrome-grid' },
};

function linearToSrgb(c) {
  return Math.round(
    c <= 0.0031308 ? c * 12.92 * 255 : (1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255,
  );
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r1, g1, b1;
  if (h < 60) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (h < 180) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }
  return {
    r: linearToSrgb(r1 + m),
    g: linearToSrgb(g1 + m),
    b: linearToSrgb(b1 + m),
  };
}

function recolorBuffer(buffer, width, height, variant) {
  const out = Buffer.alloc(buffer.length);
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const r = buffer[idx];
    const g = buffer[idx + 1];
    const b = buffer[idx + 2];
    const a = buffer[idx + 3];

    let nr, ng, nb;
    if (variant.isGrayscale) {
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      nr = ng = nb = luma;
    } else {
      const hsv = rgbToHsv(r, g, b);
      const newH = (hsv.h + variant.hueShift) % 360;
      const newS = Math.min(1, hsv.s * variant.saturationScale);
      const { r: tr, g: tg, b: tb } = hsvToRgb(newH, newS, hsv.v);
      nr = tr;
      ng = tg;
      nb = tb;
    }

    out[idx] = nr;
    out[idx + 1] = ng;
    out[idx + 2] = nb;
    out[idx + 3] = a;
  }
  return out;
}

async function renderArtworkBBox(svgBuffer) {
  const raw = await sharp(svgBuffer)
    .resize(RENDER_PREVIEW_SIZE, RENDER_PREVIEW_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = raw;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    throw new Error('SVG rendered fully transparent — nothing to generate');
  }
  return {
    data,
    info,
    bbox: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

async function generateTarget(svgBuffer, target, variant) {
  const { data, info, bbox } = await renderArtworkBBox(svgBuffer);

  const croppedRaw = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extract(bbox)
    .raw()
    .toBuffer();
  const croppedWidth = bbox.width;
  const croppedHeight = bbox.height;

  const size = target.size;
  const scale = (size * target.fraction) / Math.max(bbox.width, bbox.height);
  const width = Math.max(1, Math.round(bbox.width * scale));
  const height = Math.max(1, Math.round(bbox.height * scale));

  let artwork;
  if (variant && variant.isRetro) {
    const retroPreset = FILTER_PRESETS[variant.retroPreset];
    const retroImageData = makeRetroImageData(croppedWidth, croppedHeight);
    for (let i = 0; i < croppedRaw.length; i++) {
      retroImageData.data[i] = croppedRaw[i];
    }
    const filtered = applyRetroFilter(retroImageData, retroPreset);
    artwork = await sharp(Buffer.from(filtered.data), {
      raw: { width: croppedWidth, height: croppedHeight, channels: 4 },
    })
      .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
      .ensureAlpha()
      .png()
      .toBuffer();
  } else if (variant) {
    const recolored = recolorBuffer(croppedRaw, croppedWidth, croppedHeight, variant);
    artwork = await sharp(recolored, {
      raw: { width: croppedWidth, height: croppedHeight, channels: 4 },
    })
      .resize(width, height, { fit: 'fill', kernel: KERNEL })
      .ensureAlpha()
      .png()
      .toBuffer();
  } else {
    const cropped = await sharp(croppedRaw, {
      raw: { width: croppedWidth, height: croppedHeight, channels: 4 },
    })
      .png()
      .toBuffer();
    artwork = await sharp(cropped)
      .resize(width, height, { fit: 'fill', kernel: KERNEL })
      .ensureAlpha()
      .png()
      .toBuffer();
  }

  if (target.monochrome) {
    const rawArt = await sharp(artwork).raw().toBuffer({ resolveWithObject: true });
    const { data: artData, info: artInfo } = rawArt;
    const mono = Buffer.alloc(artData.length);
    for (let i = 0; i < artInfo.width * artInfo.height; i += 1) {
      const r = artData[i * 4];
      const g = artData[i * 4 + 1];
      const b = artData[i * 4 + 2];
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      mono[i * 4] = luma;
      mono[i * 4 + 1] = luma;
      mono[i * 4 + 2] = luma;
      mono[i * 4 + 3] = artData[i * 4 + 3];
    }
    artwork = await sharp(mono, {
      raw: { width: artInfo.width, height: artInfo.height, channels: 4 },
    })
      .png()
      .toBuffer();
  }

  const left = Math.round((size - width) / 2);
  const top = Math.round((size - height) / 2);

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: artwork, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function generateAll() {
  if (!fs.existsSync(MASTER_SVG)) {
    console.error(`✗ Master branding source not found: ${MASTER_SVG}`);
    console.error('  Place your logo at assets/logo.svg and re-run npm run branding.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const svgBuffer = fs.readFileSync(MASTER_SVG);

  for (const target of TARGETS) {
    const outPath = path.join(OUT_DIR, target.name);
    if (target.name === 'splash-icon.png' && fs.existsSync(outPath)) {
      console.log(`✓ Preserved existing ${target.name} (manually-patched baseline)`);
    } else {
      const buffer = await generateTarget(svgBuffer, target, null);
      fs.writeFileSync(outPath, buffer);
      console.log(`✓ Generated ${target.name}`);
    }
  }

  for (const [variantKey, variant] of Object.entries(VARIANTS)) {
    const variantDir = path.join(ALTERNATE_DIR, variantKey);
    fs.mkdirSync(variantDir, { recursive: true });

    for (const name of VARIANT_TARGET_NAMES) {
      const baseTarget = TARGETS.find((t) => t.name === name);
      if (!baseTarget) continue;

      const outPath = path.join(variantDir, name);
      if (variant.isBase) {
        // base/ must be byte-identical to top-level defaults — copy directly
        // to avoid hueShift=0 round-trip rounding differences from recolorBuffer
        fs.copyFileSync(path.join(OUT_DIR, name), outPath);
        console.log(`✓ Copied alternate/${variantKey}/${name} from defaults`);
      } else {
        const buffer = await generateTarget(svgBuffer, baseTarget, variant);
        fs.writeFileSync(outPath, buffer);
        console.log(`✓ Generated alternate/${variantKey}/${name}`);
      }
    }
  }

  console.log('✓ Branding assets generated successfully');
}

async function checkAll() {
  let ok = true;
  for (const target of TARGETS) {
    const outPath = path.join(OUT_DIR, target.name);
    if (!fs.existsSync(outPath)) {
      console.error(`✗ Missing ${target.name}`);
      ok = false;
      continue;
    }
    const meta = await sharp(outPath).metadata();
    const square = meta.width === target.size && meta.height === target.size;
    if (!square) {
      console.error(
        `✗ ${target.name}: expected ${target.size}×${target.size}, got ${meta.width}×${meta.height}`,
      );
      ok = false;
      continue;
    }
    console.log(`✓ ${target.name} ${meta.width}×${meta.height}`);
  }
  if (!ok) {
    console.error('✗ Branding check FAILED — run npm run branding to regenerate.');
    process.exit(1);
  }
  console.log('✓ Branding assets OK');
}

async function checkAllVariants() {
  const crypto = require('crypto');
  let ok = true;

  for (const variantKey of Object.keys(VARIANTS)) {
    const variantDir = path.join(ALTERNATE_DIR, variantKey);
    for (const name of VARIANT_TARGET_NAMES) {
      const outPath = path.join(variantDir, name);
      if (!fs.existsSync(outPath)) {
        console.error(`✗ Missing alternate/${variantKey}/${name}`);
        ok = false;
        continue;
      }
      const meta = await sharp(outPath).metadata();
      if (meta.width !== 1024 || meta.height !== 1024) {
        console.error(
          `✗ alternate/${variantKey}/${name}: expected 1024×1024, got ${meta.width}×${meta.height}`,
        );
        ok = false;
        continue;
      }
      if (!meta.hasAlpha) {
        console.error(`✗ alternate/${variantKey}/${name}: missing alpha channel`);
        ok = false;
        continue;
      }
      const sha = crypto
        .createHash('sha256')
        .update(fs.readFileSync(outPath))
        .digest('hex')
        .slice(0, 12);
      console.log(`✓ alternate/${variantKey}/${name} 1024×1024 alpha sha256:${sha}`);
    }
  }

  if (!ok) {
    console.error('✗ Alternate asset check FAILED.');
    process.exit(1);
  }
  console.log('✓ Alternate assets OK');
}

(async () => {
  const check = process.argv.includes('--check');
  try {
    if (check) {
      await checkAll();
      await checkAllVariants();
    } else {
      await generateAll();
    }
  } catch (error) {
    console.error(
      `✗ Branding generation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
})();
