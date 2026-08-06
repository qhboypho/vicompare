import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function renderSvgToPng() {
  const svgPath = path.join(rootDir, 'public', 'vicompare-logo.svg');
  const pngPath = path.join(rootDir, 'public', 'vicompare-app-icon.png');
  const svgContent = fs.readFileSync(svgPath, 'utf-8');

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; width: 1024px; height: 1024px; overflow: hidden; }
    svg { width: 1024px; height: 1024px; display: block; }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 }
  });
  await page.setContent(htmlContent);
  await page.screenshot({
    path: pngPath,
    type: 'png',
    omitBackground: false
  });
  await browser.close();
  console.log(`Rendered 1024x1024 App Icon PNG to: ${pngPath}`);
}

renderSvgToPng().catch(err => {
  console.error('Error rendering PNG:', err);
  process.exit(1);
});
