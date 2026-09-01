import { chromium } from 'playwright';

const url = process.env.URL || 'http://localhost:5174';
const out = process.env.OUT || '/tmp/opencode/shot-chat.png';
const dark = process.env.DARK === '1';
const width = parseInt(process.env.W || '1600', 10);
const height = parseInt(process.env.H || '1000', 10);

const proj = {
  id: 'test-1',
  name: 'Test App',
  data: {
    versions: [
      { id: 'v1', prompt: 'A habit tracker with weekly streaks', reply: 'Here is your habit tracker app. It has a weekly streak grid, daily check-off buttons, and a summary card.' },
      { id: 'v2', prompt: 'Make the header dark and add a reset button', reply: 'Updated. The header now uses a dark surface, and a reset button clears all check-offs for the current week.' },
    ],
    currentVersionIndex: 1,
  },
  updatedAt: Date.now(),
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.addInitScript((proj) => {
  localStorage.setItem('orion-projects', JSON.stringify([proj]));
  localStorage.setItem('orion-current-project-id', proj.id);
}, proj);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
