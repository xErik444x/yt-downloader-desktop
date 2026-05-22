import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, exec } from 'child_process';
import util from 'util';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

// Startup performance optimizations
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WinUseBrowserSpellChecker');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');

const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.join(__dirname, '..');
const binPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'bin')
  : path.join(projectDir, 'bin');

// Create bin folder if it doesn't exist
if (!fs.existsSync(binPath)) {
  fs.mkdirSync(binPath, { recursive: true });
}

let mainWindow = null;
const activeDownloads = new Map();
let isYtdlpDownloading = false;
let isSpotdlDownloading = false;
let customDownloadFolder = null;

function isSpotifyUrl(url) {
  return url.includes('spotify.com/') || url.includes('open.spotify.com/');
}

function getDownloadFolder() {
  return customDownloadFolder || app.getPath('downloads');
}

async function ensureYtdlp() {
  const ytdlpPath = path.join(binPath, 'yt-dlp.exe');
  if (fs.existsSync(ytdlpPath) || isYtdlpDownloading) {
    return;
  }
  
  isYtdlpDownloading = true;
  console.log('yt-dlp.exe is missing. Downloading automatically on boot...');
  
  try {
    const ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    await downloadWithProgress(ytdlpUrl, ytdlpPath, 'ytdl');
    console.log('yt-dlp.exe downloaded successfully on boot.');
    if (mainWindow) {
      mainWindow.webContents.send('dependencies-updated');
    }
  } catch (error) {
    console.error('Failed to download yt-dlp on boot:', error);
  } finally {
    isYtdlpDownloading = false;
  }
}

async function ensureSpotdl() {
  const spotdlPath = path.join(binPath, 'spotdl.exe');
  if (fs.existsSync(spotdlPath) || isSpotdlDownloading) {
    return;
  }
  
  isSpotdlDownloading = true;
  console.log('spotdl.exe is missing. Downloading automatically on boot...');
  
  try {
    const spotdlUrl = await getLatestSpotdlUrl();
    await downloadWithProgress(spotdlUrl, spotdlPath, 'spotdl');
    console.log('spotdl.exe downloaded successfully on boot.');
    if (mainWindow) {
      mainWindow.webContents.send('dependencies-updated');
    }
  } catch (error) {
    console.error('Failed to download spotdl on boot:', error);
  } finally {
    isSpotdlDownloading = false;
  }
}

async function getLatestSpotdlUrl() {
  const response = await fetch('https://api.github.com/repos/spotDL/spotify-downloader/releases/latest');
  if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
  const release = await response.json();
  const asset = release.assets.find(a => a.name.endsWith('-win32.exe'));
  if (!asset) throw new Error('No Windows executable found in latest release');
  return asset.browser_download_url;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden', // Make it frameless and premium-looking
    titleBarOverlay: {
      color: '#0f172a',
      symbolColor: '#f8fafc',
      height: 40
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#090d16',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Kill any remaining active downloads on exit
    for (const [id, child] of activeDownloads.entries()) {
      try {
        child.kill();
      } catch (err) {
        console.error('Error killing child process on exit:', err);
      }
    }
    activeDownloads.clear();
  });
}

