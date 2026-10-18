/**
 * MangaDex Reader - Client-Side Offline Storage & Download Queue Manager
 * Powered by Dexie.js (IndexedDB) & Cache Storage API
 * 100% Client-Side - Zero Server Bandwidth Cost
 */

(function (window) {
  'use strict';

  // Initialize Dexie IndexedDB
  const db = new Dexie('MangaDexOfflineDB');

  db.version(1).stores({
    manga: 'id, title, source, savedAt',
    chapters: 'id, mangaId, chapterNumber, title, totalPages, isDownloaded, downloadedAt, sizeInBytes, source',
    pages: '[chapterId+pageNumber], chapterId, pageNumber'
  });

  // Download Queue State
  const queueState = {
    queue: [],              // Array of { manga, chapter, source }
    activeItem: null,       // Currently processing chapter
    activeProgress: {
      chapterId: null,
      currentPages: 0,
      totalPages: 0,
      percent: 0,
      bytes: 0
    },
    isPaused: false,
    isProcessing: false,
    subscribers: new Set()  // Progress listener callbacks
  };

  /**
   * Helper: Validate whether a Blob is a genuine, non-corrupted image
   */
  function isValidImageBlob(blob) {
    if (!blob || !(blob instanceof Blob)) return false;
    // Real image is at least 60 bytes
    if (blob.size < 60) return false;
    const t = (blob.type || '').toLowerCase();
    if (t.includes('text') || t.includes('html') || t.includes('json')) {
      return false;
    }
    return true;
  }

  /**
   * Helper: Convert fetch response to Blob with timeout, validation, and multi-tier fallbacks
   */
  async function fetchImageAsBlob(url, referer, timeoutMs = 15000) {
    if (!url || typeof url !== 'string') {
      throw new Error('URL gambar tidak valid');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 1. If it's a relative URL on our own server (e.g. /api/cover/... or /api/proxy-image?url=...)
      // Fetch directly from our local backend - NO external proxy needed!
      if (url.startsWith('/')) {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Server lokal error HTTP ${res.status}`);
        const blob = await res.blob();
        if (isValidImageBlob(blob)) return blob;
        throw new Error('Respon dari server lokal bukan gambar yang valid');
      }

      // 2. Direct fetch for MangaDex @Home nodes (CORS open by default)
      if (url.includes('mangadex.network') || url.includes('uploads.mangadex.org')) {
        try {
          const directRes = await fetch(url, { signal: controller.signal, mode: 'cors' });
          if (directRes.ok) {
            const blob = await directRes.blob();
            if (isValidImageBlob(blob)) return blob;
          }
        } catch (e) {
          // Direct fetch failed (e.g. strict CORS on certain nodes), fallback to proxy below
        }
      }

      // 3. Primary fallback: Local server proxy (/api/proxy-image)
      try {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}${referer ? '&referer=' + encodeURIComponent(referer) : ''}`;
        const proxyRes = await fetch(proxyUrl, { signal: controller.signal });
        if (proxyRes.ok) {
          const blob = await proxyRes.blob();
          if (isValidImageBlob(blob)) return blob;
        }
      } catch (e) {}

      // 4. Secondary fallback: wsrv.nl (only for public external URLs, non-localhost, non-mangadex)
      if (url.startsWith('http') && !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('mangadex.network')) {
        try {
          const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=webp&q=85`;
          const wsrvRes = await fetch(wsrvUrl, { signal: controller.signal });
          if (wsrvRes.ok) {
            const blob = await wsrvRes.blob();
            if (isValidImageBlob(blob)) return blob;
          }
        } catch (e) {}
      }

      throw new Error(`Gagal mengunduh panel gambar dari: ${url.substring(0, 50)}...`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Helper: Concurrency limiter for downloading chapter pages
   */
  async function mapConcurrent(items, concurrency, fn) {
    const results = [];
    let index = 0;

    async function worker() {
      while (index < items.length) {
        if (queueState.isPaused) {
          await new Promise(resolve => {
            const check = setInterval(() => {
              if (!queueState.isPaused) {
                clearInterval(check);
                resolve();
              }
            }, 300);
          });
        }
        const currentIndex = index++;
        results[currentIndex] = await fn(items[currentIndex], currentIndex);
      }
    }

    const workers = Array(Math.min(concurrency, items.length)).fill(0).map(() => worker());
    await Promise.all(workers);
    return results;
  }

  /**
   * Offline Manager API
   */
  const OfflineManager = {
    db,

    /**
     * Subscribe to download progress updates
     */
    subscribe(callback) {
      queueState.subscribers.add(callback);
      return () => queueState.subscribers.delete(callback);
    },

    notifySubscribers() {
      const stateSnapshot = {
        queue: [...queueState.queue],
        activeItem: queueState.activeItem,
        progress: { ...queueState.activeProgress },
        isPaused: queueState.isPaused,
        isProcessing: queueState.isProcessing,
        totalInQueue: queueState.queue.length + (queueState.activeItem ? 1 : 0)
      };

      queueState.subscribers.forEach(cb => {
        try { cb(stateSnapshot); } catch (e) { console.error(e); }
      });
    },

    /**
     * Check if a chapter is downloaded and verify page blob integrity
     */
    async isChapterDownloaded(chapterId) {
      if (!chapterId) return false;
      const record = await db.chapters.get(chapterId);
      if (!record || !record.isDownloaded) return false;

      // Integrity validation: make sure stored pages are real image blobs
      const firstPage = await db.pages.where('chapterId').equals(chapterId).first();
      if (!firstPage || !firstPage.blob || !isValidImageBlob(firstPage.blob)) {
        // Corrupted records from previous error, clean up so user can re-download cleanly
        await db.pages.where('chapterId').equals(chapterId).delete();
        await db.chapters.delete(chapterId);
        return false;
      }
      return true;
    },

    /**
     * Get list of downloaded chapter IDs for a manga with integrity check
     */
    async getDownloadedChapterIds(mangaId) {
      const list = await db.chapters.where('mangaId').equals(mangaId).toArray();
      const validIds = [];
      for (const c of list) {
        if (c.isDownloaded) {
          const isValid = await this.isChapterDownloaded(c.id);
          if (isValid) validIds.push(c.id);
        }
      }
      return new Set(validIds);
    },

    /**
     * Get offline pages for a chapter (as Blobs)
     */
    async getOfflinePages(chapterId) {
      const pages = await db.pages.where('chapterId').equals(chapterId).sortBy('pageNumber');
      const valid = pages.filter(p => isValidImageBlob(p.blob));
      if (valid.length === 0 && pages.length > 0) {
        await this.deleteChapter(chapterId);
        return [];
      }
      return valid;
    },

    /**
     * Add single chapter to queue
     */
    async enqueueChapter(manga, chapter, source = 'mangadex') {
      const chapterId = chapter.id || chapter.url;
      const exists = await this.isChapterDownloaded(chapterId);
      if (exists) {
        if (window.showToast) window.showToast('Chapter ini sudah tersimpan offline!');
        return;
      }

      // Check if already in queue
      if (queueState.queue.some(item => (item.chapter.id || item.chapter.url) === chapterId) ||
          (queueState.activeItem && (queueState.activeItem.chapter.id || queueState.activeItem.chapter.url) === chapterId)) {
        if (window.showToast) window.showToast('Chapter ini sudah ada dalam antrean!');
        return;
      }

      queueState.queue.push({
        manga,
        chapter,
        source
      });

      if (window.showToast) {
        window.showToast(`Ditambahkan ke antrean unduh: Chapter ${chapter.number || chapter.title}`);
      }

      this.notifySubscribers();
      this.processQueue();
    },

    /**
     * Add multiple chapters to queue
     */
    async enqueueMultipleChapters(manga, chapters, source = 'mangadex') {
      let added = 0;
      for (const ch of chapters) {
        const chId = ch.id || ch.url;
        const exists = await this.isChapterDownloaded(chId);
        const inQueue = queueState.queue.some(item => (item.chapter.id || item.chapter.url) === chId) ||
                        (queueState.activeItem && (queueState.activeItem.chapter.id || queueState.activeItem.chapter.url) === chId);

        if (!exists && !inQueue) {
          queueState.queue.push({ manga, chapter: ch, source });
          added++;
        }
      }

      if (added > 0) {
        if (window.showToast) window.showToast(`Berhasil menambahkan ${added} chapter ke antrean unduh!`);
        this.notifySubscribers();
        this.processQueue();
      } else {
        if (window.showToast) window.showToast('Semua chapter yang dipilih sudah terunduh atau sudah di antrean.');
      }
    },

    /**
     * Queue controls: Pause, Resume, Cancel
     */
    pauseQueue() {
      queueState.isPaused = true;
      this.notifySubscribers();
    },

    resumeQueue() {
      queueState.isPaused = false;
      this.notifySubscribers();
      this.processQueue();
    },

    cancelChapter(chapterId) {
      queueState.queue = queueState.queue.filter(
        item => (item.chapter.id || item.chapter.url) !== chapterId
      );
      this.notifySubscribers();
    },

    cancelAll() {
      queueState.queue = [];
      queueState.activeItem = null;
      queueState.isProcessing = false;
      queueState.activeProgress = { chapterId: null, currentPages: 0, totalPages: 0, percent: 0, bytes: 0 };
      this.notifySubscribers();
      if (window.showToast) window.showToast('Semua antrean unduh dibatalkan.');
    },

    /**
     * Core Queue Processor: Sequential chapter download with concurrency limit 3
     */
    async processQueue() {
      if (queueState.isProcessing || queueState.isPaused) return;
      if (queueState.queue.length === 0) {
        queueState.activeItem = null;
        this.notifySubscribers();
        return;
      }

      queueState.isProcessing = true;
      const current = queueState.queue.shift();
      queueState.activeItem = current;

      const { manga, chapter, source } = current;
      const chapterId = chapter.id || chapter.url;
      const chapterNum = chapter.number || chapter.attributes?.chapter || chapter.title || '1';
      const chapterTitle = chapter.title || `Chapter ${chapterNum}`;

      queueState.activeProgress = {
        chapterId,
        chapterNum,
        mangaTitle: manga.title || manga.attributes?.title?.en || 'Manga',
        currentPages: 0,
        totalPages: 0,
        percent: 0,
        bytes: 0
      };
      this.notifySubscribers();

      try {
        // 1. Save Manga metadata to offlineManga store
        const mangaId = manga.id;
        const mangaTitle = manga.title || (typeof manga.attributes?.title === 'object' ? Object.values(manga.attributes.title)[0] : manga.attributes?.title) || 'Untitled';
        const coverUrl = manga.coverUrl || '';
        
        let coverBlob = null;
        try {
          if (coverUrl) coverBlob = await fetchImageAsBlob(coverUrl, null, 15000);
        } catch (e) {
          console.warn('[OfflineManager] Warning downloading cover blob:', e.message);
        }

        await db.manga.put({
          id: mangaId,
          title: mangaTitle,
          coverBlob,
          coverUrl,
          synopsis: manga.synopsis || manga.attributes?.description?.id || manga.attributes?.description?.en || '',
          source,
          savedAt: Date.now()
        });

        // 2. Fetch Chapter Pages URLs
        let pageUrls = [];
        if (source === 'bacakomik') {
          const res = await fetch(`/api/external/chapter-pages?url=${encodeURIComponent(chapter.url || chapterId)}`);
          const data = await res.json();
          pageUrls = data.pages || [];
        } else if (source === 'english') {
          const res = await fetch(`/api/external/en/chapter-pages?url=${encodeURIComponent(chapter.url || chapterId)}`);
          const data = await res.json();
          pageUrls = data.pages || [];
        } else if (source === 'consumet') {
          const res = await fetch(`/api/v2/chapter/consumet/${encodeURIComponent(chapterId)}`);
          const data = await res.json();
          pageUrls = data.pages?.map(p => p.imageUrl || p) || [];
        } else {
          // MangaDex Official (prioritize data-saver for stability, speed, and 70% storage savings)
          const res = await fetch(`/api/chapter/${chapterId}`);
          const data = await res.json();
          const isHighPage = (data.totalPages > 30) || (data.pages && data.pages.length > 30);
          pageUrls = (isHighPage && data.dataSaverPages && data.dataSaverPages.length > 0)
            ? data.dataSaverPages
            : (data.dataSaverPages || data.pages || []);
        }

        if (!pageUrls || pageUrls.length === 0) {
          throw new Error('Halaman chapter kosong atau tidak ditemukan.');
        }

        queueState.activeProgress.totalPages = pageUrls.length;
        this.notifySubscribers();

        // 3. Download image blobs with max concurrency: 3 (Anti Rate-Limit & Serverless Friendly)
        let totalBytes = 0;
        await mapConcurrent(pageUrls, 3, async (imgUrl, idx) => {
          const pageNum = idx + 1;
          const blob = await fetchImageAsBlob(imgUrl, source === 'bacakomik' ? chapter.url : null);
          totalBytes += blob.size;

          // Store image blob into IndexedDB
          await db.pages.put({
            chapterId,
            pageNumber: pageNum,
            blob,
            size: blob.size
          });

          queueState.activeProgress.currentPages++;
          queueState.activeProgress.bytes = totalBytes;
          queueState.activeProgress.percent = Math.round(
            (queueState.activeProgress.currentPages / queueState.activeProgress.totalPages) * 100
          );
          this.notifySubscribers();
        });

        // 4. Mark chapter as downloaded in offlineChapters store
        await db.chapters.put({
          id: chapterId,
          mangaId,
          chapterNumber: chapterNum.toString(),
          title: chapterTitle,
          totalPages: pageUrls.length,
          isDownloaded: true,
          downloadedAt: Date.now(),
          sizeInBytes: totalBytes,
          source
        });

        if (window.showToast) {
          window.showToast(`✅ Chapter ${chapterNum} berhasil disimpan offline!`);
        }

      } catch (err) {
        console.error(`[OfflineManager] Download error for chapter ${chapterId}:`, err);
        if (window.showToast) {
          window.showToast(`❌ Gagal mengunduh Chapter ${chapterNum}: ${err.message}`);
        }
      } finally {
        queueState.isProcessing = false;
        queueState.activeItem = null;
        this.notifySubscribers();

        // Delay 500ms between chapters to avoid API ban / rate-limit
        setTimeout(() => {
          this.processQueue();
        }, 500);
      }
    },

    /**
     * Delete downloaded chapter from IndexedDB
     */
    async deleteChapter(chapterId) {
      await db.pages.where('chapterId').equals(chapterId).delete();
      await db.chapters.delete(chapterId);
      if (window.showToast) window.showToast('Chapter offline berhasil dihapus.');
      this.notifySubscribers();
    },

    /**
     * Delete entire manga and all its downloaded chapters
     */
    async deleteManga(mangaId) {
      const chs = await db.chapters.where('mangaId').equals(mangaId).toArray();
      for (const ch of chs) {
        await db.pages.where('chapterId').equals(ch.id).delete();
      }
      await db.chapters.where('mangaId').equals(mangaId).delete();
      await db.manga.delete(mangaId);
      if (window.showToast) window.showToast('Manga & seluruh chapter offline berhasil dihapus.');
      this.notifySubscribers();
    },

    /**
     * Delete all chapters that the user has already read
     */
    async deleteReadChapters(readHistoryChapterIds = []) {
      if (!readHistoryChapterIds || readHistoryChapterIds.length === 0) {
        if (window.showToast) window.showToast('Tidak ada riwayat chapter yang terbaca.');
        return;
      }

      let deletedCount = 0;
      for (const chId of readHistoryChapterIds) {
        const isDown = await this.isChapterDownloaded(chId);
        if (isDown) {
          await this.deleteChapter(chId);
          deletedCount++;
        }
      }

      if (window.showToast) {
        window.showToast(`Berhasil membersihkan ${deletedCount} chapter yang sudah dibaca.`);
      }
    },

    /**
     * Get storage estimate from browser
     */
    async getStorageEstimate() {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const usageMb = (estimate.usage || 0) / (1024 * 1024);
        const quotaMb = (estimate.quota || 0) / (1024 * 1024);
        const percent = quotaMb > 0 ? ((usageMb / quotaMb) * 100).toFixed(1) : 0;
        return {
          usageMb: usageMb.toFixed(1),
          quotaMb: quotaMb.toFixed(0),
          percent
        };
      }
      return { usageMb: '0', quotaMb: '0', percent: 0 };
    },

    /**
     * Get list of all offline manga with chapter stats and cover fallback
     */
    async getAllOfflineManga() {
      const mangas = await db.manga.toArray();
      const results = [];

      for (const m of mangas) {
        const chs = await db.chapters.where('mangaId').equals(m.id).toArray();
        if (chs.length === 0) {
          // Clean up orphan manga without downloaded chapters
          await db.manga.delete(m.id);
          continue;
        }

        const validCoverBlob = (m.coverBlob && isValidImageBlob(m.coverBlob)) ? m.coverBlob : null;

        // If coverBlob is missing/invalid but coverUrl exists, attempt background re-download
        if (!validCoverBlob && m.coverUrl) {
          fetchImageAsBlob(m.coverUrl).then(newBlob => {
            if (isValidImageBlob(newBlob)) {
              db.manga.update(m.id, { coverBlob: newBlob });
            }
          }).catch(() => {});
        }

        const totalSize = chs.reduce((sum, c) => sum + (c.sizeInBytes || 0), 0);
        results.push({
          ...m,
          coverBlob: validCoverBlob,
          chaptersCount: chs.length,
          totalSizeMb: (totalSize / (1024 * 1024)).toFixed(1),
          chapters: chs
        });
      }

      return results;
    }
  };

  window.OfflineManager = OfflineManager;

})(window);
