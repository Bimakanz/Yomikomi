/**
 * AnimeWatchPage
 * Modern 2-column layout (70% Video Player + 30% Episode list),
 * Playback controls (Prev/Next, Auto-Next, Cinema Mode dimmer, Server/Resolution picker),
 * and AniList Smart Cross-Link (📖 Baca Komik)
 */

import { state, initIcons, showToast, saveAnimeHistory } from '../state.js';

export function renderAnimeWatchPageMarkup() {
  return `
    <section class="view-section hidden" id="view-anime-watch">
      <!-- Cinema Mode Overlay Dimmer -->
      <div class="cinema-dimmer hidden" id="cinema-dimmer"></div>

      <div class="anime-watch-container">
        <!-- Top Navigation & Breadcrumbs Bar -->
        <div class="anime-watch-nav">
          <button class="btn-back" id="btn-back-from-watch" type="button">
            <i data-lucide="arrow-left"></i>
            <span>Kembali</span>
          </button>
          <div class="anime-watch-breadcrumbs">
            <span class="anime-nav-title" id="watch-breadcrumb-title">Memuat Anime...</span>
            <span class="breadcrumb-separator">/</span>
            <span class="anime-nav-ep" id="watch-breadcrumb-ep">Episode 1</span>
          </div>
        </div>

        <!-- Modern 2-Column Grid -->
        <div class="anime-watch-grid">
          <!-- Left Column (70%): Video Player & Controls & Anime Info -->
          <div class="anime-player-col">
            <div class="video-player-wrapper" id="video-player-wrapper">
              <video class="anime-video-player" id="anime-video-player" controls preload="metadata" playsinline poster="https://placehold.co/1280x720/14151a/8b5cf6?text=Memuat+Player...">
                <source id="video-source" src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" type="video/mp4">
                Browser Anda tidak mendukung HTML5 video.
              </video>
              <div class="video-overlay-loader hidden" id="video-overlay-loader">
                <div class="spinner-small"></div>
              </div>
            </div>

            <!-- Video Player Controls Bar -->
            <div class="player-controls-bar">
              <div class="controls-left">
                <button class="player-ctrl-btn" id="btn-anime-prev-ep" title="Episode Sebelumnya" type="button">
                  <i data-lucide="skip-back"></i>
                  <span>Ep Sebelumnya</span>
                </button>
                <button class="player-ctrl-btn" id="btn-anime-next-ep" title="Episode Selanjutnya" type="button">
                  <span>Ep Selanjutnya</span>
                  <i data-lucide="skip-forward"></i>
                </button>
              </div>

              <div class="controls-right">
                <!-- Auto-Next Toggle -->
                <label class="toggle-auto-next" title="Putar episode selanjutnya secara otomatis saat selesai">
                  <input type="checkbox" id="chk-auto-next" checked>
                  <span class="toggle-slider"></span>
                  <span class="toggle-label">Auto-Next</span>
                </label>

                <!-- Cinema Mode Dimmer Toggle -->
                <button class="player-ctrl-btn" id="btn-cinema-mode" title="Gelapkan Layar (Cinema Mode)" type="button">
                  <i data-lucide="lamp"></i>
                  <span>Cinema Mode</span>
                </button>

                <!-- Server & Resolution Picker -->
                <div class="server-picker-wrap">
                  <i data-lucide="server" class="server-icon"></i>
                  <select class="server-select" id="select-anime-server" title="Pilih Server & Resolusi">
                    <option value="1">Server 1 (FHD 1080p • Direct)</option>
                    <option value="2">Server 2 (HD 720p • Fast)</option>
                    <option value="3">Server 3 (CDN Mirror)</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Anime Info & Smart Cross-Link Section -->
            <div class="anime-meta-card">
              <div class="anime-meta-header">
                <div class="anime-titles-wrap">
                  <h1 class="anime-main-title" id="anime-info-title">Memuat...</h1>
                  <p class="anime-native-title" id="anime-info-native"></p>
                </div>
                <div class="anime-badges-row">
                  <span class="badge-tag rating-badge" id="anime-info-rating">⭐ --</span>
                  <span class="badge-tag accent" id="anime-info-status">ONGOING</span>
                  <span class="badge-tag" id="anime-info-format">TV</span>
                </div>
              </div>

              <!-- Cross-link button slot for related manga -->
              <div class="anime-actions-row">
                <div class="anime-crosslink-slot" id="anime-manga-crosslink-slot"></div>
              </div>

              <div class="anime-synopsis-box">
                <h4 class="synopsis-heading">Sinopsis</h4>
                <p id="anime-info-desc">Memuat sinopsis anime...</p>
              </div>

              <div class="anime-tags-row" id="anime-info-genres">
                <!-- Genre tags -->
              </div>
            </div>
          </div>

          <!-- Right Column (30%): Scrollable Episode List -->
          <div class="anime-episodes-col">
            <div class="episodes-card">
              <div class="episodes-card-header">
                <div class="episodes-title-wrap">
                  <i data-lucide="layers"></i>
                  <h3 class="episodes-card-title">Daftar Episode</h3>
                </div>
                <span class="episodes-count-pill" id="episodes-count-pill">0 Ep</span>
              </div>

              <div class="episodes-search-box">
                <i data-lucide="search"></i>
                <input type="text" id="input-search-episode" placeholder="Cari episode... (misal: 1, 12)">
              </div>

              <div class="episodes-list-scrollable" id="episodes-list-container">
                <!-- Rendered dynamically -->
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

// Sample streaming servers
const SERVER_STREAMS = {
  1: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  2: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  3: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4'
};

export async function openAnimeWatch(animeId, epNumber = 1, maybeAnimeData = null) {
  if (typeof window.switchView === 'function') {
    window.switchView('anime-watch');
  }

  state.currentAnimeId = animeId;
  state.currentAnimeEpisode = parseInt(epNumber, 10) || 1;

  let anime = maybeAnimeData;

  // Optimistic initial render if data provided
  if (anime) {
    state.currentAnime = anime;
    renderAnimeDetails(anime, state.currentAnimeEpisode);
  }

  try {
    const res = await fetch(`/api/anime/${animeId}`);
    const data = await res.json();
    if (data.data) {
      anime = data.data;
      state.currentAnime = anime;
      renderAnimeDetails(anime, state.currentAnimeEpisode);
    }
  } catch (err) {
    console.error('Failed to fetch anime details:', err);
  }

  if (anime) {
    loadEpisode(state.currentAnimeEpisode);
  }
}

export function renderAnimeDetails(anime, activeEp = 1) {
  const title = typeof anime.title === 'string' 
    ? anime.title 
    : (anime.title?.romaji || anime.title?.english || anime.titleObj?.romaji || 'Judul Anime');
  const nativeTitle = typeof anime.title === 'object' 
    ? (anime.title.native || anime.title.english || '') 
    : (anime.titleObj?.native || anime.titleObj?.english || '');
  const score = anime.rating || (anime.averageScore ? `⭐ ${(anime.averageScore / 10).toFixed(1)}` : '⭐ 8.0');
  const status = (anime.status || 'RELEASING').toUpperCase();
  const format = anime.format || 'TV';
  const desc = (anime.description || 'Sinopsis tidak tersedia.').replace(/<[^>]*>/g, ' ');
  const genres = anime.genres || ['Action', 'Fantasy'];
  const totalEps = anime.episodes || 12;

  // Breadcrumb
  const bTitle = document.getElementById('watch-breadcrumb-title');
  const bEp = document.getElementById('watch-breadcrumb-ep');
  if (bTitle) bTitle.textContent = title;
  if (bEp) bEp.textContent = `Episode ${activeEp}`;

  // Info header
  const titleEl = document.getElementById('anime-info-title');
  const nativeEl = document.getElementById('anime-info-native');
  const ratingEl = document.getElementById('anime-info-rating');
  const statusEl = document.getElementById('anime-info-status');
  const formatEl = document.getElementById('anime-info-format');
  const descEl = document.getElementById('anime-info-desc');
  const genresEl = document.getElementById('anime-info-genres');
  const epCountPill = document.getElementById('episodes-count-pill');

  if (titleEl) titleEl.textContent = title;
  if (nativeEl) nativeEl.textContent = nativeTitle;
  if (ratingEl) ratingEl.textContent = score;
  if (statusEl) statusEl.textContent = status;
  if (formatEl) formatEl.textContent = format;
  if (descEl) descEl.textContent = desc;
  if (epCountPill) epCountPill.textContent = `${totalEps} Ep`;

  if (genresEl) {
    genresEl.innerHTML = genres.map(g => `<span class="detail-tag">${g}</span>`).join('');
  }

  // Smart Cross-Link: Show 📖 Baca Komik if relatedManga exists
  const crosslinkSlot = document.getElementById('anime-manga-crosslink-slot');
  if (crosslinkSlot) {
    if (anime.relatedManga) {
      const mangaTitle = anime.relatedManga.title?.romaji || anime.relatedManga.title?.english || 'Manga Terkait';
      crosslinkSlot.innerHTML = `
        <button class="btn-crosslink btn-manga-crosslink" id="btn-watch-manga-crosslink" type="button" title="Baca Sumber Manga: ${mangaTitle}">
          <i data-lucide="book-open"></i>
          <span>📖 Baca Komik: ${mangaTitle}</span>
        </button>
      `;
      crosslinkSlot.querySelector('#btn-watch-manga-crosslink')?.addEventListener('click', () => {
        if (typeof window.openMangaDetail === 'function') {
          window.openMangaDetail(anime.relatedManga.id, anime.relatedManga);
        }
      });
    } else {
      crosslinkSlot.innerHTML = '';
    }
  }

  renderEpisodeList(totalEps, activeEp);
  initIcons();
}

export function renderEpisodeList(totalEps, activeEp = 1, filterQuery = '') {
  const container = document.getElementById('episodes-list-container');
  if (!container) return;

  container.innerHTML = '';
  const q = filterQuery.toLowerCase().trim();

  for (let i = 1; i <= totalEps; i++) {
    const epTitle = `Episode ${i}`;
    if (q && !epTitle.toLowerCase().includes(q) && !String(i).includes(q)) {
      continue;
    }

    const item = document.createElement('div');
    item.className = `episode-item ${i === activeEp ? 'active' : ''}`;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.dataset.ep = i;
    item.innerHTML = `
      <div class="ep-left">
        <span class="ep-num-badge">${i}</span>
        <div class="ep-info">
          <span class="ep-title">${epTitle}</span>
          <span class="ep-sub-badge">Sub Indo • 1080p</span>
        </div>
      </div>
      <div class="ep-status-icon">
        <i data-lucide="${i === activeEp ? 'play' : 'chevron-right'}"></i>
      </div>
    `;

    item.addEventListener('click', () => {
      loadEpisode(i);
    });

    container.appendChild(item);
  }

  initIcons();
}

export function loadEpisode(epNumber) {
  state.currentAnimeEpisode = epNumber;
  const anime = state.currentAnime;
  if (!anime) return;

  // Update Breadcrumb
  const bEp = document.getElementById('watch-breadcrumb-ep');
  if (bEp) bEp.textContent = `Episode ${epNumber}`;

  // Update active episode item highlight
  document.querySelectorAll('.episode-item').forEach(el => {
    const isAct = parseInt(el.dataset.ep, 10) === epNumber;
    el.classList.toggle('active', isAct);
    const icon = el.querySelector('.ep-status-icon i');
    if (icon) {
      icon.setAttribute('data-lucide', isAct ? 'play' : 'chevron-right');
    }
  });

  // Load video source based on server selection
  const serverSelect = document.getElementById('select-anime-server');
  const serverId = serverSelect ? serverSelect.value : 1;
  const videoEl = document.getElementById('anime-video-player');
  const videoSrc = document.getElementById('video-source');

  const streamUrl = SERVER_STREAMS[serverId] || SERVER_STREAMS[1];

  if (videoSrc && videoEl) {
    videoSrc.src = streamUrl;
    videoEl.load();
    videoEl.play().catch(() => {
      // Autoplay with audio might be blocked by browser policy
    });
  }

  // Update Prev / Next Buttons states
  const prevBtn = document.getElementById('btn-anime-prev-ep');
  const nextBtn = document.getElementById('btn-anime-next-ep');
  const totalEps = anime.episodes || 12;

  if (prevBtn) prevBtn.disabled = epNumber <= 1;
  if (nextBtn) nextBtn.disabled = epNumber >= totalEps;

  // Persist history into local storage
  saveAnimeHistory({
    animeId: anime.id,
    title: anime.title || anime.titleObj?.romaji || 'Anime',
    coverUrl: anime.coverUrl || '',
    episode: epNumber,
    episodeTitle: `Episode ${epNumber}`,
    totalEpisodes: totalEps,
    progress: `${Math.min(100, Math.round((epNumber / totalEps) * 100))}%`
  });

  initIcons();
}

export function initAnimeWatchPageEvents() {
  const prevBtn = document.getElementById('btn-anime-prev-ep');
  const nextBtn = document.getElementById('btn-anime-next-ep');
  const backBtn = document.getElementById('btn-back-from-watch');
  const cinemaBtn = document.getElementById('btn-cinema-mode');
  const dimmer = document.getElementById('cinema-dimmer');
  const serverSelect = document.getElementById('select-anime-server');
  const searchInput = document.getElementById('input-search-episode');
  const videoEl = document.getElementById('anime-video-player');
  const autoNextChk = document.getElementById('chk-auto-next');

  // Back button
  backBtn?.addEventListener('click', () => {
    if (typeof window.switchView === 'function') {
      window.switchView(state.previousView || 'home');
    }
  });

  // Prev / Next Episode controls
  prevBtn?.addEventListener('click', () => {
    if (state.currentAnimeEpisode > 1) {
      loadEpisode(state.currentAnimeEpisode - 1);
    }
  });

  nextBtn?.addEventListener('click', () => {
    const totalEps = state.currentAnime?.episodes || 12;
    if (state.currentAnimeEpisode < totalEps) {
      loadEpisode(state.currentAnimeEpisode + 1);
    }
  });

  // Server & Resolution Switcher
  serverSelect?.addEventListener('change', () => {
    loadEpisode(state.currentAnimeEpisode);
  });

  // Cinema Mode Dimmer Toggle
  let isCinemaActive = false;
  const toggleCinemaMode = () => {
    isCinemaActive = !isCinemaActive;
    dimmer?.classList.toggle('hidden', !isCinemaActive);
    document.getElementById('video-player-wrapper')?.classList.toggle('cinema-focus', isCinemaActive);
    cinemaBtn?.classList.toggle('active', isCinemaActive);
  };

  cinemaBtn?.addEventListener('click', toggleCinemaMode);
  dimmer?.addEventListener('click', toggleCinemaMode);

  // Auto-Next playback event
  videoEl?.addEventListener('ended', () => {
    if (autoNextChk && autoNextChk.checked) {
      const totalEps = state.currentAnime?.episodes || 12;
      if (state.currentAnimeEpisode < totalEps) {
        showToast(`Memutar Episode ${state.currentAnimeEpisode + 1}...`);
        loadEpisode(state.currentAnimeEpisode + 1);
      }
    }
  });

  // Search episode filter
  searchInput?.addEventListener('input', (e) => {
    const val = e.target.value;
    const totalEps = state.currentAnime?.episodes || 12;
    renderEpisodeList(totalEps, state.currentAnimeEpisode, val);
  });

  initIcons();
}

// Window global bindings
if (typeof window !== 'undefined') {
  window.openAnimeWatch = openAnimeWatch;
  window.loadEpisode = loadEpisode;
}