app.whenReady().then(() => {
  createWindow();
  ensureYtdlp();
  ensureSpotdl();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Helper to check executable presence
function getExePaths() {
  const ytdlp = path.join(binPath, 'yt-dlp.exe');
  const fallbackYtdl = path.join(projectDir, 'youtube-dl.exe');
  const ffmpeg = path.join(binPath, 'ffmpeg.exe');
  const ffprobe = path.join(binPath, 'ffprobe.exe');
  const spotdl = path.join(binPath, 'spotdl.exe');

  return {
    ytdlp: fs.existsSync(ytdlp) ? ytdlp : (fs.existsSync(fallbackYtdl) ? fallbackYtdl : null),
    ffmpeg: fs.existsSync(ffmpeg) ? ffmpeg : null,
    ffprobe: fs.existsSync(ffprobe) ? ffprobe : null,
    spotdl: fs.existsSync(spotdl) ? spotdl : null
  };
}

// 1. IPC Handler: Check dependencies
ipcMain.handle('check-dependencies', () => {
  const paths = getExePaths();
  return {
    ytdl: paths.ytdlp !== null,
    ffmpeg: paths.ffmpeg !== null && paths.ffprobe !== null,
    spotdl: paths.spotdl !== null
  };
});

// Helper to download files with progress
async function downloadWithProgress(url, destPath, eventName) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  
  const totalBytes = parseInt(response.headers.get('content-length'), 10) || 0;
  const fileStream = fs.createWriteStream(destPath);
  const nodeStream = Readable.fromWeb(response.body);
  
  let downloadedBytes = 0;
  
  nodeStream.on('data', (chunk) => {
    downloadedBytes += chunk.length;
    if (totalBytes > 0 && mainWindow) {
      const percent = (downloadedBytes / totalBytes) * 100;
      mainWindow.webContents.send('dependency-progress', {
        dependency: eventName,
        percent: parseFloat(percent.toFixed(1)),
        loaded: downloadedBytes,
        total: totalBytes
      });
    }
  });

  await new Promise((resolve, reject) => {
    nodeStream.pipe(fileStream);
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
    nodeStream.on('error', reject);
  });
}

// 2. IPC Handler: Download dependency
ipcMain.handle('download-dependency', async (event, depName) => {
  try {
    if (depName === 'ytdl') {
      if (isYtdlpDownloading) {
        // Wait until silent download completes
        while (isYtdlpDownloading) {
          await new Promise(r => setTimeout(r, 100));
        }
        return { success: true };
      }
      const ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
      const dest = path.join(binPath, 'yt-dlp.exe');
      isYtdlpDownloading = true;
      try {
        await downloadWithProgress(ytdlpUrl, dest, 'ytdl');
      } finally {
        isYtdlpDownloading = false;
      }
      return { success: true };
    } 
    
    if (depName === 'ffmpeg') {
      const ffmpegUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
      const zipDest = path.join(binPath, 'ffmpeg.zip');
      
      // Download ZIP
      await downloadWithProgress(ffmpegUrl, zipDest, 'ffmpeg-download');
      
      // Extract ZIP using PowerShell (native Windows)
      if (mainWindow) {
        mainWindow.webContents.send('dependency-progress', {
          dependency: 'ffmpeg-extract',
          percent: 100,
          status: 'extracting'
        });
      }
      
      const psCommand = `powershell -NoProfile -Command "Expand-Archive -Path '${zipDest}' -DestinationPath '${binPath}' -Force; Get-ChildItem -Path '${binPath}' -Filter 'ffmpeg.exe' -Recurse | Copy-Item -Destination '${binPath}' -Force; Get-ChildItem -Path '${binPath}' -Filter 'ffprobe.exe' -Recurse | Copy-Item -Destination '${binPath}' -Force; Get-ChildItem -Path '${binPath}' -Directory | Where-Object { $_.Name -like 'ffmpeg-*' } | Remove-Item -Recurse -Force; Remove-Item -Path '${zipDest}' -Force"`;
      
      await execPromise(psCommand);
      
      return { success: true };
    }

    if (depName === 'spotdl') {
      if (isSpotdlDownloading) {
        while (isSpotdlDownloading) {
          await new Promise(r => setTimeout(r, 100));
        }
        return { success: true };
      }
      const spotdlUrl = await getLatestSpotdlUrl();
      const dest = path.join(binPath, 'spotdl.exe');
      isSpotdlDownloading = true;
      try {
        await downloadWithProgress(spotdlUrl, dest, 'spotdl');
      } finally {
        isSpotdlDownloading = false;
      }
      return { success: true };
    }
    
    throw new Error(`Unknown dependency: ${depName}`);
  } catch (error) {
    console.error(`Error downloading ${depName}:`, error);
    return { success: false, error: error.message };
  }
});

// Helper to run executable and get string stdout
function runExec(args) {
  const paths = getExePaths();
  if (!paths.ytdlp) {
    throw new Error('yt-dlp.exe (or youtube-dl.exe) was not found. Please install dependencies.');
  }
  
  return new Promise((resolve, reject) => {
    const child = spawn(paths.ytdlp, args);
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });
  });
}

// Helper to run spotdl and get string stdout
function runSpotdl(args) {
  const paths = getExePaths();
  if (!paths.spotdl) {
    throw new Error('spotdl.exe was not found. Please install Spotify dependency.');
  }
  
  // Add ffmpeg path if available
  const finalArgs = [];
  if (paths.ffmpeg) {
    finalArgs.push('--ffmpeg', paths.ffmpeg);
  }
  finalArgs.push(...args);
  
  return new Promise((resolve, reject) => {
    const child = spawn(paths.spotdl, finalArgs);
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });
  });
}

