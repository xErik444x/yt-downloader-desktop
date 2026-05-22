// --- State Management ---
let currentUrlData = null;
const activeDownloads = new Map();

// --- DOM Elements ---
const depBanner = document.getElementById('dependency-banner');
const depBannerTitle = document.getElementById('dep-banner-title');
const depBannerDesc = document.getElementById('dep-banner-desc');
const downloadDepsBtn = document.getElementById('download-deps-btn');
const depProgressContainer = document.getElementById('dep-progress-container');
const depYtdlProgress = document.getElementById('dep-ytdl-progress');
const depFfmpegProgress = document.getElementById('dep-ffmpeg-progress');

const urlInput = document.getElementById('url-input');
const pasteBtn = document.getElementById('paste-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');

const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');

const metaSection = document.getElementById('meta-details-section');
const metaContent = document.getElementById('meta-details-content');

const downloadsContainer = document.getElementById('downloads-container');
const emptyDownloads = document.getElementById('empty-downloads');
const downloadCountBadge = document.getElementById('download-count-badge');
const openFolderBtn = document.getElementById('open-folder-btn');

// --- Helper Functions ---
function formatDuration(seconds) {
  if (!seconds) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateBadgeCount() {
  downloadCountBadge.textContent = activeDownloads.size;
}

// --- App Initialization ---
async function init() {
  await checkDependencies();
  setupEventListeners();
  setupIpcListeners();
}

// Check if binaries are installed
async function checkDependencies() {
  try {
    const deps = await window.api.checkDependencies();
    
    if (!deps.ytdl || !deps.ffmpeg) {
      depBanner.classList.remove('hidden');
      
      if (!deps.ytdl && !deps.ffmpeg) {
        depBannerTitle.textContent = 'Faltan Componentes Críticos';
        depBannerDesc.textContent = 'Para descargar y convertir medios, necesitamos instalar yt-dlp y FFmpeg en tu carpeta local.';
      } else if (!deps.ytdl) {
        depBannerTitle.textContent = 'Falta yt-dlp';
        depBannerDesc.textContent = 'El motor de descarga yt-dlp no está presente. Haz clic abajo para instalarlo.';
      } else {
        depBannerTitle.textContent = 'Falta FFmpeg';
        depBannerDesc.textContent = 'FFmpeg es necesario para fusionar videos en alta calidad y convertir archivos a MP3.';
      }
    } else {
      depBanner.classList.add('hidden');
    }
  } catch (error) {
    console.error('Error checking dependencies:', error);
  }
}

// Setup standard click handlers
function setupEventListeners() {
  // Paste button automation
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        analyzeUrl();
      }
    } catch (err) {
      console.error('Could not read clipboard:', err);
    }
  });

  // Trigger analysis on Enter key
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      analyzeUrl();
    }
  });

  // Analyze button click
  analyzeBtn.addEventListener('click', analyzeUrl);

  // Dependency installer button click
  downloadDepsBtn.addEventListener('click', installDependencies);

  // Open downloads folder
  openFolderBtn.addEventListener('click', async () => {
    await window.api.openDownloadFolder();
  });
}

