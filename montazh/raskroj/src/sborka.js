// Сборка: страница анимации для GitHub, кадры шагов и инструкция в PDF.
// Запуск: node sborka.js
// Переменные окружения (необязательно):
//   THREE_DIR  — папка пакета three@0.128.0, чтобы не ходить за библиотекой в сеть;
//   FONTS_DIR  — папка с fonts.css и файлами шрифтов Google Fonts;
//   ANIM_URL   — адрес опубликованной анимации для QR-кода;
//   OUT_TMP    — папка для промежуточных файлов (кадры, data.js).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const QRCode = require('qrcode');

const SRC = __dirname;
const DIST = path.resolve(SRC, '..');
const TMP = process.env.OUT_TMP || path.join(SRC, '.sborka');
const ANIM_URL = process.env.ANIM_URL || 'https://lordrubano.github.io/teplica-6000x2850/montazh/raskroj/';
const PDF_NAME = 'instrukciya-raskroj.pdf';

function wrapPage(fragment) {
  return '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    '</head>\n<body>\n' + fragment + '\n</body>\n</html>\n';
}

async function routes(page) {
  const three = process.env.THREE_DIR;
  if (three) {
    await page.route('**/three.min.js', r => r.fulfill({ path: path.join(three, 'build/three.min.js'), contentType: 'application/javascript' }));
    await page.route('**/OrbitControls.js', r => r.fulfill({ path: path.join(three, 'examples/js/controls/OrbitControls.js'), contentType: 'application/javascript' }));
  }
  const fonts = process.env.FONTS_DIR;
  if (fonts) {
    await page.route(/fonts\.googleapis\.com/, r => r.fulfill({ path: path.join(fonts, 'fonts.css'), contentType: 'text/css' }));
    await page.route(/fonts\.gstatic\.com/, r => r.fulfill({ path: path.join(fonts, path.basename(new URL(r.request().url()).pathname)), contentType: 'font/woff2' }));
  }
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const fragment = fs.readFileSync(path.join(SRC, 'animaciya.html'), 'utf8');
  fs.writeFileSync(path.join(DIST, 'index.html'), wrapPage(fragment));

  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];

  // кадры шагов
  const page = await browser.newPage({ viewport: { width: 1600, height: 700 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('анимация: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('анимация: ' + m.text()); });
  await routes(page);
  await page.goto('file://' + path.join(DIST, 'index.html') + '?kadr', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.anim && window.anim.count > 0, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const steps = await page.evaluate(() => window.anim.steps);
  const shot = async (name, i, t, cam, bez) => {
    const args = [i, t, cam || null, !!bez];
    await page.evaluate(a => window.anim.goto(a[0], a[1], a[2], a[3]), args);
    await page.waitForTimeout(250);
    await page.evaluate(a => window.anim.goto(a[0], a[1], a[2], a[3]), args);
    const file = path.join(TMP, name);
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    return file;
  };
  const images = [];
  // момент кадра внутри шага: почти конец; там, где важнее процесс (пила, воздух, стопка до тента, рулон) — раньше
  const moment = { 5: 0.64, 6: 0.86, 7: 0.6, 8: 0.78, 9: 0.5, 10: 0.8, 15: 0.7 };
  for (let i = 0; i < steps.length; i++) {
    const n = String(i + 1).padStart(2, '0');
    images.push(await shot('shag-' + n + '.jpg', i, moment[i + 1] || 0.97, 'pdf'));
  }
  const cover = await shot('obzor.jpg', 13, 0.97, 'obzor', true);
  await page.close();

  // данные для инструкции
  const qrSvg = await QRCode.toString(ANIM_URL, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1F2933', light: '#FFFFFF' } });
  const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const data = {
    steps: steps.map((s, i) => Object.assign({}, s, { img: path.basename(images[i]) })),
    cover: path.basename(cover), qrSvg, animUrl: ANIM_URL, date
  };
  fs.writeFileSync(path.join(TMP, 'data.js'), 'window.DATA=' + JSON.stringify(data) + ';\n');
  fs.copyFileSync(path.join(SRC, 'instrukciya.html'), path.join(TMP, 'instrukciya.html'));

  const doc = await browser.newPage();
  // проверка вёрстки — в ширину листа A4 без полей (182 мм = 688 px)
  await doc.emulateMedia({ media: 'print' });
  await doc.setViewportSize({ width: 688, height: 1000 });
  doc.on('pageerror', e => errors.push('инструкция: ' + e.message));
  await routes(doc);
  await doc.goto('file://' + path.join(TMP, 'instrukciya.html'), { waitUntil: 'networkidle' });
  await doc.waitForFunction(() => window.READY === true, null, { timeout: 30000 });
  const over = await doc.evaluate(() => [...document.querySelectorAll('.page')]
    .map((p, i) => p.scrollHeight > p.clientHeight + 1 ? 'страница ' + (i + 1) + ': не помещается на ' + (p.scrollHeight - p.clientHeight) + ' px' : null)
    .filter(Boolean));
  over.forEach(o => errors.push('инструкция: ' + o));
  await doc.pdf({ path: path.join(DIST, PDF_NAME), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await browser.close();

  if (errors.length) { console.error('Ошибки:\n' + errors.join('\n')); process.exitCode = 1; }
  console.log('Готово: ' + path.join(DIST, 'index.html') + ', ' + path.join(DIST, PDF_NAME));
})();