// 3. IPC Handler: Analyze URL (Detect playlist/video and fetch metadata)
ipcMain.handle('analyze-url', async (event, url) => {
  try {
    // Check if it's a Spotify URL
    if (isSpotifyUrl(url)) {
      return await analyzeSpotifyUrl(url);
    }

    // Check flat playlist first to make it fast
    const flatData = await runExec(['--dump-json', '--flat-playlist', url]);
    
    // Split lines. Flat-playlist returns one line per item if it's a playlist, or one line for the video.
    const lines = flatData.trim().split('\n').filter(l => l.trim().length > 0);
    
    if (lines.length === 0) {
      throw new Error('Could not parse response from yt-dlp.');
    }
    
    // Parse the first line to check structure
    const firstItem = JSON.parse(lines[0]);
    
    // If it's a playlist, flat-playlist dump will show entries with playlist info, or we can see it from the structure
    // Actually, in newer yt-dlp, flat-playlist of a playlist returns multiple lines (each being a flat entry),
    // and if we want the playlist metadata itself, it might be in the lines or we can check the URL.
    // Let's check if the first item has `_type === 'playlist'` or if there are multiple lines (which implies a playlist).
    // Note: a flat-playlist output for a single video has 1 line with `_type` undefined (or not 'playlist').
    
    const isPlaylist = firstItem._type === 'playlist' || lines.length > 1;
    
    if (isPlaylist) {
      // If it returned a single playlist object with entries in it
      if (firstItem._type === 'playlist') {
        return {
          type: 'playlist',
          title: firstItem.title || 'Playlist',
          id: firstItem.id,
          count: firstItem.entries ? firstItem.entries.length : 0,
          entries: (firstItem.entries || []).map((e, index) => ({
            index: index + 1,
            title: e.title || `Track ${index + 1}`,
            id: e.id,
            duration: e.duration || 0
          }))
        };
      } else {
        // It returned multiple lines (each representing a video in the playlist)
        // We can infer the playlist title from the first item if it contains playlist_title, or just use a placeholder
        const playlistTitle = firstItem.playlist_title || firstItem.playlist || 'Playlist';
        return {
          type: 'playlist',
          title: playlistTitle,
          id: firstItem.playlist_id || 'playlist',
          count: lines.length,
          entries: lines.map((line, index) => {
            const item = JSON.parse(line);
            return {
              index: index + 1,
              title: item.title || `Track ${index + 1}`,
              id: item.id,
              duration: item.duration || 0
            };
          })
        };
      }
    } else {
      // It is a single video. Let's fetch the full details (without --flat-playlist) to get formats!
      const fullData = await runExec(['--dump-json', url]);
      const videoDetail = JSON.parse(fullData);
      
      // Filter and format available options for the user
      // We want to extract unique resolutions/formats
      const formats = (videoDetail.formats || [])
        .filter(f => f.vcodec !== 'none' || f.acodec !== 'none') // has video or audio
        .map(f => ({
          formatId: f.format_id,
          ext: f.ext,
          resolution: f.resolution || (f.height ? `${f.height}p` : 'audio'),
          fps: f.fps || null,
          filesize: f.filesize || f.filesize_approx || null,
          vcodec: f.vcodec,
          acodec: f.acodec,
          note: f.format_note || ''
        }));

      return {
        type: 'video',
        title: videoDetail.title,
        id: videoDetail.id,
        duration: videoDetail.duration || 0,
        uploader: videoDetail.uploader || videoDetail.channel || 'Unknown',
        thumbnail: videoDetail.thumbnail || (videoDetail.thumbnails && videoDetail.thumbnails.length ? videoDetail.thumbnails[videoDetail.thumbnails.length - 1].url : null),
        formats: formats
      };
    }
  } catch (error) {
    console.error('Error analyzing URL:', error);
    return { error: error.message };
  }
});

