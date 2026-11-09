// Store-listing slide content + HTML template. Pure functions: no I/O, no browser.
// render.mjs turns each slide into a PNG; keep copy and layout changes here.

/** Eight ad-style slides. `shot` is a file name under assets/store/raw/<iphone|ipad>/. */
export const SLIDES = [
  {
    shot: '01-home.png',
    theme: 'blue',
    eyebrow: 'Git-backed notes',
    headline: 'Your notes, versioned with <em>Git</em>.',
  },
  {
    shot: '02-notes.png',
    theme: 'paper',
    eyebrow: 'Organize',
    headline: 'Folders, tags and colors. <em>Your</em> way.',
  },
  {
    shot: '03-editor.png',
    theme: 'ink',
    eyebrow: 'Write',
    headline: 'Plain Markdown. <em>Nothing</em> to export.',
  },
  {
    shot: '04-todos.png',
    theme: 'paper',
    eyebrow: 'Plan',
    headline: 'Todos that live in your <em>repo</em>.',
  },
  {
    shot: '05-canvas.png',
    theme: 'ink',
    eyebrow: 'Sketch',
    headline: 'Think on an infinite <em>canvas</em>.',
  },
  {
    shot: '06-git.png',
    theme: 'paper',
    eyebrow: 'Version',
    headline: 'Every edit is a <em>commit</em>.',
  },
  {
    shot: '07-ai.png',
    theme: 'ink',
    eyebrow: 'Assist',
    headline: 'Let AI organize your <em>notes</em>.',
  },
  {
    shot: '08-settings.png',
    theme: 'blue',
    eyebrow: 'Make it yours',
    headline: 'Themes, icons and <em>accents</em>.',
  },
];

const THEMES = {
  paper: {
    bg: 'linear-gradient(180deg,#F8F9FD 0%,#E1E7F6 100%)',
    glow: 'rgba(58,85,200,.22)',
    text: '#0B1030',
    muted: '#3A55C8',
    accent: '#3A55C8',
    bezel: '#0B0C10',
    rule: 'rgba(11,16,48,.2)',
  },
  ink: {
    bg: 'radial-gradient(120% 70% at 85% 6%,#25399B 0%,#101847 34%,#07080F 80%)',
    glow: 'rgba(139,155,232,.32)',
    text: '#F4F6FF',
    muted: '#8B9BE8',
    accent: '#9DB0FF',
    bezel: '#0B0C10',
    rule: 'rgba(244,246,255,.2)',
  },
  blue: {
    bg: 'linear-gradient(170deg,#2B44B8 0%,#3A55C8 50%,#6F8DF0 100%)',
    glow: 'rgba(255,255,255,.34)',
    text: '#FFFFFF',
    muted: 'rgba(255,255,255,.8)',
    accent: '#CFDAFF',
    bezel: '#0B0C10',
    rule: 'rgba(255,255,255,.3)',
  },
};

/**
 * @param {object} o
 * @param {typeof SLIDES[number]} o.slide
 * @param {number} o.index            0-based slide index (shown as the section number)
 * @param {number} o.width            output px
 * @param {number} o.height           output px
 * @param {'phone'|'tablet'} o.kind
 * @param {boolean} o.frame           draw a device bezel (App Store) or a bare rounded screen (Play)
 * @param {string} o.imageUrl         file:// URL of the raw capture
 * @param {number} o.imageWidth       raw capture width px
 * @param {number} o.imageHeight      raw capture height px
 * @param {number} [o.cropTop]        raw px to hide from the top (status bar on Play listings)
 * @param {string} o.fontsUrl         file:// URL of the fonts directory
 * @param {{rawHeight:number,bg:string,fg:string}} [o.androidBar] paint an Android status bar over the capture's iOS one
 * @param {boolean} [o.float]       device floats fully inside the canvas instead of bleeding off the bottom (Android tablets)
 * @param {number} [o.captionShare]   max share of the height the caption may use (Play: <= .20)
 */
