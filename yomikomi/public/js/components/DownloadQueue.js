/**
 * DownloadQueue Component
 * Floating download queue progress widget
 */

import { initIcons } from '../state.js';

let isQueuePausedLocal = false;
let isQueueMinimizedLocal = false;
let lastQueueState = null;

export function renderDownloadQueueMarkup() {
  return `
    <div class="download-queue-widget hidden" id="download-queue-widget">
      <div class="queue-widget-header" id="queue-widget-header">
        <div class="queue-widget-title" id="queue-widget-title-area">
          <div class="spinner-small" id="queue-status-spinner"></div>
          <span id="queue-header-title">Mengunduh Chapter...</span>
        </div>
        <div class="queue-widget-actions">
          <button class="queue-action-btn" id="btn-queue-pause" title="Jeda / Lanjutkan Unduhan" aria-label="Jeda atau Lanjutkan" type="button">
            <i data-lucide="pause" id="queue-pause-icon"></i>
          </button>
          <button class="queue-action-btn" id="btn-queue-minimize" title="Perkecil / Sembunyikan" aria-label="Perkecil Antrean" type="button">
            <i data-lucide="minus" id="queue-minimize-icon"></i>
          </button>
          <button class="queue-action-btn" id="btn-queue-cancel" title="Batalkan Semua Unduhan" aria-label="Batalkan Semua" type="button">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="queue-widget-body" id="queue-widget-body">
        <div class="queue-info-row">
          <span class="queue-chapter-label" id="queue-chapter-label">Chapter ...</span>
          <span class="queue-pages-label" id="queue-pages-label">0/0 Hal</span>
        </div>
        <div class="queue-progress-track">
          <div class="queue-progress-fill" id="queue-progress-fill" style="width: 0%;"></div>
        </div>
        <div class="queue-footer-row">
          <span id="queue-remaining-label">0 chapter lagi di antrean</span>
          <span id="queue-percent-label">0%</span>
        </div>
      </div>
    </div>
  `;
}

export function initDownloadQueueEvents() {
  const btnPause = document.getElementById('btn-queue-pause');
  const btnCancel = document.getElementById('btn-queue-cancel');
  const btnMinimize = document.getElementById('btn-queue-minimize');
  const titleArea = document.getElementById('queue-widget-title-area');
  const widget = document.getElementById('download-queue-widget');

  const toggleMinimize = () => {
    isQueueMinimizedLocal = !isQueueMinimizedLocal;
    if (widget) {
      widget.classList.toggle('minimized', isQueueMinimizedLocal);
    }
    const icon = document.getElementById('queue-minimize-icon');
    if (icon) {
      icon.setAttribute('data-lucide', isQueueMinimizedLocal ? 'chevron-up' : 'minus');
      btnMinimize?.setAttribute('title', isQueueMinimizedLocal ? 'Perbesar Antrean' : 'Perkecil Antrean');
      btnMinimize?.setAttribute('aria-label', isQueueMinimizedLocal ? 'Perbesar Antrean' : 'Perkecil Antrean');
      initIcons();
    }
    if (lastQueueState) {
      updateDownloadQueueUI(lastQueueState);
    }
  };

  btnMinimize?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMinimize();
  });

  // Clicking on title area when minimized will expand it back
  titleArea?.addEventListener('click', () => {
    if (isQueueMinimizedLocal) {
      toggleMinimize();
    }
  });

  btnPause?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof OfflineManager !== 'undefined') {
      isQueuePausedLocal = !isQueuePausedLocal;
      OfflineManager.setPaused(isQueuePausedLocal);
      const icon = document.getElementById('queue-pause-icon');
      if (icon) {
        icon.setAttribute('data-lucide', isQueuePausedLocal ? 'play' : 'pause');
        initIcons();
      }
    }
  });

  btnCancel?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof OfflineManager !== 'undefined') {
      if (confirm('Batalkan seluruh antrean download yang sedang berjalan?')) {
        OfflineManager.cancelAll();
        hideDownloadQueueWidget();
      }
    }
  });

  // Subscribe to OfflineManager queue updates
  if (typeof OfflineManager !== 'undefined' && OfflineManager.subscribe) {
    OfflineManager.subscribe((queueState) => {
      lastQueueState = queueState;
      updateDownloadQueueUI(queueState);
    });
  }
}

export function updateDownloadQueueUI(queueState) {
  const widget = document.getElementById('download-queue-widget');
  if (!widget) return;

  const isWorking = queueState.isProcessing && queueState.activeItem;
  const queueItems = queueState.queue || queueState.items || [];
  const hasQueue = queueItems.length > 0;

  if (!isWorking && !hasQueue) {
    widget.classList.add('hidden');
    return;
  }

  widget.classList.remove('hidden');

  const p = queueState.progress || queueState.activeProgress || {};
  const chapterLabel = document.getElementById('queue-chapter-label');
  const pagesLabel = document.getElementById('queue-pages-label');
  const fill = document.getElementById('queue-progress-fill');
  const percentLabel = document.getElementById('queue-percent-label');
  const remainingLabel = document.getElementById('queue-remaining-label');
  const headerTitle = document.getElementById('queue-header-title');

  if (chapterLabel) chapterLabel.textContent = `Chapter ${p.chapterNum || '...'}`;
  if (pagesLabel) pagesLabel.textContent = `${p.currentPages || 0}/${p.totalPages || 0} Hal`;
  if (fill) fill.style.width = `${p.percent || 0}%`;
  if (percentLabel) percentLabel.textContent = `${p.percent || 0}%`;

  const remaining = queueItems.length;
  if (remainingLabel) {
    remainingLabel.textContent = remaining > 0 ? `${remaining} chapter lagi di antrean` : 'Menyelesaikan unduhan...';
  }

  if (headerTitle) {
    if (widget.classList.contains('minimized')) {
      const statusText = queueState.isPaused ? 'Dijeda' : 'Unduh';
      headerTitle.textContent = `${statusText} Ch.${p.chapterNum || ''} (${p.percent || 0}%)`;
    } else {
      headerTitle.textContent = queueState.isPaused ? 'Unduhan Dijeda' : 'Mengunduh Chapter...';
    }
  }
}

export function hideDownloadQueueWidget() {
  const widget = document.getElementById('download-queue-widget');
  widget?.classList.add('hidden');
}