// Helper to analyze Spotify URLs
async function analyzeSpotifyUrl(url) {
  try {
    const cleanUrl = url.split('?')[0];
    const parts = cleanUrl.split('/');
    const typeIndex = parts.findIndex(p => ['track', 'playlist', 'album', 'artist', 'episode', 'show'].includes(p));
    
    if (typeIndex === -1 || typeIndex >= parts.length - 1) {
      return { error: 'URL de Spotify no válida. Asegúrate de que sea un link de track, playlist o álbum.' };
    }
    
    const spotifyType = parts[typeIndex];
    const spotifyId = parts[typeIndex + 1];

    // Try oEmbed API (works for playlists/albums, not tracks)
    if (spotifyType === 'playlist' || spotifyType === 'album') {
      try {
        const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
        const response = await fetch(oembedUrl);
        
        if (response.ok) {
          const oembedData = await response.json();
          return {
            type: 'spotify-playlist',
            title: oembedData.title || `Spotify ${spotifyType === 'playlist' ? 'Playlist' : 'Album'}`,
            artist: oembedData.author_name || 'Unknown',
            count: 0,
            duration: 0,
            thumbnail: oembedData.thumbnail_url || null,
            id: spotifyId,
            entries: []
          };
        }
      } catch (err) {
        console.warn('oEmbed failed, using fallback:', err.message);
      }
    }

    // Fallback for tracks or if oEmbed fails
    if (spotifyType === 'track') {
      return {
        type: 'spotify-track',
        title: `Spotify Track (${spotifyId})`,
        artist: 'Unknown Artist',
        album: 'Spotify',
        duration: 0,
        thumbnail: null,
        id: spotifyId
      };
    }

    return {
      type: 'spotify-playlist',
      title: `Spotify ${spotifyType.charAt(0).toUpperCase() + spotifyType.slice(1)}`,
      artist: 'Unknown',
      count: 0,
      duration: 0,
      thumbnail: null,
      id: spotifyId,
      entries: []
    };
  } catch (error) {
    console.error('Error analyzing Spotify URL:', error);
    return { error: `Error analizando URL de Spotify: ${error.message}` };
  }
}

// 4. IPC Handler: Start Download
ipcMain.handle('start-download', (event, options) => {
  const { url, format, isAudio, playlistItems, downloadId } = options;
  const paths = getExePaths();
  
  // Check if it's a Spotify URL
  if (isSpotifyUrl(url)) {
    return startSpotifyDownload({ url, isAudio, playlistItems, downloadId });
  }
  
  if (!paths.ytdlp) {
    return { success: false, error: 'yt-dlp not found' };
  }
  
  const downloadFolder = getDownloadFolder();
  const args = [];
  
  // Basic settings
  args.push('--newline');
  args.push('--progress');
  
  // Set FFmpeg location if available
  if (paths.ffmpeg) {
    args.push('--ffmpeg-location', binPath);
  }
  
  // Select format / audio conversion
  if (isAudio) {
    args.push('-x');
    args.push('--audio-format', 'mp3');
    args.push('--audio-quality', '0'); // Best quality MP3
  } else if (format) {
    if (format === 'best') {
      // Best quality video with audio merged (standard yt-dlp behavior, merges with ffmpeg if needed)
      args.push('-f', 'bv*+ba/b');
    } else {
      // User selected a specific format (usually formatId)
      // If it has no audio (e.g. high-res webm/mp4), yt-dlp automatically merges it with the best audio
      args.push('-f', `${format}+ba/b`);
    }
  }
  
  // Playlist settings
  if (playlistItems !== null && playlistItems !== undefined) {
    if (playlistItems !== '') {
      args.push('--playlist-items', playlistItems);
    }
    // Put playlist in its own subfolder
    args.push('-o', path.join(downloadFolder, '%(playlist_title)s', '%(playlist_index)s - %(title)s.%(ext)s'));
  } else {
    args.push('--no-playlist');
    args.push('-o', path.join(downloadFolder, '%(title)s.%(ext)s'));
  }
  
  args.push(url);
  
  try {
    const child = spawn(paths.ytdlp, args);
    activeDownloads.set(downloadId, child);
    
    // Regular expressions to extract download progress info
    const progressRegex = /\[download\]\s+([\d.]+)%\s+of\s+([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)/;
    const playlistRegex = /\[download\]\s+Downloading\s+video\s+(\d+)\s+of\s+(\d+)/;
    const mergeRegex = /\[Merger\]|\[ffmpeg\]/i;
    const extractAudioRegex = /\[ExtractAudio\]/i;
    
    let lastPercent = 0;
    
    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        // 1. Check playlist progress
        const playlistMatch = line.match(playlistRegex);
        if (playlistMatch && mainWindow) {
          mainWindow.webContents.send('download-progress', {
            downloadId,
            status: 'playlist-track',
            currentTrack: parseInt(playlistMatch[1], 10),
            totalTracks: parseInt(playlistMatch[2], 10)
          });
          continue;
        }
        
        // 2. Check standard download progress
        const progressMatch = line.match(progressRegex);
        if (progressMatch && mainWindow) {
          const percent = parseFloat(progressMatch[1]);
          lastPercent = percent;
          mainWindow.webContents.send('download-progress', {
            downloadId,
            status: 'downloading',
            percent,
            size: progressMatch[2],
            speed: progressMatch[3],
            eta: progressMatch[4]
          });
          continue;
        }
        
        // 3. Check merging phase
        if (mergeRegex.test(line) && mainWindow) {
          mainWindow.webContents.send('download-progress', {
            downloadId,
            status: 'merging',
            percent: 99
          });
          continue;
        }
        
        // 4. Check extracting audio phase
        if (extractAudioRegex.test(line) && mainWindow) {
          mainWindow.webContents.send('download-progress', {
            downloadId,
            status: 'extracting',
            percent: 99
          });
          continue;
        }
      }
    });
    
    child.stderr.on('data', (data) => {
      console.warn(`[yt-dlp-error] ${data.toString().trim()}`);
    });
    
    child.on('close', (code) => {
      activeDownloads.delete(downloadId);
      if (mainWindow) {
        if (code === 0) {
          mainWindow.webContents.send('download-finished', { downloadId });
        } else {
          // If code was not 0, it might be due to cancellation (which kills it) or a crash
          // We can check if it was cancelled
          mainWindow.webContents.send('download-error', { 
            downloadId, 
            error: `Process exited with code ${code}. Check URL or format compatibility.` 
          });
        }
      }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Failed to spawn yt-dlp:', error);
    activeDownloads.delete(downloadId);
    return { success: false, error: error.message };
  }
});

