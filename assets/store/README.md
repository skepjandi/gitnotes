# Store listing assets

Ready-to-upload App Store Connect and Google Play Console images, plus the raw iOS Simulator captures they are built from and the script that regenerates them.

```
assets/store/
├── raw/iphone/      8 captures, iPhone 17 Pro Max simulator, 1320×2868
├── raw/ipad/        8 captures, iPad Pro 13" (M5) simulator, 2064×2752
├── ios/iphone-6.9/  8 × 1320×2868   App Store, iPhone 6.9" display (upload this set)
├── ios/iphone-6.3/  8 × 1206×2622   App Store, iPhone 6.3" display (the slot Apple marks required)
├── ios/ipad-13/     8 × 2064×2752   App Store, iPad 13" display (required for iPad apps)
├── android/phone/   8 × 1080×1920   Google Play, phone screenshots (9:16)
├── android/tablet-10/ 8 × 1440×2560 Google Play, 7"/10" tablet screenshots (9:16)
└── android/feature-graphic.png      1024×500 Google Play feature graphic
```

Order is the display order: home, notes, editor, todos, canvas, git, ai, settings.

## Store rules these files satisfy

All files are opaque 3-channel PNGs (no alpha), written by `render.mjs`.

| Store | Slot | Rule | Source |
|---|---|---|---|
| Apple | iPhone 6.9" | portrait 1260×2736, 1290×2796 or **1320×2868** | [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) |
| Apple | iPhone 6.3" | portrait **1206×2622** or 1179×2556; the required iPhone slot | same |
| Apple | iPad 13" | portrait **2064×2752** or 2048×2732; required when the app runs on iPad | same |
| Apple | all | 1–10 screenshots per size, PNG/JPEG, no alpha; larger sets scale down automatically when the UI is consistent | same |
| Apple | content | no pricing, URLs, awards, other platforms' marks; short text overlays allowed; localize text | [Asset best practices](https://developer.apple.com/app-store/asset-best-practices/) |
| Google | phone | 2–8 screenshots, JPEG or 24-bit PNG (no alpha), each side 320–3840 px, long side ≤ 2× short side; 9:16 recommended, ≥ 1080 px for promotion eligibility | [Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) |
| Google | 7"/10" tablet | up to 8, width 1080–7680 px, 16:9 or 9:16 recommended | same |
| Google | feature graphic | exactly 1024×500, JPEG or 24-bit PNG, no alpha, device imagery discouraged | same |
| Google | text | tagline ≤ 20% of the image, no "Best"/"#1"/price/call-to-action text | same |

Why the Android sets are separate renders and not the Apple files resized: the iPhone 17 Pro Max capture is 1320×2868 (2.17:1), which breaks Google's 2:1 limit. The Android renders are 9:16, hide the iOS status bar, draw no device hardware, and keep captions under 20% of the height.

Apple lists 6.9" as optional-with-fallback and 6.3" as the mandatory iPhone slot. `iphone-6.9` can be the only upload (App Store Connect scales it down); `iphone-6.3` is there if you want pixel-exact control.

## Regenerating

```bash
node scripts/store-assets/render.mjs            # everything
node scripts/store-assets/render.mjs ios/ipad   # one set (substring match); `feature-graphic` also works
```

Needs Google Chrome or Chromium (`CHROME_BIN` overrides the path) and `sharp` (already in `node_modules` through Expo). Copy and layout live in `scripts/store-assets/slides.mjs`; fonts (Newsreader, IBM Plex Sans, SIL OFL) are bundled in `scripts/store-assets/fonts/`.

## Re-capturing the raw screenshots

The raw files are real simulator captures of the dev build, taken with the demo vault below, in dark appearance, with Apple's canonical status bar:

```bash
xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
xcrun simctl ui booted appearance dark
xcrun simctl io booted screenshot assets/store/raw/iphone/01-home.png
```

The Git tab renders a light surface, so `06-git` was captured with `xcrun simctl ui booted appearance light` to keep the status bar legible, then switched back.

The demo vault is a private GitHub repo with plain files: `notes/*.md`, `journals/*.md`, `todos/*.json`, and a `canvases/sync-flow.json` scene. The AI screenshot is a real chat against an OpenAI-compatible provider. Nothing in the captures should show real credentials, private repo names, or personal data.
