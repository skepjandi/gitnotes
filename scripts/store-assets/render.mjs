#!/usr/bin/env node
// Renders the App Store / Google Play listing images from the raw simulator
// captures in assets/store/raw/. Usage: node scripts/store-assets/render.mjs [set ...]
// Needs Google Chrome/Chromium (CHROME_BIN overrides the path) and `sharp`.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { SLIDES, buildFeatureGraphicHtml, buildSlideHtml } from './slides.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const storeDir = path.resolve(here, '../../assets/store');
const fontsUrl = pathToFileURL(path.join(here, 'fonts')).href;

/**
 * Output sets. Pixel sizes are the ones Apple and Google accept today (see assets/store/README.md).
 * `cropTop` hides the iOS status bar from Android listings, which must not show iOS chrome.
 */
const SETS = {
  'ios/iphone-6.9': { width: 1320, height: 2868, kind: 'phone', raw: 'iphone', frame: true },
  'ios/iphone-6.3': { width: 1206, height: 2622, kind: 'phone', raw: 'iphone', frame: true },
  'ios/ipad-13': { width: 2064, height: 2752, kind: 'tablet', raw: 'ipad', frame: true },
  'android/phone': {
    width: 1080,
    height: 1920,
    kind: 'phone',
    raw: 'iphone',
    frame: true,
    statusBar: 180,
    captionShare: 0.2,
    float: true,
  },
  'android/tablet-10': {
    width: 1440,
    height: 2560,
    kind: 'tablet',
    raw: 'ipad',
    frame: true,
    statusBar: 56,
    float: true,
  },
};

const chrome =
  process.env.CHROME_BIN ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(existsSync);
if (!chrome) throw new Error('Chrome/Chromium not found; set CHROME_BIN');

const wanted = process.argv.slice(2);
const sets = Object.entries(SETS).filter(
  ([name]) => wanted.length === 0 || wanted.some((w) => name.includes(w)),
);
const work = mkdtempSync(path.join(tmpdir(), 'gn-store-'));
const logoPath = path.resolve(here, '../../assets/generated/icon.png');

function screenshot(html, name, width, height) {
  const htmlPath = path.join(work, `${name}.html`);
  const tmpPng = path.join(work, `${name}.png`);
  writeFileSync(htmlPath, html);
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      '--virtual-time-budget=4000',
      `--screenshot=${tmpPng}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: 'ignore' },
  );
  return tmpPng;
}

// Both stores reject alpha: write an opaque 3-channel PNG.
async function writeOpaquePng(tmpPng, out) {
  await sharp(readFileSync(tmpPng))
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(path.relative(storeDir, out));
}

try {
  for (const [name, cfg] of sets) {
    const outDir = path.join(storeDir, name);
    mkdirSync(outDir, { recursive: true });
    for (const [i, slide] of SLIDES.entries()) {
      const rawPath = path.join(storeDir, 'raw', cfg.raw, slide.shot);
      const meta = await sharp(rawPath).metadata();
      let androidBar;
      if (cfg.statusBar) {
        const { data } = await sharp(rawPath)
          .extract({ left: 8, top: cfg.statusBar + 2, width: 1, height: 1 })
          .raw()
          .toBuffer({ resolveWithObject: true });
        const [rr, gg, bb] = data;
        const light = 0.299 * rr + 0.587 * gg + 0.114 * bb > 140;
        androidBar = {
          rawHeight: cfg.statusBar,
          bg: `rgb(${rr},${gg},${bb})`,
          fg: light ? '#111' : '#fff',
        };
      }
      const html = buildSlideHtml({
        androidBar,
        slide,
        index: i,
        width: cfg.width,
        height: cfg.height,
        kind: cfg.kind,
        frame: cfg.frame,
        float: cfg.float,
        captionShare: cfg.captionShare,
        imageUrl: pathToFileURL(rawPath).href,
        imageWidth: meta.width,
        imageHeight: meta.height,
        fontsUrl,
      });
      const tmpPng = screenshot(html, String(i), cfg.width, cfg.height);
      const out = path.join(
        outDir,
        `${String(i + 1).padStart(2, '0')}-${path.basename(slide.shot, '.png').slice(3)}.png`,
      );
      await writeOpaquePng(tmpPng, out);
    }
  }
  if (wanted.length === 0 || wanted.some((w) => 'feature-graphic'.includes(w))) {
    mkdirSync(path.join(storeDir, 'android'), { recursive: true });
    const html = buildFeatureGraphicHtml({ logoUrl: pathToFileURL(logoPath).href, fontsUrl });
    await writeOpaquePng(
      screenshot(html, 'fg', 1024, 500),
      path.join(storeDir, 'android/feature-graphic.png'),
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