// Helper to start Spotify download using spotdl
function startSpotifyDownload(options) {
  const { url, isAudio, playlistItems, downloadId } = options;
  const paths = getExePaths();
  
  if (!paths.spotdl) {
    return { success: false, error: 'spotdl.exe not found' };
  }
  
  const downloadFolder = getDownloadFolder();
  
  // Clean URL - remove query parameters (spotdl rejects ?si=... params)
  const cleanUrl = url.split('?')[0];
  
  // Build args - URL must come right after subcommand for spotdl
  const args = [
    'download',
    cleanUrl,
    '--output', path.join(downloadFolder, '{artists}', '{title}'),
    '--format', 'mp3',
    '--bitrate', '320k',
    '--simple-tui',
  ];
  
  // Add ffmpeg path if available
  if (paths.ffmpeg) {
    args.push('--ffmpeg', paths.ffmpeg);
  }
  
  try {
    const child = spawn(paths.spotdl, args, { cwd: downloadFolder });
    activeDownloads.set(downloadId, child);
    
    const progressRegex = /\[(\d+)%\]/;
    const tqdmRegex = /(\d{1,3})%\|/;
    const trackRegex = /Downloading\s+(\d+)\s+of\s+(\d+)/i;
    const foundSongsRegex = /Found\s+(\d+)\s+songs?\s+in/i;
    const trackDownloadedRegex = /Downloaded\s+"[^"]*"/i;
    const allDoneRegex = /All\s+done|Done|Finished/i;
    
    // Send initial status
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', {
        downloadId,
        status: 'downloading',
        percent: 0,
        speed: '-',
        size: '-',
        eta: 'Buscando canciones...'
      });
    }
    
    let lastPercent = 0;
    let totalSongs = 0;
    let downloadedCount = 0;
    
    child.stdout.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        const foundMatch = line.match(foundSongsRegex);
        if (foundMatch && mainWindow) {
          totalSongs = parseInt(foundMatch[1], 10);
          mainWindow.webContents.send('download-progress', {
            downloadId,
            status: 'playlist-track',
            currentTrack: 0,
            totalTracks: totalSongs
          });
          continue;
        }
        
        const progressMatch = line.match(progressRegex) || line.match(tqdmRegex);
        if (progressMatch && mainWindow) {
          const percent = parseFloat(progressMatch[1]);
          if (percent >= lastPercent) {
            lastPercent = percent;
            mainWindow.webContents.send('download-progress', {
              downloadId,
              status: 'downloading',
              percent,
              speed: '-',
              size: '-',
              eta: '-'
            });
          }
          continue;
        }
        
        const trackMatch = line.match(trackRegex);
        if (trackMatch && mainWindow) {
          const current = parseInt(trackMatch[1], 10);
          const total = parseInt(trackMatch[2], 10);
          totalSongs = total;
          mainWindow.webContents.send('download-progress', {
            downloadId,
            status: 'playlist-track',
            currentTrack: current,
            totalTracks: total
          });
          continue;
        }
        
        if (trackDownloadedRegex.test(line)) {
          downloadedCount++;
          if (mainWindow && totalSongs > 0) {
            const overallPercent = Math.min(99, Math.round((downloadedCount / totalSongs) * 100));
            mainWindow.webContents.send('download-progress', {
              downloadId,
              status: 'playlist-track',
              currentTrack: downloadedCount,
              totalTracks: totalSongs
            });
          }
          continue;
        }
        
        if (allDoneRegex.test(line) && mainWindow) {
          mainWindow.webContents.send('download-progress', {
            downloadId,
            status: 'downloading',
            percent: 100,
            speed: '-',
            size: '-',
            eta: 'Completado'
          });
          continue;
        }
      }
    });
    
    child.stderr.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        const progressMatch = line.match(progressRegex) || line.match(tqdmRegex);
        if (progressMatch && mainWindow) {
          const percent = parseFloat(progressMatch[1]);
          if (percent >= lastPercent) {
            lastPercent = percent;
            mainWindow.webContents.send('download-progress', {
              downloadId,
              status: 'downloading',
              percent,
              speed: '-',
              size: '-',
              eta: '-'
            });
          }
          continue;
        }
        
        const foundMatch = line.match(foundSongsRegex);
        if (foundMatch && mainWindow) {
          totalSongs = parseInt(foundMatch[1], 10);
          mainWindow.webContents.send('download-progress', {
            downloadId,
            status: 'playlist-track',
            currentTrack: 0,
            totalTracks: totalSongs
          });
          continue;
        }
        
        if (trackDownloadedRegex.test(line)) {
          downloadedCount++;
          if (mainWindow && totalSongs > 0) {
            mainWindow.webContents.send('download-progress', {
              downloadId,
              status: 'playlist-track',
              currentTrack: downloadedCount,
              totalTracks: totalSongs
            });
          }
          continue;
        }
      }
    });
    
    child.on('close', (code) => {
      activeDownloads.delete(downloadId);
      if (mainWindow) {
        if (code === 0) {
          mainWindow.webContents.send('download-finished', { downloadId });
        } else {
          mainWindow.webContents.send('download-error', { 
            downloadId, 
            error: `spotdl exited with code ${code}. Verifica la URL de Spotify.` 
          });
        }
      }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Failed to spawn spotdl:', error);
    activeDownloads.delete(downloadId);
    return { success: false, error: error.message };
  }
}