export function buildSlideHtml(o) {
  const t = THEMES[o.slide.theme];
  const { width: W, height: H } = o;
  const phone = o.kind === 'phone';
  const cropTop = o.cropTop ?? 0;

  const margin = Math.round(W * 0.075);
  const eyebrowSize = Math.round(W * 0.022);
  const headSize = Math.round(W * (phone ? 0.088 : 0.074));
  const capTop = Math.round(H * (o.captionShare ? 0.035 : 0.06));
  const headTop = capTop + eyebrowSize * 2.4;
  const headLines = 2;
  const headBottom = headTop + headSize * 1.05 * headLines;

  const gap = H * 0.035;
  const minTop = Math.round(Math.max(headBottom + gap, H * (o.captionShare ? 0.2 : 0.265)));
  const visibleRatio = (o.imageHeight - (o.cropTop ?? 0)) / o.imageWidth;
  const maxW = W * (phone ? 0.8 : 0.86);
  const deviceW = Math.round(o.float ? Math.min(maxW, (H * 0.95 - minTop) / visibleRatio) : maxW);
  const deviceX = Math.round((W - deviceW) / 2);
  const deviceTop = o.float ? Math.round(H * 0.95 - deviceW * visibleRatio) : minTop;
  const bezel = o.frame ? Math.round(deviceW * (phone ? 0.022 : 0.028)) : 0;
  const screenW = deviceW - bezel * 2;
  const screenRadius = Math.round(screenW * (phone ? 0.125 : 0.04));
  const outerRadius = screenRadius + bezel;

  // Raw capture scaled to screen width; crop the top by hiding it above the box.
  const scale = screenW / o.imageWidth;
  const imgH = Math.round(o.imageHeight * scale);
  const imgShift = Math.round(cropTop * scale);
  const bar = o.androidBar;
  const barH = bar ? Math.round(bar.rawHeight * scale) : 0;
  const deviceH = o.float
    ? Math.round(imgH - imgShift + bezel * 2)
    : H - deviceTop + Math.round(deviceW * 0.12); // bleeds off the bottom edge unless floating
  const screenH = deviceH - bezel * 2;

  const shadow = o.frame
    ? '0 50px 120px rgba(0,0,0,.38), 0 12px 30px rgba(0,0,0,.25)'
    : '0 40px 100px rgba(0,0,0,.32)';
  const num = String(o.index + 1).padStart(2, '0');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"NR";src:url("${o.fontsUrl}/newsreader-latin-opsz-normal.woff2") format("woff2");font-weight:200 800;font-style:normal}
