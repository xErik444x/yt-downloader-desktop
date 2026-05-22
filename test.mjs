import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binPath = path.join(__dirname, 'bin');

// Colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;
let skipped = 0;

function log(color, msg) { console.log(`${color}${msg}${RESET}`); }
function pass(msg) { log(GREEN, `  ✓ ${msg}`); passed++; }
function fail(msg) { log(RED, `  ✗ ${msg}`); failed++; }
function skip(msg) { log(YELLOW, `  ⊘ ${msg}`); skipped++; }
function info(msg) { log(CYAN, `  → ${msg}`); }

function runCommand(exePath, args, options = {}) {
  return new Promise((resolve) => {
    const timeout = options.timeout || 15000;
    const cwd = options.cwd || __dirname;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(exePath, args, { cwd, timeout });
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('close', (code) => { resolve({ code, stdout, stderr, timedOut }); });
    child.on('error', (err) => { resolve({ code: -1, stdout, stderr: err.message, timedOut: false }); });
    setTimeout(() => { timedOut = true; child.kill(); resolve({ code: -1, stdout, stderr: 'Timed out', timedOut: true }); }, timeout);
  });
}

// ==================== Tests ====================

async function testDependencies() {
  log(BOLD, '\n📦 Dependencies');
  
  const deps = [
    { name: 'yt-dlp.exe', path: path.join(binPath, 'yt-dlp.exe'), versionArgs: ['--version'] },
    { name: 'ffmpeg.exe', path: path.join(binPath, 'ffmpeg.exe'), versionArgs: ['-version'] },
    { name: 'ffprobe.exe', path: path.join(binPath, 'ffprobe.exe'), versionArgs: ['-version'] },
    { name: 'spotdl.exe', path: path.join(binPath, 'spotdl.exe'), versionArgs: ['--version'] },
  ];
  
  for (const dep of deps) {
    if (fs.existsSync(dep.path)) {
      const result = await runCommand(dep.path, dep.versionArgs);
      if (result.code === 0) {
        const version = result.stdout.trim().split('\n')[0].slice(0, 50);
        pass(`${dep.name} OK (${version})`);
      } else {
        fail(`${dep.name} exists but failed to run`);
      }
    } else {
      if (dep.name === 'spotdl.exe') {
        skip(`${dep.name} not found (optional for Spotify)`);
      } else {
        fail(`${dep.name} not found`);
      }
    }
  }
}

async function testSpotifyOEmbed() {
  log(BOLD, '\n🎵 Spotify oEmbed API');
  
  const testCases = [
    { url: 'https://open.spotify.com/playlist/5MFN2Ep3ZU2FIQWIXNSLrT', type: 'playlist', expectSuccess: true },
    { url: 'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3', type: 'album', expectSuccess: true },
    { url: 'https://open.spotify.com/track/4cOdK2wGLETKw3Pv6flv4M', type: 'track', expectSuccess: false },
  ];
  
  for (const tc of testCases) {
    try {
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(tc.url)}`;
      const response = await fetch(oembedUrl);
      
      if (tc.expectSuccess) {
        if (response.ok) {
          const data = await response.json();
          if (data.title) pass(`${tc.type}: "${data.title}"`);
          else fail(`${tc.type}: no title in response`);
        } else {
          fail(`${tc.type}: HTTP ${response.status} (expected 200)`);
        }
      } else {
        if (response.status === 404) pass(`${tc.type}: correctly returns 404 (not supported)`);
        else if (response.ok) {
          const data = await response.json();
          pass(`${tc.type}: returned data (unexpected but OK)`);
        } else {
          fail(`${tc.type}: unexpected status ${response.status}`);
        }
      }
    } catch (err) {
      fail(`${tc.type}: ${err.message}`);
    }
  }
}

async function testSpotifyUrlParsing() {
  log(BOLD, '\n🔗 Spotify URL Parsing');
  
  const testCases = [
    { url: 'https://open.spotify.com/track/4cOdK2wGLETKw3Pv6flv4M', expectedType: 'track', expectedId: '4cOdK2wGLETKw3Pv6flv4M' },
    { url: 'https://open.spotify.com/playlist/5MFN2Ep3ZU2FIQWIXNSLrT?si=abc123', expectedType: 'playlist', expectedId: '5MFN2Ep3ZU2FIQWIXNSLrT' },
    { url: 'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3', expectedType: 'album', expectedId: '1DFixLWuPkv3KT3TnV35m3' },
    { url: 'https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg', expectedType: 'artist', expectedId: '0TnOYISbd1XYRBk9myaseg' },
    { url: 'invalid-url', expectedType: null },
  ];
  
  for (const tc of testCases) {
    const cleanUrl = tc.url.split('?')[0];
    const parts = cleanUrl.split('/');
    const typeIndex = parts.findIndex(p => ['track', 'playlist', 'album', 'artist'].includes(p));
    
    if (tc.expectedType === null) {
      if (typeIndex === -1) pass(`Invalid URL correctly rejected`);
      else fail(`Invalid URL should have been rejected`);
    } else {
      if (typeIndex !== -1 && typeIndex < parts.length - 1) {
        const parsedType = parts[typeIndex];
        const parsedId = parts[typeIndex + 1];
        if (parsedType === tc.expectedType && parsedId === tc.expectedId) {
          pass(`Parsed ${tc.expectedType}:${tc.expectedId}`);
        } else {
          fail(`Parsed ${parsedType}:${parsedId}, expected ${tc.expectedType}:${tc.expectedId}`);
        }
      } else {
        fail(`Failed to parse ${tc.url}`);
      }
    }
  }
}

async function testYtdlpBasic() {
  log(BOLD, '\n📺 yt-dlp Basic');
  
  const ytdlpPath = path.join(binPath, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpPath)) { fail('yt-dlp.exe not found'); return; }
  
  const result = await runCommand(ytdlpPath, ['--version'], { timeout: 10000 });
  if (result.code === 0) pass(`Version: ${result.stdout.trim()}`);
  else fail(`--version failed (code ${result.code})`);
}

async function testSpotdlBasic() {
  log(BOLD, '\n⬇️  spotdl Basic');
  
  const spotdlPath = path.join(binPath, 'spotdl.exe');
  if (!fs.existsSync(spotdlPath)) { skip('spotdl.exe not found'); return; }
  
  const result = await runCommand(spotdlPath, ['--version'], { timeout: 10000 });
  if (result.code === 0) pass(`Version: ${result.stdout.trim()}`);
  else fail(`--version failed (code ${result.code})`);
}

// ==================== Main ====================

async function main() {
  log(BOLD, '\n========================================');
  log(BOLD, '  YT Downloader Desktop - Test Suite');
  log(BOLD, '========================================\n');
  
  await testDependencies();
  await testSpotifyOEmbed();
  await testSpotifyUrlParsing();
  await testYtdlpBasic();
  await testSpotdlBasic();
  
  log(BOLD, '\n========================================');
  log(BOLD, '  Results');
  log(BOLD, '========================================');
  log(GREEN, `  Passed:   ${passed}`);
  if (failed > 0) log(RED, `  Failed:   ${failed}`);
  if (skipped > 0) log(YELLOW, `  Skipped:  ${skipped}`);
  log(BOLD, '========================================\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { log(RED, `Fatal: ${err.message}`); process.exit(1); });