// 5. IPC Handler: Cancel Download
ipcMain.handle('cancel-download', async (event, downloadId) => {
  const child = activeDownloads.get(downloadId);
  if (child) {
    try {
      if (process.platform === 'win32') {
        // On Windows use taskkill to forcefully terminate the process tree
        await execPromise(`taskkill /F /T /PID ${child.pid}`);
      } else {
        child.kill('SIGKILL');
      }
      activeDownloads.delete(downloadId);
      return { success: true };
    } catch (error) {
      // If taskkill fails because process already exited, that's fine
      activeDownloads.delete(downloadId);
      return { success: true };
    }
  }
  return { success: false, error: 'Download not found or already completed' };
});

// 6. IPC Handler: Open Download Folder
ipcMain.handle('open-download-folder', async () => {
  const downloadFolder = getDownloadFolder();
  try {
    await shell.openPath(downloadFolder);
    return { success: true };
  } catch (error) {
    console.error('Error opening downloads folder:', error);
    return { success: false, error: error.message };
  }
});

// 7. IPC Handler: Select Download Folder
ipcMain.handle('select-download-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Seleccionar Carpeta de Descargas'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    customDownloadFolder = result.filePaths[0];
    return customDownloadFolder;
  }
  return getDownloadFolder();
});

// 8. IPC Handler: Get Download Folder
ipcMain.handle('get-download-folder', () => {
  return getDownloadFolder();
});