// Listen for updates from Main process
function setupIpcListeners() {
  // 1. Dependency Download Progress
  window.api.onDependencyProgress((data) => {
    const { dependency, percent, status } = data;
    
    depProgressContainer.classList.remove('hidden');
    
    if (dependency === 'ytdl') {
      depYtdlProgress.classList.remove('hidden');
      const bar = depYtdlProgress.querySelector('.progress-bar-fill');
      const pctText = depYtdlProgress.querySelector('.dep-pct');
      bar.style.width = `${percent}%`;
      pctText.textContent = `${percent}%`;
    } 
    
    if (dependency === 'ffmpeg-download') {
      depFfmpegProgress.classList.remove('hidden');
      const bar = depFfmpegProgress.querySelector('.progress-bar-fill');
      const pctText = depFfmpegProgress.querySelector('.dep-pct');
      bar.style.width = `${percent}%`;
      pctText.textContent = `${percent}%`;
    }

    if (dependency === 'ffmpeg-extract') {
      depFfmpegProgress.classList.remove('hidden');
      const bar = depFfmpegProgress.querySelector('.progress-bar-fill');
      const pctText = depFfmpegProgress.querySelector('.dep-pct');
      bar.style.width = `100%`;
      pctText.textContent = 'Extrayendo...';
    }
  });

  // 2. Media Download Progress
  window.api.onDownloadProgress((data) => {
    const { downloadId, status, percent, speed, size, eta, currentTrack, totalTracks } = data;
    const card = document.getElementById(downloadId);
    if (!card) return;

    const fill = card.querySelector('.progress-bar-fill');
    const percentText = card.querySelector('.download-percent');
    const speedText = card.querySelector('.download-speed');
    const sizeText = card.querySelector('.download-size');
    const etaText = card.querySelector('.download-eta');
    const detailText = card.querySelector('.download-detail');

    if (status === 'playlist-track') {
      if (detailText) detailText.textContent = `Descargando pista ${currentTrack} de ${totalTracks}...`;
    }

    if (status === 'downloading') {
      if (fill) fill.style.width = `${percent}%`;
      if (percentText) percentText.textContent = `${percent.toFixed(1)}%`;
      if (speedText) speedText.textContent = speed;
      if (sizeText) sizeText.textContent = size;
      if (etaText) etaText.textContent = `Quedan ${eta}`;
    }

    if (status === 'merging') {
      if (fill) fill.style.width = `99%`;
      if (percentText) percentText.textContent = `99%`;
      if (speedText) speedText.textContent = '-';
      if (etaText) etaText.textContent = 'Fusionando audio y video...';
    }

    if (status === 'extracting') {
      if (fill) fill.style.width = `99%`;
      if (percentText) percentText.textContent = `99%`;
      if (speedText) speedText.textContent = '-';
      if (etaText) etaText.textContent = 'Convirtiendo a MP3...';
    }
  });

  // 3. Download finished
  window.api.onDownloadFinished((data) => {
    const { downloadId } = data;
    const card = document.getElementById(downloadId);
    if (!card) return;

    card.classList.add('status-completed');
    
    const fill = card.querySelector('.progress-bar-fill');
    const percentText = card.querySelector('.download-percent');
    const etaText = card.querySelector('.download-eta');
    const cancelBtn = card.querySelector('.btn-cancel');

    if (fill) fill.style.width = `100%`;
    if (percentText) percentText.textContent = `100%`;
    if (etaText) etaText.textContent = '¡Completado!';
    
    // Change cancel button to open folder button
    if (cancelBtn) {
      cancelBtn.className = 'btn btn-secondary btn-sm btn-open-folder';
      cancelBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        Ver archivo
      `;
      // Click handler
      cancelBtn.replaceWith(cancelBtn.cloneNode(true));
      const newBtn = card.querySelector('.btn-open-folder');
      newBtn.addEventListener('click', async () => {
        await window.api.openDownloadFolder();
      });
    }

    activeDownloads.delete(downloadId);
    updateBadgeCount();
  });

  // 4. Download error
  window.api.onDownloadError((data) => {
    const { downloadId, error } = data;
    const card = document.getElementById(downloadId);
    if (!card) return;

    card.classList.add('status-error');
    
    const fill = card.querySelector('.progress-bar-fill');
    const percentText = card.querySelector('.download-percent');
    const etaText = card.querySelector('.download-eta');
    const cancelBtn = card.querySelector('.btn-cancel');

    if (fill) fill.style.width = `0%`;
    if (percentText) percentText.textContent = `Error`;
    if (etaText) etaText.textContent = `Error: ${error || 'Descarga interrumpida'}`;
    
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Fallido';
    }

    activeDownloads.delete(downloadId);
    updateBadgeCount();
  });

  // 5. Silent boot dependency update complete
  window.api.onDependenciesUpdated(() => {
    checkDependencies();
  });
}

// Download Dependency logic
async function installDependencies() {
  downloadDepsBtn.disabled = true;
  downloadDepsBtn.textContent = 'Instalando...';
  
  try {
    const deps = await window.api.checkDependencies();
    
    if (!deps.ytdl) {
      depProgressContainer.classList.remove('hidden');
      depYtdlProgress.classList.remove('hidden');
      await window.api.downloadDependency('ytdl');
    }
    
    if (!deps.ffmpeg) {
      depProgressContainer.classList.remove('hidden');
      depFfmpegProgress.classList.remove('hidden');
      await window.api.downloadDependency('ffmpeg');
    }

    // Refresh state
    await checkDependencies();
    
    // Hide progress elements after success
    setTimeout(() => {
      depProgressContainer.classList.add('hidden');
      depYtdlProgress.classList.add('hidden');
      depFfmpegProgress.classList.add('hidden');
      downloadDepsBtn.disabled = false;
      downloadDepsBtn.textContent = 'Instalar Ahora';
    }, 2000);
    
  } catch (error) {
    console.error('Error installing dependencies:', error);
    depBannerTitle.textContent = 'Fallo en la Instalación';
    depBannerDesc.textContent = `Ocurrió un error: ${error.message}`;
    downloadDepsBtn.disabled = false;
    downloadDepsBtn.textContent = 'Reintentar';
  }
}

// Analyze URL trigger
async function analyzeUrl() {
  const url = urlInput.value.trim();
  if (!url) return;

  // Clear previous state
  errorContainer.classList.add('hidden');
  metaSection.classList.add('hidden');
  metaContent.innerHTML = '';
  
  // Show spinner
  btnText.classList.add('hidden');
  btnSpinner.classList.remove('hidden');
  analyzeBtn.disabled = true;

  try {
    const data = await window.api.analyzeUrl(url);
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    currentUrlData = data;
    renderMetadata(data);
    metaSection.classList.remove('hidden');
    
  } catch (error) {
    console.error('Error analyzing URL:', error);
    errorMessage.textContent = `No se pudo analizar el enlace. Asegúrate de que sea un enlace válido de YouTube. Detalle: ${error.message}`;
    errorContainer.classList.remove('hidden');
  } finally {
    // Hide spinner
    btnText.classList.remove('hidden');
    btnSpinner.classList.add('hidden');
    analyzeBtn.disabled = false;
  }
}

// Render metadata card based on response
function renderMetadata(data) {
  if (data.type === 'video') {
    // Filter formats to have readable, unique options
    // High-res formats are typically split (video-only) in YouTube, yt-dlp merges automatically
    const defaultOption = '<option value="best" selected>Mejor Calidad (Video + Audio MP4/MKV)</option>';
    
    // Select unique video resolutions to list them cleanly
    const seenHeights = new Set();
    const cleanFormats = [];
    
    // Sort formats so high res is first
    const sortedFormats = [...data.formats].sort((a,b) => {
      const getH = (str) => parseInt(str.replace('p',''), 10) || 0;
      return getH(b.resolution) - getH(a.resolution);
    });

    for (const f of sortedFormats) {
      if (f.resolution !== 'audio' && f.vcodec !== 'none') {
        const height = f.resolution;
        if (!seenHeights.has(height)) {
          seenHeights.add(height);
          cleanFormats.push(f);
        }
      }
    }

    const formatOptionsHTML = cleanFormats.map(f => {
      const fpsStr = f.fps ? ` @ ${f.fps}fps` : '';
      const sizeStr = f.filesize ? ` (~${(f.filesize / 1024 / 1024).toFixed(1)} MB)` : '';
      return `<option value="${f.formatId}">${f.resolution}${fpsStr}${sizeStr}</option>`;
    }).join('');

    metaContent.innerHTML = `
      <div class="meta-layout">
        <div class="meta-thumbnail-wrapper">
          <img class="meta-thumbnail" src="${data.thumbnail || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?q=80&w=300'}" alt="Thumbnail">
          <span class="meta-duration">${formatDuration(data.duration)}</span>
        </div>
        
        <div class="meta-info">
          <h3 class="meta-title" title="${data.title}">${data.title}</h3>
          <div class="meta-uploader">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>${data.uploader}</span>
          </div>

          <div class="download-options-grid">
            <div class="option-group">
              <label for="video-format">Formato de Descarga</label>
              <select id="video-format" class="select-input">
                ${defaultOption}
                ${formatOptionsHTML}
                <option value="audio-only">Sólo Audio (Alta Calidad MP3)</option>
              </select>
            </div>
            <div class="option-group" style="justify-content: flex-end;">
              <button id="start-dl-btn" class="btn btn-primary btn-gradient" style="width: 100%;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Descargar Video
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('start-dl-btn').addEventListener('click', triggerVideoDownload);

  } else if (data.type === 'playlist') {
    // Render Playlist Details
    const tracksHTML = data.entries.map(t => `
      <div class="playlist-track-row">
        <span class="playlist-track-title">${t.index}. ${t.title}</span>
        <span class="playlist-track-duration">${formatDuration(t.duration)}</span>
      </div>
    `).join('');

    metaContent.innerHTML = `
      <div class="meta-info">
        <h3 class="meta-title" title="${data.title}">📁 Lista: ${data.title}</h3>
        <div class="meta-uploader">
          <span>Contiene <strong>${data.count}</strong> canciones/videos</span>
        </div>

        <div class="playlist-preview">
          ${tracksHTML}
        </div>

        <div class="download-options-grid">
          <div class="option-group">
            <label for="playlist-format">Tipo de Archivo</label>
            <select id="playlist-format" class="select-input">
              <option value="audio-only" selected>Sólo Audio (Música MP3 - Alta Calidad)</option>
              <option value="best">Video Completo (MP4/MKV)</option>
            </select>
          </div>
          
          <div class="option-group">
            <label for="playlist-range">Rango de Descarga (Opcional)</label>
            <input type="text" id="playlist-range" class="text-input" placeholder="Ej: 1-5, 8, 10-15 (Vacío para todo)">
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
          <button id="start-dl-playlist-btn" class="btn btn-primary btn-gradient" style="min-width: 200px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Descargar Playlist
          </button>
        </div>
      </div>
    `;

    document.getElementById('start-dl-playlist-btn').addEventListener('click', triggerPlaylistDownload);
  }
}

// Start video download trigger
async function triggerVideoDownload() {
  const formatSelect = document.getElementById('video-format');
  const format = formatSelect.value;
  const isAudio = format === 'audio-only';
  
  const downloadId = 'dl-' + Date.now();
  const title = currentUrlData.title;
  
  createDownloadCard({
    downloadId,
    title,
    isAudio,
    isPlaylist: false
  });

  const result = await window.api.startDownload({
    url: urlInput.value.trim(),
    format: isAudio ? null : format,
    isAudio,
    downloadId
  });

  if (!result.success) {
    // Notify error
    window.api.onDownloadError({ downloadId, error: result.error });
  } else {
    activeDownloads.set(downloadId, true);
    updateBadgeCount();
  }
}

// Start playlist download trigger
async function triggerPlaylistDownload() {
  const formatSelect = document.getElementById('playlist-format');
  const rangeInput = document.getElementById('playlist-range');
  const format = formatSelect.value;
  const isAudio = format === 'audio-only';
  const range = rangeInput.value.trim() || null;

  const downloadId = 'dl-' + Date.now();
  const title = currentUrlData.title;

  createDownloadCard({
    downloadId,
    title,
    isAudio,
    isPlaylist: true
  });

  const result = await window.api.startDownload({
    url: urlInput.value.trim(),
    format: isAudio ? null : 'best',
    isAudio,
    playlistItems: range,
    downloadId
  });

  if (!result.success) {
    window.api.onDownloadError({ downloadId, error: result.error });
  } else {
    activeDownloads.set(downloadId, true);
    updateBadgeCount();
  }
}

// Create Card in Downloads Manager UI
function createDownloadCard({ downloadId, title, isAudio, isPlaylist }) {
  // Hide empty downloads text
  emptyDownloads.classList.add('hidden');

  let typeBadge = '';
  if (isPlaylist) {
    typeBadge = '<span class="download-badge badge-playlist">Playlist</span>';
  } else if (isAudio) {
    typeBadge = '<span class="download-badge badge-audio">Audio</span>';
  } else {
    typeBadge = '<span class="download-badge badge-video">Video</span>';
  }

  const cardHTML = `
    <div class="download-card" id="${downloadId}">
      <div class="download-info-row">
        <div class="download-title-area">
          <span class="download-title" title="${title}">${title}</span>
          <div class="download-meta">
            ${typeBadge}
            <span class="download-detail">Iniciando descarga...</span>
          </div>
        </div>
        <button class="btn btn-danger btn-sm btn-cancel">Cancelar</button>
      </div>

      <div class="progress-container">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: 0%"></div>
        </div>
        <div class="download-stats">
          <div class="download-stats-left">
            <span class="download-speed">- MB/s</span>
            <span class="download-size">-</span>
          </div>
          <span class="download-eta">Preparando...</span>
          <span class="download-percent">0%</span>
        </div>
      </div>
    </div>
  `;

  // Inject at the top of the downloads list
  downloadsContainer.insertAdjacentHTML('afterbegin', cardHTML);
  
  // Bind cancel button click
  const card = document.getElementById(downloadId);
  const cancelBtn = card.querySelector('.btn-cancel');
  cancelBtn.addEventListener('click', async () => {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelando...';
    await window.api.cancelDownload(downloadId);
  });
}

// Bootstrap
document.addEventListener('DOMContentLoaded', init);