@font-face{font-family:"NR";src:url("${o.fontsUrl}/newsreader-latin-opsz-italic.woff2") format("woff2");font-weight:200 800;font-style:italic}
@font-face{font-family:"PX";src:url("${o.fontsUrl}/ibm-plex-sans-latin-500-normal.woff2") format("woff2");font-weight:500}
@font-face{font-family:"PX";src:url("${o.fontsUrl}/ibm-plex-sans-latin-400-normal.woff2") format("woff2");font-weight:400}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
.slide{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(70% 38% at 50% 72%,${t.glow},transparent),${t.bg};color:${t.text}}
.grain{position:absolute;inset:0;opacity:${o.slide.theme === 'ink' ? 0.1 : 0.14};background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.42'/%3E%3C/svg%3E")}
.eyebrow{position:absolute;left:${margin}px;right:${margin}px;top:${capTop}px;display:flex;gap:${Math.round(W * 0.02)}px;align-items:baseline;
  font:500 ${eyebrowSize}px/1 "PX",sans-serif;letter-spacing:.2em;text-transform:uppercase;color:${t.muted};padding-top:${Math.round(eyebrowSize * 0.9)}px;border-top:2px solid ${t.rule}}
.eyebrow b{font-family:"NR",serif;font-weight:500;letter-spacing:.04em;color:${t.accent};font-size:${Math.round(eyebrowSize * 1.25)}px}
h1{position:absolute;left:${margin}px;right:${margin}px;top:${Math.round(headTop)}px;
  font:600 ${headSize}px/1.05 "NR",Georgia,serif;font-optical-sizing:auto;letter-spacing:-.035em;color:${t.text};text-wrap:balance}
h1 em{font-style:italic;color:${t.accent}}
.device{position:absolute;left:${deviceX}px;top:${deviceTop}px;width:${deviceW}px;height:${deviceH}px;
  background:${o.frame ? t.bezel : 'transparent'};border-radius:${outerRadius}px ${outerRadius}px ${o.float ? outerRadius : 0}px ${o.float ? outerRadius : 0}px;box-shadow:inset 0 0 0 ${Math.max(3, Math.round(deviceW * 0.004))}px rgba(255,255,255,.3),0 0 0 ${Math.max(2, Math.round(deviceW * 0.0025))}px rgba(0,0,0,.75),${shadow};
  padding:${bezel}px}
.screen{position:relative;width:${screenW}px;height:${screenH}px;overflow:hidden;border-radius:${screenRadius}px ${screenRadius}px ${o.float ? screenRadius : 0}px ${o.float ? screenRadius : 0}px;background:#000}
.screen img{position:absolute;left:0;top:${-imgShift}px;width:${screenW}px;height:${imgH}px;display:block}
${o.frame && phone ? `.island{position:absolute;left:50%;top:${Math.round(bezel + screenW * 0.027)}px;width:${Math.round(screenW * 0.27)}px;height:${Math.round(screenW * 0.08)}px;margin-left:${-Math.round(screenW * 0.135)}px;background:#000;border-radius:999px}` : ''}
</style></head><body><div class="slide"><div class="grain"></div>
<div class="eyebrow"><b>${num}</b><span>${o.slide.eyebrow}</span></div>
<h1>${o.slide.headline}</h1>
<div class="device"><div class="screen"><img src="${o.imageUrl}" alt="">${bar ? androidBarHtml(bar, barH, screenW) : ''}</div>${o.frame && phone && cropTop === 0 ? '' : ''}</div>
</div></body></html>`;
}

/** Google Play feature graphic: exactly 1024x500, no device imagery, key content kept off the edges. */
export function buildFeatureGraphicHtml({ logoUrl, fontsUrl }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"NR";src:url("${fontsUrl}/newsreader-latin-opsz-normal.woff2") format("woff2");font-weight:200 800}
@font-face{font-family:"NR";src:url("${fontsUrl}/newsreader-latin-opsz-italic.woff2") format("woff2");font-weight:200 800;font-style:italic}
@font-face{font-family:"PX";src:url("${fontsUrl}/ibm-plex-sans-latin-500-normal.woff2") format("woff2");font-weight:500}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1024px;height:500px;overflow:hidden}
.fg{position:relative;width:1024px;height:500px;background:#3A55C8;color:#fff;overflow:hidden}
.fg::before{content:"";position:absolute;right:-140px;top:-160px;width:560px;height:560px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.16),rgba(255,255,255,0) 68%)}
.brand{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:14px;font:500 15px/1 "PX",sans-serif;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.85)}
.brand img{width:44px;height:44px;border-radius:11px}
h1{position:absolute;left:72px;top:150px;width:470px;font:500 58px/1.02 "NR",Georgia,serif;letter-spacing:-.035em;text-wrap:balance}
h1 em{font-style:italic;color:#DCE3FA}
p{position:absolute;left:72px;top:352px;width:440px;font:500 17px/1.45 "PX",sans-serif;color:rgba(255,255,255,.86)}
.diff{position:absolute;left:590px;top:96px;width:362px;border-radius:14px;background:#0F1012;box-shadow:0 30px 70px rgba(0,0,0,.4);overflow:hidden;font:500 14px/1.7 "PX",ui-monospace,monospace}
.diff .bar{display:flex;gap:7px;padding:13px 15px;background:#1A1B1F}
.diff .bar i{width:10px;height:10px;border-radius:50%;background:#3A3B40}
.diff .meta{padding:14px 18px 6px;color:#9A9AA0;font-size:12px;letter-spacing:.06em}
.diff .meta b{color:#8B9BE8;font-weight:500}
.diff .msg{padding:0 18px 12px;color:#F2F2F7;font-size:15px}
.diff .l{padding:2px 18px;white-space:nowrap;color:#C9CAD1}
.diff .a{background:rgba(78,158,122,.2);color:#7ED3A9}
.diff .d{background:rgba(208,121,111,.2);color:#F0A199}
.diff .l:last-child{margin-bottom:14px}
</style></head><body><div class="fg">
<div class="brand"><img src="${logoUrl}" alt="">GitNotēs</div>
<h1>Your notes, versioned with <em>Git</em>.</h1>
<p>Notes, todos and canvas stored as plain files in the repo you own.</p>
<div class="diff"><div class="bar"><i></i><i></i><i></i></div>
<div class="meta"><b>4f2a9c1</b> &nbsp;main &nbsp;·&nbsp; notes/weekly-review.md</div>
<div class="msg">notes: plan the week</div>
<div class="l">## Next week</div>
<div class="l d">- Book flights</div>
<div class="l a">+ Book flights to Kyoto</div>
<div class="l a">+ Draft the v2 announcement</div>
<div class="l">&nbsp; Finish sync design</div></div>
</div></body></html>`;
}

function androidBarHtml(bar, h, w) {
  const f = bar.fg;
  const u = h / 100;
  return `<div style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:${bar.bg};color:${f};font:500 ${Math.round(h * 0.34)}px/1 PX,sans-serif;display:flex;align-items:center;justify-content:space-between;padding:0 ${Math.round(w * 0.06)}px">
<span>9:41</span>
<span style="position:absolute;left:50%;top:${Math.round(h * 0.32)}px;width:${Math.round(h * 0.2)}px;height:${Math.round(h * 0.2)}px;margin-left:${-Math.round(h * 0.1)}px;border-radius:50%;background:#000"></span>
<span style="display:flex;gap:${Math.round(h * 0.12)}px;align-items:center">
<svg width="${Math.round(h * 0.3)}" height="${Math.round(h * 0.26)}" viewBox="0 0 24 20" fill="${f}"><path d="M12 19 .5 6.5a16 16 0 0 1 23 0Z"/></svg>
<svg width="${Math.round(h * 0.26)}" height="${Math.round(h * 0.26)}" viewBox="0 0 20 20" fill="${f}"><path d="M20 20H0L20 0Z"/></svg>
<svg width="${Math.round(h * 0.17)}" height="${Math.round(h * 0.3)}" viewBox="0 0 10 18" fill="${f}"><rect x="3" width="4" height="2" rx="1"/><rect y="2" width="10" height="16" rx="2.5"/></svg>
</span></div>`;
}

/**
 * App Store creative assets (product page header + search results). `safe` is the
 * "Art Safe Area" of Apple's own templates in canvas px: copy and focal art stay
 * inside it, the backdrop fills the rest. Header and search are cropped from the
 * universal asset by the store, so all three share one composition per canvas.
 * Text sizes are large on purpose: the whole canvas is shown ~350pt wide.
 */
export const CREATIVES = {
  universal: {
    width: 5244,
    height: 2950,
    safe: { x: 1921, y: 660, w: 1402, h: 962 },
    phones: ['03-editor.png'],
    headPx: 150,
  },
  header: {
    width: 3840,
    height: 1646,
    safe: { x: 1097, y: 493, w: 1646, h: 661 },
    phones: ['03-editor.png', '06-git.png'],
    headPx: 112,
  },
  search: {
    width: 3840,
    height: 2560,
    safe: { x: 836, y: 765, w: 2168, h: 1030 },
    phones: ['03-editor.png', '06-git.png'],
    headPx: 200,
  },
};

const PHONE_BEZEL = 0.022;
const PHONE_RATIO = 2868 / 1320; // raw iPhone capture height / width

/** Outer phone width for a given outer height (bezel included). */
function phoneWidth(outerH) {
  return outerH / ((1 - 2 * PHONE_BEZEL) * PHONE_RATIO + 2 * PHONE_BEZEL);
}

/**
 * @param {object} o
 * @param {typeof CREATIVES[keyof typeof CREATIVES]} o.spec
 * @param {string[]} o.imageUrls  file:// URLs, same order as spec.phones (front phone first)
 * @param {string} o.logoUrl
 * @param {string} o.fontsUrl
 */
export function buildCreativeHtml({ spec, imageUrls, logoUrl, fontsUrl }) {
  const t = THEMES.ink;
  const { width: W, height: H, safe, headPx } = spec;
  const inset = Math.round(safe.w * 0.03);
  const S = { x: safe.x + inset, y: safe.y + inset, w: safe.w - inset * 2, h: safe.h - inset * 2 };
  const gap = Math.round(S.w * 0.05);
  const frontH = S.h;
  const frontW = phoneWidth(frontH);
  const backScale = 0.9;
  const two = imageUrls.length > 1;
  const groupW = two ? Math.round(frontW * 0.6 + frontW * backScale) : Math.round(frontW);
  const groupX = S.x + S.w - groupW;
  const textW = S.w - groupW - gap;
  const wordPx = Math.round(headPx * 0.3);

  const phone = (url, outerH, left, top, z) => {
    const outerW = Math.round(phoneWidth(outerH));
    const b = Math.round(outerW * PHONE_BEZEL);
    const screenW = outerW - b * 2;
    const screenR = Math.round(screenW * 0.125);
    return `<div class="phone" style="left:${Math.round(left)}px;top:${Math.round(top)}px;width:${outerW}px;height:${Math.round(outerH)}px;padding:${b}px;border-radius:${screenR + b}px;z-index:${z}">
<div class="screen" style="border-radius:${screenR}px"><img src="${url}" alt="" style="width:${screenW}px"></div>
<div class="island" style="left:50%;top:${Math.round(b + screenW * 0.027)}px;width:${Math.round(screenW * 0.27)}px;height:${Math.round(screenW * 0.08)}px;margin-left:${-Math.round(screenW * 0.135)}px"></div></div>`;
  };

  const backH = frontH * backScale;
  const phones = two
    ? phone(imageUrls[1], backH, groupX + frontW * 0.6, S.y + frontH - backH, 1) +
      phone(imageUrls[0], frontH, groupX, S.y, 2)
    : phone(imageUrls[0], frontH, groupX, S.y, 2);

  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"NR";src:url("${fontsUrl}/newsreader-latin-opsz-normal.woff2") format("woff2");font-weight:200 800;font-style:normal}
@font-face{font-family:"NR";src:url("${fontsUrl}/newsreader-latin-opsz-italic.woff2") format("woff2");font-weight:200 800;font-style:italic}
@font-face{font-family:"PX";src:url("${fontsUrl}/ibm-plex-sans-latin-500-normal.woff2") format("woff2");font-weight:500}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
.c{position:relative;width:${W}px;height:${H}px;overflow:hidden;color:${t.text};
  background:radial-gradient(${Math.round(S.w * 0.9)}px ${Math.round(S.h * 0.9)}px at ${groupX + groupW * 0.5}px ${S.y + S.h * 0.55}px,${t.glow},transparent),${t.bg}}
.grain{position:absolute;inset:0;opacity:.14;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.42'/%3E%3C/svg%3E")}
.text{position:absolute;left:${S.x}px;top:${S.y}px;width:${textW}px;height:${S.h}px;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(headPx * 0.34)}px}
.brand{display:flex;align-items:center;gap:${Math.round(wordPx * 0.6)}px;font:500 ${wordPx}px/1 "PX",sans-serif;letter-spacing:.2em;text-transform:uppercase;color:${t.muted}}
.brand img{width:${Math.round(wordPx * 2.4)}px;height:${Math.round(wordPx * 2.4)}px;border-radius:22.37%;box-shadow:0 ${Math.round(wordPx * 0.5)}px ${Math.round(wordPx * 1.4)}px rgba(0,0,0,.3)}
h1{font:600 ${headPx}px/1.04 "NR",Georgia,serif;font-optical-sizing:auto;letter-spacing:-.035em;color:${t.text};text-wrap:balance}
h1 em{font-style:italic;color:${t.accent}}
.phone{position:absolute;background:${t.bezel};box-shadow:inset 0 0 0 ${Math.max(3, Math.round(frontW * 0.004))}px rgba(255,255,255,.3),0 0 0 ${Math.max(2, Math.round(frontW * 0.0025))}px rgba(0,0,0,.75),0 ${Math.round(S.h * 0.05)}px ${Math.round(S.h * 0.12)}px rgba(0,0,0,.38),0 ${Math.round(S.h * 0.012)}px ${Math.round(S.h * 0.03)}px rgba(0,0,0,.25)}
.screen{position:relative;width:100%;height:100%;overflow:hidden;background:#000}
.screen img{position:absolute;left:0;top:0;display:block}
.island{position:absolute;background:#000;border-radius:999px}
</style></head><body><div class="c"><div class="grain"></div>
<div class="text"><div class="brand"><img src="${logoUrl}" alt="">GitNotēs</div>
<h1>Your notes, versioned with <em>Git</em>.</h1></div>
${phones}
</div></body></html>`;
}
