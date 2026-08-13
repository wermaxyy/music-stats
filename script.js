(function() {
    'use strict';

    const STORAGE_KEY = 'pulsesync_stats';
    const processedTracks = new Set();
    let lastTrackId = null;
    let statsWindowRef = null;

    function getStats() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : { tracks: [] };
        } catch (e) {
            return { tracks: [] };
        }
    }

    function saveStats(stats) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    }

    function getCurrentTrackFromDOM() {
        try {
            const artistEl = document.querySelector('[data-test-id="SEPARATED_ARTIST_TITLE"]');
            let artist = 'Неизвестный исполнитель';
            if (artistEl) {
                const allArtists = document.querySelectorAll('[data-test-id="SEPARATED_ARTIST_TITLE"]');
                const artistNames = [];
                allArtists.forEach(el => {
                    artistNames.push(el.textContent.trim());
                });
                artist = artistNames.join(', ');
            }

            const titleSelectors = [
                '.VibePlayerbarMeta_trackNameText__9IgY2',
                '[data-test-id="TRACK_TITLE"]',
                '.track__title',
                '.d-track__title',
                '[class*="track-title"]',
                '[class*="TrackTitle"]',
                '.player-controls [class*="title"]',
                '.track__name',
                '[aria-hidden="true"]'
            ];
            
            let title = 'Неизвестный трек';
            for (const sel of titleSelectors) {
                const titleEl = document.querySelector(sel);
                if (titleEl) {
                    const text = titleEl.textContent.trim().replace(/\s+/g, ' ');
                    if (text.length > 2 && !/^\d+$/.test(text)) {
                        title = text;
                        break;
                    }
                }
            }

            return {
                title: title,
                artist: artist,
                partial: artist === 'Неизвестный исполнитель'
            };
        } catch (e) {
            return null;
        }
    }

    function saveTrackWithRetry(trackId, title, attempt = 0) {
        const maxAttempts = 10;
        const delay = 300;

        setTimeout(() => {
            const trackInfo = getCurrentTrackFromDOM();
            
            if (trackInfo && (trackInfo.artist !== 'Неизвестный исполнитель' || attempt >= maxAttempts)) {
                const stats = getStats();
                const exists = stats.tracks.some(t => t.trackId === trackId);
                if (exists) return;

                const trackData = {
                    trackId: trackId,
                    title: trackInfo.title || title || 'Неизвестный трек',
                    artist: trackInfo.artist || 'Неизвестный исполнитель',
                    album: 'Неизвестный альбом',
                    timestamp: new Date().toISOString(),
                    duration: 0
                };

                stats.tracks.push(trackData);
                saveStats(stats);
                processedTracks.add(trackId);
                lastTrackId = trackId;
                
                console.log(`✅ Трек сохранён: ${trackData.title} - ${trackData.artist}`);
            } else if (attempt < maxAttempts) {
                saveTrackWithRetry(trackId, title, attempt + 1);
            } else {
                const stats = getStats();
                const exists = stats.tracks.some(t => t.trackId === trackId);
                if (!exists) {
                    const trackData = {
                        trackId: trackId,
                        title: title || 'Неизвестный трек',
                        artist: 'Неизвестный исполнитель',
                        album: 'Неизвестный альбом',
                        timestamp: new Date().toISOString(),
                        duration: 0
                    };
                    stats.tracks.push(trackData);
                    saveStats(stats);
                    processedTracks.add(trackId);
                    lastTrackId = trackId;
                }
            }
        }, delay);
    }

    function addTrackToStats(trackId, title) {
        if (processedTracks.has(trackId) || trackId === lastTrackId) {
            return;
        }
        const stats = getStats();
        const exists = stats.tracks.some(t => t.trackId === trackId);
        if (exists) {
            processedTracks.add(trackId);
            return;
        }
        saveTrackWithRetry(trackId, title, 0);
    }

    function getStatsHTML() {
        const stats = getStats();
        const total = stats.tracks.length;

        const artists = {};
        stats.tracks.forEach(t => {
            const name = t.artist || 'Неизвестный исполнитель';
            artists[name] = (artists[name] || 0) + 1;
        });
        const sortedArtists = Object.entries(artists).sort((a, b) => b[1] - a[1]).slice(0, 10);

        const tracks = {};
        stats.tracks.forEach(t => {
            const key = `${t.title} - ${t.artist}`;
            tracks[key] = (tracks[key] || 0) + 1;
        });
        const sortedTracks = Object.entries(tracks).sort((a, b) => b[1] - a[1]).slice(0, 10);

        const days = {};
        stats.tracks.forEach(t => {
            const day = t.timestamp.split('T')[0];
            days[day] = (days[day] || 0) + 1;
        });
        const sortedDays = Object.entries(days).sort().slice(-7);

        return {
            total,
            sortedArtists,
            sortedTracks,
            sortedDays,
            isEmpty: total === 0
        };
    }

       // ==================== ОКНО В СТИЛЕ МИНИ-ПЛЕЕРА ====================

