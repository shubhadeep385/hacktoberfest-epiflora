import puppeteer, { type Page } from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const OUT_DIR = path.resolve(process.cwd(), 'docs');
const VIDEO_PATH = path.join(OUT_DIR, 'epiflora_demo_walkthrough.mp4');

/**
 * Smooth natural scrolling with custom duration and settling pause
 */
async function smoothScrollTo(page: Page, targetY: number, waitMs: number = 3500) {
  await page.evaluate((y: number) => {
    window.scrollTo({ top: y, behavior: 'smooth' });
  }, targetY);
  await new Promise((r) => setTimeout(r, waitMs));
}

/**
 * Click a sidebar navigation link inside AppShell with settling pause
 */
async function clickSidebarItem(page: Page, linkText: string, pauseAfterMs: number = 4000) {
  console.log(`  👉 Clicking sidebar navigation: "${linkText}"...`);
  await page.evaluate((text: string) => {
    const navLinks = Array.from(document.querySelectorAll('nav[aria-label="Main"] a, aside a, a'));
    const target = navLinks.find((el) => el.textContent?.trim().toLowerCase().includes(text.toLowerCase()));
    if (target) {
      (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
      (target as HTMLElement).click();
    }
  }, linkText);
  await new Promise((r) => setTimeout(r, pauseAfterMs));
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  console.log('🎬 Starting Cinematic Full-Length EpiFLora Walkthrough Recording...');
  console.log(`📁 Target Output: ${VIDEO_PATH}`);

  // Standard crisp presentation viewport (1440x900 with 1.25 scale gives large, clear, natural font sizes)
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=angle',
      '--window-size=1536,960',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.333 });

  // Spawn ffmpeg to encode screenshots stream to crisp 1080p MP4
  const ffmpeg = spawn('/opt/homebrew/bin/ffmpeg', [
    '-y',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    '-r',
    '30',
    '-i',
    '-',
    '-vf',
    'scale=1920:1080:flags=lanczos',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'slow',
    '-crf',
    '18',
    VIDEO_PATH,
  ]);

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('fps=') || msg.includes('Error')) {
      process.stdout.write(`\r🎥 FFmpeg: ${msg.trim().split('\n').pop()}`);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('❌ FFmpeg process error:', err);
  });

  const client = await page.createCDPSession();
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: 1920,
    maxHeight: 1200,
    everyNthFrame: 1,
  });

  client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    try {
      const buffer = Buffer.from(data, 'base64');
      if (ffmpeg.stdin.writable) {
        ffmpeg.stdin.write(buffer);
      }
      await client.send('Page.screencastFrameAck', { sessionId });
    } catch {
      // Ignore if screencast session ending
    }
  });

  const BASE_URL = 'http://localhost:5173';

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: COMPLETE HOMEPAGE TOUR (Unrushed, full sections with pauses)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n[PHASE 1] 🌐 Touring Full Cinematic Flagship Homepage...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });

  // 1. Hero Section & Interactive Wheat Video Canvas
  console.log('  📍 Section 1: Hero Banner & Living Canvas (Pause 4s)...');
  await new Promise((r) => setTimeout(r, 4000));

  // 2. Multispectral Farm Signals Radar
  console.log('  📍 Section 2: Multispectral Farm Signals Radar (Pause 4s)...');
  await smoothScrollTo(page, 780, 4000);

  // 3. Crop Doctor Preview
  console.log('  📍 Section 3: Crop Doctor Specimen Preview (Pause 4s)...');
  await smoothScrollTo(page, 1550, 4000);

  // 4. Voice Copilot Preview
  console.log('  📍 Section 4: Multilingual Voice Copilot Preview (Pause 4s)...');
  await smoothScrollTo(page, 2350, 4000);

  // 5. Weather & Soil Heuristics Preview
  console.log('  📍 Section 5: Weather & Soil Telemetry Preview (Pause 4s)...');
  await smoothScrollTo(page, 3150, 4000);

  // 6. BRICS Sovereign 3D Network Preview
  console.log('  📍 Section 6: BRICS Sovereign Network Preview (Pause 4s)...');
  await smoothScrollTo(page, 3950, 4000);

  // 7. Living Soil Biome Section
  console.log('  📍 Section 7: Living Soil Biome & Rhizosphere (Pause 4s)...');
  await smoothScrollTo(page, 4750, 4000);

  // 8. Hackathon Honors & Final CTA
  console.log('  📍 Section 8: Hackathon Honors & DPG Footer (Pause 4.5s)...');
  await smoothScrollTo(page, 5600, 4500);

  // Smooth scroll back to top of Homepage
  console.log('  📍 Smoothly scrolling back to top of Homepage...');
  await smoothScrollTo(page, 0, 3000);

  console.log('\n[PHASE 2] 🚀 Clicking "Open EpiFlora" to Enter Application Workspace...');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('a')).find((el) => el.textContent?.includes('Open EpiFlora'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 3500));

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3: COMPREHENSIVE SIDEBAR FEATURE WALKTHROUGH
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n[PHASE 3] 🧭 Navigating through all Workspace Features via Sidebar...');

  // Feature 1: Farm Dashboard
  console.log('\n[Feature 1/7] 🔲 Sidebar: Farm Dashboard Overview...');
  await clickSidebarItem(page, 'Farm dashboard', 2000);
  await smoothScrollTo(page, 450, 3000);
  await smoothScrollTo(page, 0, 2000);

  // Feature 2: Crop Doctor
  console.log('\n[Feature 2/7] 🍃 Sidebar: Crop Doctor Multimodal Pathology...');
  await clickSidebarItem(page, 'Crop Doctor', 3500);

  // Demonstrate Grapevine specimen
  console.log('  👉 Switching specimen to Grapevine Downy Mildew (Pause 4s)...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const grapeBtn = buttons.find((b) => b.textContent?.includes('Grapevine') || b.textContent?.includes('Downy Mildew'));
    if (grapeBtn) (grapeBtn as HTMLButtonElement).click();
  });
  await new Promise((r) => setTimeout(r, 4000));

  // Demonstrate Tomato Early Blight specimen
  console.log('  👉 Switching specimen back to Tomato Early Blight (Pause 4s)...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const tomatoBtn = buttons.find((b) => b.textContent?.includes('Tomato') || b.textContent?.includes('Early Blight'));
    if (tomatoBtn) (tomatoBtn as HTMLButtonElement).click();
  });
  await new Promise((r) => setTimeout(r, 4000));

  console.log('\n[Feature 3/7] 🎙️ Sidebar: Ask EpiFlora Voice Copilot...');
  await clickSidebarItem(page, 'Ask EpiFlora', 3000);

  // Trigger regional Hindi voice query prompt
  console.log('  👉 Triggering spoken Hindi voice query with active waveform (Pause 5s)...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const promptBtn = buttons.find((b) => b.textContent?.includes('पीली') || b.textContent?.includes('yellow') || b.textContent?.includes('Tomato'));
    if (promptBtn) (promptBtn as HTMLButtonElement).click();
  });
  await new Promise((r) => setTimeout(r, 5000));

  // Feature 4: Weather Advisory
  console.log('\n[Feature 4/7] 🌤️ Sidebar: Weather & Deterministic Risk Advisory...');
  await clickSidebarItem(page, 'Weather advisory', 3000);
  await smoothScrollTo(page, 450, 3000);
  await smoothScrollTo(page, 0, 2000);

  // Feature 5: Soil Intelligence
  console.log('\n[Feature 5/7] 🌱 Sidebar: Soil Intelligence & Liebig Minimum Engine...');
  await clickSidebarItem(page, 'Soil intelligence', 3000);
  await smoothScrollTo(page, 450, 3000);
  await smoothScrollTo(page, 0, 2000);

  // Feature 6: BRICS Sovereign 3D Earth Network
  console.log('\n[Feature 6/7] 🌍 Sidebar: BRICS Sovereign 3D Earth Network...');
  await clickSidebarItem(page, 'BRICS network', 4000);

  // Click Brazil Hub
  console.log('  👉 Selecting Brazil Hub on 3D Earth (Pause 3.5s)...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const brazilBtn = buttons.find((b) => b.textContent?.includes('Brazil') || b.textContent?.includes('Embrapa'));
    if (brazilBtn) (brazilBtn as HTMLButtonElement).click();
  });
  await new Promise((r) => setTimeout(r, 3500));

  // Click South Africa Hub
  console.log('  👉 Selecting South Africa Hub on 3D Earth (Pause 3.5s)...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const saBtn = buttons.find((b) => b.textContent?.includes('South Africa') || b.textContent?.includes('ARC'));
    if (saBtn) (saBtn as HTMLButtonElement).click();
  });
  await new Promise((r) => setTimeout(r, 3500));

  // Click India Hub
  console.log('  👉 Selecting India Hub on 3D Earth (Pause 3.5s)...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const indiaBtn = buttons.find((b) => b.textContent?.includes('India') || b.textContent?.includes('ICAR'));
    if (indiaBtn) (indiaBtn as HTMLButtonElement).click();
  });
  await new Promise((r) => setTimeout(r, 3500));

  console.log('\n[Feature 7/7] 🏛️ Sidebar: How EpiFlora Works (Architecture & DPG)...');
  await clickSidebarItem(page, 'How EpiFlora works', 4000);

  // Return to Farm Dashboard for concluding summary
  console.log('\n🏁 Returning to Farm Dashboard for concluding overview (Pause 4s)...');
  await clickSidebarItem(page, 'Farm dashboard', 4000);

  // Stop screencast
  console.log('\n🛑 Finalizing screencast & closing FFmpeg encoder...');
  await client.send('Page.stopScreencast');
  ffmpeg.stdin.end();

  await new Promise<void>((resolve) => {
    ffmpeg.on('close', () => {
      console.log('\n🎉 Video encoding complete!');
      resolve();
    });
  });

  await browser.close();

  const stats = fs.statSync(VIDEO_PATH);
  console.log(`\n✅ EpiFlora Full Walkthrough Video Created Successfully!`);
  console.log(`📹 File: ${VIDEO_PATH} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error('❌ Failed to record video:', err);
  process.exit(1);
});
