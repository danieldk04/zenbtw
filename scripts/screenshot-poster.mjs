import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });
await page.goto('file://' + path.join(__dirname, 'test-poster.html'), { waitUntil: 'networkidle0', timeout: 15000 });
await new Promise(r => setTimeout(r, 1000));
const out = path.join(__dirname, 'test-poster.png');
await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1350 } });
await browser.close();
console.log('Saved:', out);
