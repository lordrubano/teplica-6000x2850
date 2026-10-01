// Ролик MP4 из анимации: кадры снимаются по времени, без пропусков, 25 кадров в секунду.
// Запуск: node rolik.js   (нужны Playwright с Chromium, ffmpeg с libx264 — путь в FFMPEG)
// Переменные окружения: THREE_DIR, FONTS_DIR — как в sborka.js; OUT_TMP — папка для страницы;
// OUT_FILE — куда записать ролик (по умолчанию rolik-ukladka.mp4 рядом с index.html). Ролик длинный (24 шага, около 5 минут): crf 30 даёт около 16 МБ, поэтому по умолчанию crf 35 (около 9 МБ). Другое значение — переменная CRF.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const SRC = __dirname;
const DIST = path.resolve(SRC, '..');
const TMP = process.env.OUT_TMP || path.join(SRC, '.sborka');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 25, W = 1280, H = 720, HOLD_MS = 2000;
const OUT = process.env.OUT_FILE || path.join(DIST, 'rolik-ukladka.mp4');

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const frag = fs.readFileSync(path.join(SRC, 'animaciya.html'), 'utf8');
  const page_ = path.join(TMP, 'rolik.html');
  fs.writeFileSync(page_, '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + frag + '</body></html>');

  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.THREE_DIR) {
    const t = process.env.THREE_DIR;
    await page.route('**/three.min.js', r => r.fulfill({ path: path.join(t, 'build/three.min.js'), contentType: 'application/javascript' }));
    await page.route('**/OrbitControls.js', r => r.fulfill({ path: path.join(t, 'examples/js/controls/OrbitControls.js'), contentType: 'application/javascript' }));
  }
  if (process.env.FONTS_DIR) {
    const f = process.env.FONTS_DIR;
    await page.route(/fonts\.googleapis\.com/, r => r.fulfill({ path: path.join(f, 'fonts.css'), contentType: 'text/css' }));
    await page.route(/fonts\.gstatic\.com/, r => r.fulfill({ path: path.join(f, path.basename(new URL(r.request().url()).pathname)), contentType: 'font/woff2' }));
  }
  await page.goto('file://' + page_ + '?video', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.anim && window.anim.frameAt, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const total = await page.evaluate(() => window.anim.total);

  const ff = spawn(FFMPEG, ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', process.env.CRF || '35', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = buf => new Promise(res => { if (!ff.stdin.write(buf)) ff.stdin.once('drain', res); else res(); });

  const frames = Math.ceil(total / (1000 / FPS));
  let last = null;
  for (let f = 0; f <= frames; f++) {
    const ms = Math.min(total, f * 1000 / FPS);
    await page.evaluate(ms => window.anim.frameAt(ms), ms);
    last = await page.screenshot({ type: 'jpeg', quality: 90 });
    await write(last);
    if (f % 250 === 0) console.log('кадр ' + f + ' из ' + frames);
  }
  for (let k = 0; k < HOLD_MS / (1000 / FPS); k++) await write(last);
  ff.stdin.end();
  await new Promise(res => ff.on('close', res));
  await browser.close();
  if (errors.length) { console.error('Ошибки страницы:\n' + errors.join('\n')); process.exitCode = 1; }
  console.log('Готово: ' + OUT + ', ' + (fs.statSync(OUT).size / 1e6).toFixed(1) + ' МБ, ' + ((total + HOLD_MS) / 1000).toFixed(0) + ' с');
})();
