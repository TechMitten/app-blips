import { chromium } from '@playwright/test';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1120, height: 800 }
  });
  const page = await context.newPage();
  
  // Clear local storage so onboarding triggers
  await page.goto('http://localhost:5199');
  await page.evaluate(() => localStorage.clear());
  
  await page.goto('http://localhost:5199');
  
  // Wait for onboarding to appear
  await page.waitForSelector('.desktop-onboarding');
  
  // Take screenshot
  await page.screenshot({ path: '/home/rayb/.gemini/antigravity-cli/brain/94b302f1-a0bd-4d19-b035-a47b5f9d074e/scratch/screenshot.png' });
  
  await browser.close();
})();