let miniStatsWindow = null;
let isPinned = false;

function createMiniStatsWindow() {
    // Удаляем старое окно
    const old = document.getElementById('mini-stats-window');
    if (old) old.remove();

    const data = getStatsHTML();

    const win = document.createElement('div');
    win.id = 'mini-stats-window';
    win.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 380px;
        max-height: 520px;
        background: #1a1a1a;
        border-radius: 16px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.9);
        z-index: 999999;
        color: #e0e0e0;
        font-family: 'YS Text', -apple-system, sans-serif;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        user-select: none;
        -webkit-user-select: none;
        border: 1px solid #2a2a2a;
    `;

    // ===== ШАПКА (как в мини-плеере) =====
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: flex-end;
        align-items: center;
        padding: 8px 12px;
        background: #121212;
        border-bottom: 1px solid #2a2a2a;
        flex-shrink: 0;
        gap: 6px;
        cursor: grab;
    `;
    header.innerHTML = `
        <button id="mini-stats-pin" style="background:none;border:none;color:#666;cursor:pointer;padding:4px 6px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:all 0.2s;font-size:12px;" title="Закрепить">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2v6l3 3-3 3-3-3 3-3V2z"/>
                <path d="M12 16v6"/>
                <path d="M7 19h10"/>
            </svg>
        </button>
        <button id="mini-stats-close" style="background:none;border:none;color:#666;cursor:pointer;padding:4px 6px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:all 0.2s;font-size:12px;" title="Закрыть">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;
    win.appendChild(header);

    // ===== КОНТЕНТ =====
    const content = document.createElement('div');
    content.style.cssText = `
        padding: 16px 20px 20px;
        overflow-y: auto;
        flex: 1;
        background: #1a1a1a;
    `;
    content.innerHTML = getMiniStatsContent(data);
    win.appendChild(content);

    document.body.appendChild(win);
    miniStatsWindow = win;

    // ===== ПЕРЕТАСКИВАНИЕ =====
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        const rect = win.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        header.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        win.style.left = (startLeft + dx) + 'px';
        win.style.top = (startTop + dy) + 'px';
        win.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            header.style.cursor = 'grab';
        }
    });

    // ===== КНОПКА ЗАКРЕПЛЕНИЯ =====
    document.getElementById('mini-stats-pin').addEventListener('click', () => {
        isPinned = !isPinned;
        const pinBtn = document.getElementById('mini-stats-pin');
        if (isPinned) {
            pinBtn.style.color = '#f5a623';
            pinBtn.style.background = 'rgba(245,166,35,0.15)';
            win.style.borderColor = '#f5a623';
        } else {
            pinBtn.style.color = '#666';
            pinBtn.style.background = 'transparent';
            win.style.borderColor = '#2a2a2a';
        }
    });

    // ===== КНОПКА ЗАКРЫТИЯ =====
    document.getElementById('mini-stats-close').addEventListener('click', () => {
        win.style.display = 'none';
    });

    // ===== КНОПКИ В КОНТЕНТЕ =====
    content.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.action === 'clear') {
            if (confirm('Удалить всю статистику?')) {
                window.clearStats();
                updateMiniStatsWindow();
            }
        } else if (btn.dataset.action === 'export') {
            window.exportStats();
        } else if (btn.dataset.action === 'refresh') {
            updateMiniStatsWindow();
        }
    });

    return win;
}

function getMiniStatsContent(data) {
    if (data.isEmpty) {
        return `
            <div style="text-align:center;color:#555;padding:24px 0;font-size:14px;">
                🎵 Послушай пару треков
            </div>
        `;
    }

    return `
        <div style="text-align:center;padding:6px 0 10px;font-size:12px;color:#888;border-bottom:1px solid #2a2a2a;margin-bottom:12px;">
            Всего треков
            <span style="display:block;font-size:32px;font-weight:700;color:#fff;margin-top:2px;">${data.total}</span>
        </div>

        <div style="margin-bottom:10px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#555;margin-bottom:4px;">🏆 Топ исполнителей</div>
            ${data.sortedArtists.slice(0, 8).map(([artist, count]) => `
                <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1e1e1e;font-size:12px;">
                    <span style="color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%;">${artist}</span>
                    <span style="color:#666;font-weight:500;">${count}</span>
                </div>
            `).join('')}
        </div>

        <div style="margin-bottom:10px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#555;margin-bottom:4px;">🎵 Топ треков</div>
            ${data.sortedTracks.slice(0, 8).map(([track, count]) => `
                <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1e1e1e;font-size:12px;">
                    <span style="color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%;">${track}</span>
                    <span style="color:#666;font-weight:500;">${count}</span>
                </div>
            `).join('')}
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #2a2a2a;">
            <button data-action="clear" style="background:#222;border:none;color:#888;padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer;">🗑️</button>
            <button data-action="export" style="background:#222;border:none;color:#888;padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer;">📤</button>
            <button data-action="refresh" style="background:#222;border:none;color:#888;padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer;">🔄</button>
            <span style="flex:1;text-align:right;font-size:9px;color:#333;padding:4px 0;">wermaxyy</span>
        </div>
    `;
}

function updateMiniStatsWindow() {
    const win = document.getElementById('mini-stats-window');
    if (!win) return;
    const content = win.querySelector('div:last-child');
    if (!content) return;
    const data = getStatsHTML();
    content.innerHTML = getMiniStatsContent(data);
}

// Переопределяем showStats
window.showStats = function() {
    const existing = document.getElementById('mini-stats-window');
    if (existing) {
        if (existing.style.display === 'none') {
            existing.style.display = 'flex';
            updateMiniStatsWindow();
        } else {
            existing.style.display = 'none';
        }
        return;
    }
    createMiniStatsWindow();
};

    // ==================== ОЧИСТКА И ЭКСПОРТ ====================

    window.clearStats = function() {
        localStorage.removeItem(STORAGE_KEY);
        processedTracks.clear();
        lastTrackId = null;
        console.log('🗑️ Статистика очищена');
    };

    window.exportStats = function() {
        const stats = getStats();
        const json = JSON.stringify(stats, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stats_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        console.log('📤 Статистика экспортирована');
    };

    // ==================== КНОПКА В ШАПКЕ ====================

    function addStatsButtonToTitleBar() {
        const titleBar = document.querySelector('.TitleBar_root__QjdOZ');
        if (!titleBar) {
            return;
        }

        if (document.getElementById('stats-titlebar-btn')) {
            return;
        }

        const minimizeBtn = titleBar.querySelector('[aria-label="Свернуть"]');
        if (!minimizeBtn) {
            return;
        }

        const btn = document.createElement('button');
        btn.id = 'stats-titlebar-btn';
        btn.type = 'button';
        btn.className = 'TitleBar_button__9MptL';
        btn.setAttribute('aria-label', 'Статистика');
        btn.title = 'Статистика прослушиваний';
        btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="TitleBar_icon__8Wji9">
                <path d="M21 12v-2a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v2"/>
                <circle cx="12" cy="16" r="5"/>
                <path d="M12 11v5"/>
                <path d="M9 16h6"/>
            </svg>
        `;

        btn.addEventListener('click', () => {
            window.showStats();
        });

        titleBar.insertBefore(btn, minimizeBtn);
        console.log('📊 Кнопка статистики добавлена в шапку!');
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================

    function initStatsCollector() {
        console.log('📊 Плагин статистики запущен!');

        const originalLog = console.log;
        console.log = function(...args) {
            originalLog.apply(console, args);
            const logString = args.join(' ');

            const trackMatch = logString.match(/["']([^"']+)["']\s*\(id:\s*(\d+)\)/);
            if (trackMatch && (logString.includes('текущий') || logString.includes('стартует'))) {
                const title = trackMatch[1];
                const trackId = trackMatch[2];
                addTrackToStats(trackId, title);
            }
        };

        setInterval(() => {
            try {
                const trackInfo = getCurrentTrackFromDOM();
                if (trackInfo && trackInfo.title !== 'Неизвестный трек') {
                    const trackIdMatch = window.location.href.match(/track\/(\d+)/);
                    if (trackIdMatch) {
                        const trackId = trackIdMatch[1];
                        if (!processedTracks.has(trackId)) {
                            addTrackToStats(trackId, trackInfo.title);
                        }
                    }
                }
            } catch(e) {}
        }, 5000);

        console.log('📊 Плагин статистики загружен!');
        console.log('📌 Команды: showStats() - открыть окно, clearStats() - очистить, exportStats() - экспорт');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initStatsCollector);
    } else {
        initStatsCollector();
    }

    setTimeout(addStatsButtonToTitleBar, 2000);
    setTimeout(addStatsButtonToTitleBar, 5000);

})();