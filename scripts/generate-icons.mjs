/**
 * Generates all PWA icon sizes from the splash screen design.
 * Run via: make icons
 * Uses Playwright (already installed) — no extra dependencies.
 */

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'public', 'images');

const SIZES = [48, 72, 96, 144, 168, 192, 512];

function iconHtml(size) {
  const fontSize = Math.round(size * 0.52);
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=${size}, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${size}px; height: ${size}px; overflow: hidden; background: #0a0a0c; }
  .icon {
    width: ${size}px;
    height: ${size}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0a0a0c;
  }
  .letter {
    font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    font-size: ${fontSize}px;
    font-weight: 700;
    letter-spacing: -0.04em;
    line-height: 1;
    background: linear-gradient(135deg, #ffffff 20%, #a5b4fc 60%, #6366f1 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    user-select: none;
  }
</style>
</head>
<body>
  <div class="icon"><span class="letter">T</span></div>
</body>
</html>`;
}

async function generate() {
  const browser = await chromium.launch();

  for (const size of SIZES) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(iconHtml(size), { waitUntil: 'networkidle' });
    const out = join(OUT_DIR, `app-icon${size}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`  ✓ app-icon${size}.png`);
  }

  await browser.close();
  console.log('\nAll icons generated.');
}

generate().catch((err) => { console.error(err); process.exit(1); });
