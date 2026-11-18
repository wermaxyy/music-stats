(function () {
    'use strict';

    // Защита от двойного запуска (иначе прослушивания считались бы дважды)
    if (window.__pulsesyncStatsLoaded) return;
    window.__pulsesyncStatsLoaded = true;

    const STORAGE_KEY = 'pulsesync_stats';
    const LAST_KEY = 'pulsesync_stats_last';
    const MIN_LISTEN_MS = 30000;          // сколько надо послушать, чтобы трек засчитался
    const TICK_MS = 1000;                 // как часто проверяем плеер
    const RELOAD_GUARD_MS = 5 * 60 * 1000; // защита от повторной записи после перезапуска плеера

    let current = null;                   // трек, который сейчас играет
    let lastTickAt = Date.now();
    let firstTrackOfSession = true;
    let statsOpenPath = null;

    // ===== УТИЛИТЫ =====
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    // ===== РАБОТА С ХРАНИЛИЩЕМ =====
    function getStats() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            const parsed = data ? JSON.parse(data) : null;
            if (parsed && Array.isArray(parsed.tracks)) return parsed;
        } catch (e) { /* игнорируем, вернём пустую статистику */ }
        return { tracks: [] };
    }

    function saveStats(stats) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
        } catch (e) {
            console.warn('[music-stats] не удалось сохранить статистику:', e);
        }
    }

    function wasCountedRecently(key) {
        try {
            const raw = localStorage.getItem(LAST_KEY);
            if (!raw) return false;
            const last = JSON.parse(raw);
            return last.key === key && Date.now() - last.ts < RELOAD_GUARD_MS;
        } catch (e) {
            return false;
        }
    }

    function rememberCounted(key) {
        try {
            localStorage.setItem(LAST_KEY, JSON.stringify({ key: key, ts: Date.now() }));
        } catch (e) { /* не критично */ }
    }

    // ===== ПАРСИНГ ТРЕКА =====
    function getPlayerBar() {
        return document.querySelector('[data-test-id="PLAYERBAR_DESKTOP"]')
            || document.querySelector('[class*="PlayerBar_root"]');
    }

    function getCurrentTrack() {
        const meta = navigator.mediaSession && navigator.mediaSession.metadata;
        if (meta && meta.title) {
            return {
                title: meta.title,
                artist: meta.artist || 'Неизвестный исполнитель'
            };
        }

        try {
            const context = getPlayerBar() || document;

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
                    const names = Array.from(elements).map((e) => e.textContent.trim()).filter((t) => t.length > 0);
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

    function readTrackId() {
        const link = (getPlayerBar() || document).querySelector('a[href*="/track/"]');
        if (link) {
            const match = (link.getAttribute('href') || '').match(/track\/(\d+)/);
            if (match) return match[1];
        }
        return null;
    }

    // Определяем, играет ли музыка сейчас
    function isPlaying() {
        const media = document.querySelectorAll('audio, video');
        for (const m of media) {
            if (!m.paused && !m.ended) return true;
        }
        const state = navigator.mediaSession && navigator.mediaSession.playbackState;
        if (state === 'playing') return true;
        if (state === 'paused') return false;
        if (media.length > 0) return false;
        // Не смогли определить состояние — считаем, что играет (как в старой версии)
        return true;
    }

    // ===== ПОДСЧЁТ ПРОСЛУШИВАНИЙ =====
    function recordTrack(t) {
        const stats = getStats();
        stats.tracks.push({
            trackId: readTrackId() || t.key,
            title: t.title,
            artist: t.artist,
            timestamp: new Date().toISOString()
        });
        saveStats(stats);
        t.counted = true;
        rememberCounted(t.key);

        if (isStatsVisible()) updateStatsPage();
    }

    function tick() {
        const now = Date.now();
        const delta = Math.min(now - lastTickAt, 5000);
        lastTickAt = now;

        // Если открыта статистика, а пользователь ушёл на другую страницу — закрываем её
        if (isStatsVisible() && statsOpenPath !== null && window.location.pathname !== statsOpenPath) {
            window.hideStats();
        }

        const info = getCurrentTrack();
        if (!info || !info.title) return;

        const key = `${info.title} - ${info.artist}`;
        if (!current || current.key !== key) {
            current = { key: key, title: info.title, artist: info.artist, playedMs: 0, counted: false };

            // После перезапуска плеера не записываем тот же трек второй раз
            if (firstTrackOfSession) {
                firstTrackOfSession = false;
                if (wasCountedRecently(key)) current.counted = true;
            }
        }

        if (current.counted) return;

        if (isPlaying()) current.playedMs += delta;
        if (current.playedMs >= MIN_LISTEN_MS) recordTrack(current);
    }

    // ===== UI ХЕЛПЕРЫ =====
    function getStatsSummary() {
        const stats = getStats();
        const total = stats.tracks.length;

        const artists = {};
        const tracks = {};
        stats.tracks.forEach((t) => {
            const name = t.artist || 'Неизвестный исполнитель';
            artists[name] = (artists[name] || 0) + 1;

            const key = `${t.title} - ${name}`;
            tracks[key] = (tracks[key] || 0) + 1;
        });

        const sortedArtists = Object.entries(artists).sort((a, b) => b[1] - a[1]).slice(0, 15);
        const sortedTracks = Object.entries(tracks).sort((a, b) => b[1] - a[1]).slice(0, 15);

        return { total, sortedArtists, sortedTracks, isEmpty: total === 0 };
    }

    function isStatsVisible() {
        const page = document.getElementById('stats-page-overlay');
        return !!page && page.style.display === 'flex';
    }

    // ===== ИНТЕГРАЦИЯ В ИНТЕРФЕЙС =====
    function ensureUI() {
        // 1. Кнопка в сайдбаре
        const collectionLink = document.querySelector('a[data-test-id="NAVBAR_NAVIGATION_ITEM_COLLECTION"]');

        if (collectionLink && !document.getElementById('stats-sidebar-btn')) {
            const li = collectionLink.closest('li');
            const ol = li && li.parentElement;

            if (li && ol) {
                const newLi = li.cloneNode(true);
                newLi.id = 'stats-sidebar-btn';
                newLi.setAttribute('aria-current', 'false');

                const aTag = newLi.querySelector('a');
                if (aTag) {
                    aTag.removeAttribute('href');
                    aTag.setAttribute('data-test-id', 'NAVBAR_NAVIGATION_ITEM_STATS');
                    aTag.style.cursor = 'pointer';
                    aTag.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.showStats();
                    };
                }

                const textSpan = newLi.querySelector('span[title="Коллекция"]');
                if (textSpan) {
                    textSpan.textContent = 'Статистика';
                    textSpan.title = 'Статистика';
                }

                const svgEl = newLi.querySelector('svg');
                if (svgEl) {
                    svgEl.setAttribute('viewBox', '0 0 24 24');
                    svgEl.setAttribute('fill', 'none');
                    svgEl.setAttribute('stroke', 'currentColor');
                    svgEl.setAttribute('stroke-width', '2');
                    svgEl.innerHTML = '<path d="M18 20V10M12 20V4M6 20v-6"/>';
                }

                ol.appendChild(newLi);
            }
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
            style.textContent = `
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

        const data = getStatsSummary();

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
                            <span style="font-size: 15px; color: inherit;">${escapeHtml(artist)}</span>
                            <span style="font-size: 15px; font-weight: 600; color: #ff6600;">${count}</span>
                        </div>
                    `).join('')}
                </div>

                <div>
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ym-controls-color-primary-text-enabled, #888); margin-bottom: 20px; font-weight: 600;">Топ треков</div>
                    ${data.sortedTracks.map(([track, count]) => `
                        <div class="stats-row">
                            <span style="font-size: 15px; color: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%;">${escapeHtml(track)}</span>
                            <span style="font-size: 15px; font-weight: 600; color: #ff6600;">${count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div style="margin-top: 60px; display: flex; gap: 16px; border-top: 1px solid var(--ym-outline-color-primary-disabled, #333); padding-top: 32px;">
                <button id="stats-export-btn" class="stats-action-btn">Экспорт в JSON</button>
                <button id="stats-clear-btn" class="stats-action-btn stats-danger-btn">Очистить данные</button>
            </div>
        `;

        content.querySelector('#stats-export-btn').addEventListener('click', () => window.exportStats());
        content.querySelector('#stats-clear-btn').addEventListener('click', () => {
            if (confirm('Удалить всю статистику?')) window.clearStats();
        });
    }

    // ===== УПРАВЛЕНИЕ ВИДИМОСТЬЮ =====
    window.showStats = function () {
        const collectionLink = document.querySelector('a[data-test-id="NAVBAR_NAVIGATION_ITEM_COLLECTION"]');

        // Делаем программный клик по коллекции
        if (collectionLink && window.location.pathname !== '/collection') {
            collectionLink.click();
        }

        // Ждём перерисовки React
        setTimeout(() => {
            ensureUI();

            const page = document.getElementById('stats-page-overlay');
            const btn = document.getElementById('stats-sidebar-btn');

            if (page) {
                page.style.display = 'flex';
                statsOpenPath = window.location.pathname;
                updateStatsPage();
            }

            // Прячем оригинальный контент Яндекса под статистикой
            const mainContent = document.querySelector('main');
            if (mainContent) {
                mainContent.style.display = 'none';
            }

            // Сбрасываем подсветку со всех пунктов меню
            document.querySelectorAll('nav [aria-current="page"]').forEach((el) => {
                el.setAttribute('aria-current', 'false');
            });

            // Подсвечиваем только Статистику
            if (btn) btn.setAttribute('aria-current', 'page');
        }, 500);
    };

    window.hideStats = function () {
        const page = document.getElementById('stats-page-overlay');
        const btn = document.getElementById('stats-sidebar-btn');

        if (page) page.style.display = 'none';
        if (btn) btn.setAttribute('aria-current', 'false');
        statsOpenPath = null;

        // Возвращаем контент
        const mainContent = document.querySelector('main');
        if (mainContent) {
            mainContent.style.display = '';
        }

        // Возвращаем подсветку Коллекции, если мы всё ещё на ней
        if (window.location.pathname === '/collection') {
            const collectionLink = document.querySelector('a[data-test-id="NAVBAR_NAVIGATION_ITEM_COLLECTION"]');
            if (collectionLink) {
                const li = collectionLink.closest('li');
                if (li) li.setAttribute('aria-current', 'page');
            }
        }
    };

    window.clearStats = function () {
        try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(LAST_KEY);
        } catch (e) { /* не критично */ }
        updateStatsPage();
    };

    window.exportStats = function () {
        const stats = getStats();
        const blob = new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stats_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // ===== ИНИЦИАЛИЗАЦИЯ И НАБЛЮДЕНИЕ =====
    function init() {
        // Интерфейс проверяем не на каждое изменение страницы, а не чаще раза в 300 мс
        let uiTimer = null;
        const scheduleUI = () => {
            if (uiTimer) return;
            uiTimer = setTimeout(() => {
                uiTimer = null;
                ensureUI();
            }, 300);
        };

        new MutationObserver(scheduleUI).observe(document.body, { childList: true, subtree: true });

        // Трек отслеживаем отдельным таймером, а не через изменения страницы
        setInterval(tick, TICK_MS);

        document.addEventListener('click', (e) => {
            if (!e.isTrusted || !isStatsVisible()) return;

            const target = e.target;
            if (!(target instanceof Element)) return;
            if (target.closest('#stats-sidebar-btn') || target.closest('#stats-page-overlay')) return;

            // Любой переход по ссылке (сайдбар, трек, исполнитель) закрывает статистику
            if (target.closest('nav a, [class*="SidebarMenu"] a, a[href]')) {
                window.hideStats();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isStatsVisible()) window.hideStats();
        });

        window.addEventListener('popstate', () => {
            if (isStatsVisible()) window.hideStats();
        });

        ensureUI();
        tick();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
