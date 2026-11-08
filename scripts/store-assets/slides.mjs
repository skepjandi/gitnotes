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
  paper: { bg: '#F1EFE9', text: '#1C1C1E', muted: '#5F5F66', accent: '#3A55C8', bezel: '#0B0B0C', rule: 'rgba(28,28,30,.18)' },
  ink: { bg: '#0F1012', text: '#F2F2F7', muted: '#9A9AA0', accent: '#8B9BE8', bezel: '#3A3B41', rule: 'rgba(242,242,247,.18)' },
  blue: { bg: '#3A55C8', text: '#FFFFFF', muted: 'rgba(255,255,255,.78)', accent: '#DCE3FA', bezel: '#0B0B0C', rule: 'rgba(255,255,255,.28)' },
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
  const deviceH = o.float ? Math.round(imgH - imgShift + bezel * 2) : H - deviceTop + Math.round(deviceW * 0.12); // bleeds off the bottom edge unless floating
  const screenH = deviceH - bezel * 2;

  const shadow = o.frame ? '0 50px 120px rgba(0,0,0,.38), 0 12px 30px rgba(0,0,0,.25)' : '0 40px 100px rgba(0,0,0,.32)';
  const num = String(o.index + 1).padStart(2, '0');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"NR";src:url("${o.fontsUrl}/newsreader-latin-opsz-normal.woff2") format("woff2");font-weight:200 800;font-style:normal}
@font-face{font-family:"NR";src:url("${o.fontsUrl}/newsreader-latin-opsz-italic.woff2") format("woff2");font-weight:200 800;font-style:italic}
@font-face{font-family:"PX";src:url("${o.fontsUrl}/ibm-plex-sans-latin-500-normal.woff2") format("woff2");font-weight:500}
@font-face{font-family:"PX";src:url("${o.fontsUrl}/ibm-plex-sans-latin-400-normal.woff2") format("woff2");font-weight:400}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:${t.bg}}
.slide{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${t.bg};color:${t.text}}
.grain{position:absolute;inset:0;opacity:${o.slide.theme === 'ink' ? 0.1 : 0.14};background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.42'/%3E%3C/svg%3E")}
.eyebrow{position:absolute;left:${margin}px;right:${margin}px;top:${capTop}px;display:flex;gap:${Math.round(W * 0.02)}px;align-items:baseline;
  font:500 ${eyebrowSize}px/1 "PX",sans-serif;letter-spacing:.2em;text-transform:uppercase;color:${t.muted};padding-top:${Math.round(eyebrowSize * 0.9)}px;border-top:2px solid ${t.rule}}
.eyebrow b{font-family:"NR",serif;font-weight:500;letter-spacing:.04em;color:${t.accent};font-size:${Math.round(eyebrowSize * 1.25)}px}
h1{position:absolute;left:${margin}px;right:${margin}px;top:${Math.round(headTop)}px;
  font:500 ${headSize}px/1.05 "NR",Georgia,serif;font-optical-sizing:auto;letter-spacing:-.035em;color:${t.text};text-wrap:balance}
h1 em{font-style:italic;color:${t.accent}}
.device{position:absolute;left:${deviceX}px;top:${deviceTop}px;width:${deviceW}px;height:${deviceH}px;
  background:${o.frame ? t.bezel : 'transparent'};border-radius:${outerRadius}px ${outerRadius}px ${o.float ? outerRadius : 0}px ${o.float ? outerRadius : 0}px;box-shadow:${shadow};
  outline:${Math.max(3, Math.round(deviceW * 0.004))}px solid ${o.slide.theme === 'paper' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)'};padding:${bezel}px}
.screen{position:relative;width:${screenW}px;height:${screenH}px;overflow:hidden;border-radius:${screenRadius}px ${screenRadius}px ${o.float ? screenRadius : 0}px ${o.float ? screenRadius : 0}px;background:#000}
.screen img{position:absolute;left:0;top:${-imgShift}px;width:${screenW}px;height:${imgH}px;display:block}
${o.frame && phone ? `.island{position:absolute;left:50%;top:${Math.round(bezel + screenW * 0.027)}px;width:${Math.round(screenW * 0.27)}px;height:${Math.round(screenW * 0.08)}px;margin-left:${-Math.round(screenW * 0.135)}px;background:#000;border-radius:999px}` : ''}
</style></head><body><div class="slide"><div class="grain"></div>
<div class="eyebrow"><b>${num}</b><span>${o.slide.eyebrow}</span></div>
<h1>${o.slide.headline}</h1>
<div class="device"><div class="screen"><img src="${o.imageUrl}" alt=""></div>${o.frame && phone && cropTop === 0 ? '' : ''}</div>
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
