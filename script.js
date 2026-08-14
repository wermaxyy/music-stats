(function() {
    'use strict';

    const STORAGE_KEY = 'pulsesync_stats';
    let lastTrackKey = null;

    // ===== РАБОТА С ХРАНИЛИЩЕМ =====
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

    // ===== ПАРСИНГ ТРЕКА =====
    function getCurrentTrack() {
        if (navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title) {
            return {
                title: navigator.mediaSession.metadata.title,
                artist: navigator.mediaSession.metadata.artist || 'Неизвестный исполнитель'
            };
        }

        try {
            const playerBar = document.querySelector('[data-test-id="PLAYERBAR_DESKTOP"]') || document.querySelector('[class*="PlayerBar_root"]');
            const context = playerBar || document; 

            const titleSelectors = ['.Meta_title__GGBnH', '[data-test-id="TRACK_TITLE"]', '[class*="TrackTitle"]', '.track__title'];
            let title = null;
            for (const sel of titleSelectors) {
                const el = context.querySelector(sel);
                if (el && el.textContent.trim()) {
                    title = el.textContent.trim().replace(/\s+/g, ' ');
                    break;
                }
            }

            const artistSelectors = ['.Meta_artistCaption__JESZi', '[data-test-id="SEPARATED_ARTIST_TITLE"]', '[class*="ArtistName"]', '.track__artists'];
            let artist = null;
            for (const sel of artistSelectors) {
                const elements = context.querySelectorAll(sel);
                if (elements.length > 0) {
                    const names = Array.from(elements).map(e => e.textContent.trim()).filter(t => t.length > 0);
                    if (names.length > 0) {
                        artist = names.join(', ');
                        break;
                    }
                }
            }

            if (!title) return null;
            return { title: title, artist: artist || 'Неизвестный исполнитель' };
        } catch (e) {
            return null;
        }
    }

    // ===== СОХРАНЕНИЕ =====
    function processCurrentTrack() {
        const trackInfo = getCurrentTrack();
        if (!trackInfo || !trackInfo.title) return;

        const currentKey = `${trackInfo.title} - ${trackInfo.artist}`;
        if (currentKey === lastTrackKey) return;

        let trackId = Date.now().toString();
        const playerBar = document.querySelector('[data-test-id="PLAYERBAR_DESKTOP"]') || document.querySelector('[class*="PlayerBar_root"]');
        const trackLink = (playerBar || document).querySelector('a[href*="/track/"]');
        if (trackLink) {
            const match = trackLink.getAttribute('href').match(/track\/(\d+)/);
            if (match) trackId = match[1];
        }

        const stats = getStats();
        stats.tracks.push({
            trackId: trackId,
            title: trackInfo.title,
            artist: trackInfo.artist,
            album: 'Неизвестный альбом',
            timestamp: new Date().toISOString(),
            duration: 0
        });

        saveStats(stats);
        lastTrackKey = currentKey;
        
        if (document.getElementById('stats-page-overlay')?.style.display === 'flex') {
            updateStatsPage();
        }
    }

    // ===== UI ХЕЛПЕРЫ =====
    function getStatsHTML() {
        const stats = getStats();
        const total = stats.tracks.length;
        const artists = {};
        stats.tracks.forEach(t => {
            const name = t.artist || 'Неизвестный исполнитель';
            artists[name] = (artists[name] || 0) + 1;
        });
        const sortedArtists = Object.entries(artists).sort((a, b) => b[1] - a[1]).slice(0, 15);
        const tracks = {};
        stats.tracks.forEach(t => {
            const key = `${t.title} - ${t.artist}`;
            tracks[key] = (tracks[key] || 0) + 1;
        });
        const sortedTracks = Object.entries(tracks).sort((a, b) => b[1] - a[1]).slice(0, 15);
        
        return { total, sortedArtists, sortedTracks, isEmpty: total === 0 };
    }

    // ===== ИНТЕГРАЦИЯ В ИНТЕРФЕЙС =====
    function ensureUI() {
        // 1. Неубиваемая кнопка в сайдбаре
        const collectionLink = document.querySelector('a[data-test-id="NAVBAR_NAVIGATION_ITEM_COLLECTION"]');
        
        if (collectionLink && !document.getElementById('stats-sidebar-btn')) {
            const li = collectionLink.closest('li');
            const ol = li.parentElement;
            
            const newLi = li.cloneNode(true);
            newLi.id = 'stats-sidebar-btn';
            newLi.setAttribute('aria-current', 'false'); 
            
            const aTag = newLi.querySelector('a');
            aTag.removeAttribute('href');
            aTag.setAttribute('data-test-id', 'NAVBAR_NAVIGATION_ITEM_STATS');
            aTag.style.cursor = 'pointer';
            
            aTag.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.showStats();
            };

            const textSpan = newLi.querySelector('span[title="Коллекция"]');
            if (textSpan) {
                textSpan.textContent = 'Статистика';
                textSpan.title = 'Статистика';
            }

            const svgEl = newLi.querySelector('svg');
            if (svgEl && svgEl.parentElement) {
                svgEl.parentElement.innerHTML = `
                    <svg class="${svgEl.getAttribute('class')}" focusable="false" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                `;
            }

            ol.appendChild(newLi);
        }

        // 2. Страница статистики
        const contentContainer = document.querySelector('.CommonLayout_content__zy_Ja') || document.querySelector('main')?.parentElement;
        
        if (contentContainer && !document.getElementById('stats-page-overlay')) {
            const page = document.createElement('div');
            page.id = 'stats-page-overlay';
            
            page.style.cssText = `
                position: absolute;
                inset: 0;
                z-index: 99999;
                background-color: var(--ym-background-color-primary-enabled-content, #121212);
                border-radius: var(--ym-layout-border-radius, 16px);
                border: var(--ym-layout-border, none);
                display: none; 
                flex-direction: column;
                padding: 60px 80px; 
                overflow-y: auto;
                color: var(--ym-controls-color-primary-text-enabled_variant, #fff);
                font-family: var(--ym-font-text, 'YS Text', sans-serif);
                box-shadow: 0 4px 24px rgba(0,0,0,0.4);
            `;
            
            const style = document.createElement('style');
            style.innerHTML = `
                /* Скрываем скроллбар, но оставляем прокрутку */
                #stats-page-overlay::-webkit-scrollbar { display: none; }
                #stats-page-overlay { -ms-overflow-style: none; scrollbar-width: none; }

                .stats-action-btn { background: transparent; border: 1px solid var(--ym-outline-color-primary-disabled, #333); color: inherit; padding: 10px 24px; border-radius: 6px; font-size: 13px; cursor: pointer; transition: all 0.2s; font-family: inherit; font-weight: 500; }
                .stats-action-btn:hover { background: var(--ym-surface-color-primary-enabled-list, #1f1f1f); }
                .stats-danger-btn { color: #ff4444; }
                .stats-danger-btn:hover { background: rgba(255, 68, 68, 0.05); border-color: #ff4444; }
                .stats-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--ym-outline-color-primary-disabled, #1a1a1a); transition: background 0.2s; }
                .stats-row:hover { background: var(--ym-surface-color-primary-enabled-list, rgba(255,255,255,0.02)); }
            `;
            page.appendChild(style);

            const content = document.createElement('div');
            content.id = 'stats-page-content';
            content.style.cssText = 'max-width: 900px; width: 100%; margin: 0 auto;';
            page.appendChild(content);
            
            contentContainer.appendChild(page);
        }
    }

    function updateStatsPage() {
        const content = document.getElementById('stats-page-content');
        if (!content) return;

        const data = getStatsHTML();

        if (data.isEmpty) {
            content.innerHTML = `<div style="text-align:center;color:var(--ym-controls-color-primary-text-enabled, #888);padding:100px 0;font-size:18px;">Нет данных для отображения</div>`;
            return;
        }

        content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 48px; border-bottom: 1px solid var(--ym-outline-color-primary-disabled, #333); padding-bottom: 24px;">
                <div>
                    <h1 style="font-size: 56px; font-weight: 700; margin: 0; line-height: 1; letter-spacing: -1px; font-family: var(--ym-font-heading, inherit);">Статистика</h1>
                    <div style="font-size: 16px; color: var(--ym-controls-color-primary-text-enabled, #888); margin-top: 12px;">Прослушано треков: <span style="color: inherit; font-weight: 600;">${data.total}</span></div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 60px;">
                <div>
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ym-controls-color-primary-text-enabled, #888); margin-bottom: 20px; font-weight: 600;">Топ исполнителей</div>
                    ${data.sortedArtists.map(([artist, count]) => `
                        <div class="stats-row">
                            <span style="font-size: 15px; color: inherit;">${artist}</span>
                            <span style="font-size: 15px; font-weight: 600; color: #ff6600;">${count}</span>
                        </div>
                    `).join('')}
                </div>
                
                <div>
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ym-controls-color-primary-text-enabled, #888); margin-bottom: 20px; font-weight: 600;">Топ треков</div>
                    ${data.sortedTracks.map(([track, count]) => `
                        <div class="stats-row">
                            <span style="font-size: 15px; color: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%;">${track}</span>
                            <span style="font-size: 15px; font-weight: 600; color: #ff6600;">${count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div style="margin-top: 60px; display: flex; gap: 16px; border-top: 1px solid var(--ym-outline-color-primary-disabled, #333); padding-top: 32px;">
                <button class="stats-action-btn" onclick="window.exportStats()">Экспорт в JSON</button>
                <button class="stats-action-btn stats-danger-btn" onclick="if(confirm('Удалить всю статистику?')) { window.clearStats(); }">Очистить данные</button>
            </div>
        `;
    }

    // ===== УПРАВЛЕНИЕ ВИДИМОСТЬЮ =====
    window.showStats = function() {
        const collectionLink = document.querySelector('a[data-test-id="NAVBAR_NAVIGATION_ITEM_COLLECTION"]');
        
        // Делаем программный клик по коллекции
        if (collectionLink && window.location.pathname !== '/collection') {
            collectionLink.click();
        }

        // Ждем перерисовки React
        setTimeout(() => {
            ensureUI(); 
            
            const page = document.getElementById('stats-page-overlay');
            const btn = document.getElementById('stats-sidebar-btn');
            
            if (page) {
                page.style.display = 'flex';
                updateStatsPage();
            }

            // Прячем оригинальный контент Яндекса под статистикой
            const mainContent = document.querySelector('main');
            if (mainContent) {
                mainContent.style.display = 'none';
            }

            // Сбрасываем подсветку со всех пунктов меню
            document.querySelectorAll('nav [aria-current="page"]').forEach(el => {
                el.setAttribute('aria-current', 'false');
            });
            
            // Подсвечиваем только Статистику
            if (btn) btn.setAttribute('aria-current', 'page');
        }, 500);
    };

    window.hideStats = function() {
        const page = document.getElementById('stats-page-overlay');
        const btn = document.getElementById('stats-sidebar-btn');
        
        if (page) page.style.display = 'none';
        if (btn) btn.setAttribute('aria-current', 'false');

        // Возвращаем контент
        const mainContent = document.querySelector('main');
        if (mainContent) {
            mainContent.style.display = '';
        }

        // Возвращаем подсветку Коллекции, если мы все еще находимся на ней
        if (window.location.pathname === '/collection') {
            const collectionLink = document.querySelector('a[data-test-id="NAVBAR_NAVIGATION_ITEM_COLLECTION"]');
            if (collectionLink) {
                const li = collectionLink.closest('li');
                if (li) li.setAttribute('aria-current', 'page');
            }
        }
    };

    window.clearStats = function() {
        localStorage.removeItem(STORAGE_KEY);
        lastTrackKey = null;
        updateStatsPage();
    };

    window.exportStats = function() {
        const stats = getStats();
        const blob = new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stats_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // ===== ИНИЦИАЛИЗАЦИЯ И НАБЛЮДЕНИЕ =====
    function init() {
        let domUpdateTimeout;

        const observer = new MutationObserver(() => {
            ensureUI();
            
            clearTimeout(domUpdateTimeout);
            domUpdateTimeout = setTimeout(() => {
                processCurrentTrack();
            }, 800);
        });

        observer.observe(document.body, { childList: true, subtree: true, characterData: true });

        document.addEventListener('click', (e) => {
            if (!e.isTrusted) return; 

            const isSidebarLink = e.target.closest('nav a, [class*="SidebarMenu"] a');
            const isOurButton = e.target.closest('#stats-sidebar-btn');
            
            if (isSidebarLink && !isOurButton) {
                window.hideStats();
            }
        });

        ensureUI();
        processCurrentTrack();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();