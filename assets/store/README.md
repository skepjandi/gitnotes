# Store listing assets

Ready-to-upload App Store Connect and Google Play Console images, plus the raw iOS Simulator captures they are built from and the script that regenerates them.

```
assets/store/
├── raw/iphone/      8 captures, iPhone 17 Pro Max simulator, 1320×2868
├── raw/ipad/        8 captures, iPad Pro 13" (M5) simulator, 2064×2752
├── ios/iphone-6.9/  8 × 1320×2868   App Store, iPhone 6.9" display (upload this set)
├── ios/iphone-6.3/  8 × 1206×2622   App Store, iPhone 6.3" display (the slot Apple marks required)
├── ios/ipad-13/     8 × 2064×2752   App Store, iPad 13" display (required for iPad apps)
├── ios/creative/    3 × App Store creative assets: universal 5244×2950, header 3840×1646, search 3840×2560
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

### App Store creative assets (product page header and search results)

Optional images shown at the top of the product page and in Search on iOS 27 / iPadOS 27 and later. They are submitted through App Store Connect (Asset Library or alongside a version) and reviewed separately from screenshots. Spec: [Creative assets specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications), guidance: [Asset best practices](https://developer.apple.com/app-store/asset-best-practices/).

| File | Size | Placement |
|---|---|---|
| `ios/creative/universal-5244x2950.png` | 5244×2950 (16:9) | Product page header **and** search results; Apple crops it per placement (upload this one first) |
| `ios/creative/header-3840x1646.png` | 3840×1646 (21:9) | Product page header only |
| `ios/creative/search-3840x2560.png` | 3840×2560 (3:2) | Search results only (accepted range 1920×1280 to 3840×2560) |

Copy and focal art sit inside the "Art Safe Area" of Apple's templates (`CREATIVES[*].safe` in `slides.mjs`; universal x 1921–3323, y 660–1622; header x 1097–2743, y 493–1154; search x 836–3004, y 765–1795) with a 3% inset. Apple does not publish how the universal asset is cropped, so check all placements in App Store Connect's Preview tool before submitting. Opaque PNGs, no alpha, no pricing, URLs, awards or other platforms' marks.

Why the Android sets are separate renders and not the Apple files resized: the iPhone 17 Pro Max capture is 1320×2868 (2.17:1), which breaks Google's 2:1 limit. The Android renders are 9:16, replace the iOS status bar with an Android one (9:41, Wi-Fi, signal, battery), and keep captions under 20% of the height.

Apple lists 6.9" as optional-with-fallback and 6.3" as the mandatory iPhone slot. `iphone-6.9` can be the only upload (App Store Connect scales it down); `iphone-6.3` is there if you want pixel-exact control.

## Regenerating

```bash
node scripts/store-assets/render.mjs            # everything
node scripts/store-assets/render.mjs ios/ipad   # one set (substring match); `feature-graphic` and `creative` (or `creative/header`) also work
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
