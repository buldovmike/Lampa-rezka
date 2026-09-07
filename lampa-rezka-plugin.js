(function() {
    'use strict';

    // Lampa plugin metadata. The Extensions manager uses this to identify the plugin.
    const manifest = {
        type: 'video',
        version: '1.2.0-ui-fix',
        name: 'HDREZKA Lab',
        description: 'Лабораторный интерфейс авторизации и настройки для Lampa/Luxo',
        component: 'rezka'
    };

    function registerManifest() {
        try {
            if (typeof Lampa === 'undefined') return;
            if (!Lampa.Manifest) Lampa.Manifest = {};
            // Current Lampa builds accept a single manifest object here; older/custom
            // builds may expose an array or object, so preserve an existing collection.
            if (Array.isArray(Lampa.Manifest.plugins)) {
                if (!Lampa.Manifest.plugins.some(p => p && p.component === manifest.component)) {
                    Lampa.Manifest.plugins.push(manifest);
                }
            } else if (Lampa.Manifest.plugins && typeof Lampa.Manifest.plugins === 'object'
                       && !Lampa.Manifest.plugins.type) {
                Lampa.Manifest.plugins[manifest.component] = manifest;
            } else {
                Lampa.Manifest.plugins = manifest;
            }
        } catch (e) {
            console.warn('[Rezka] manifest registration failed:', e);
        }
    }

    // ==================== УТИЛИТЫ ====================
    const LS_PREFIX = 'rezka_';

    function getSetting(key, def = '') {
        const name = LS_PREFIX + key;
        try {
            if (typeof Lampa !== 'undefined' && Lampa.Storage && typeof Lampa.Storage.get === 'function') {
                return Lampa.Storage.get(name, def);
            }
            const val = localStorage.getItem(name);
            return val !== null ? val : def;
        } catch (e) {
            console.warn('[Rezka] getSetting failed:', e);
            return def;
        }
    }

    function setSetting(key, value) {
        const name = LS_PREFIX + key;
        try {
            if (typeof Lampa !== 'undefined' && Lampa.Storage && typeof Lampa.Storage.set === 'function') {
                Lampa.Storage.set(name, value);
                return;
            }
            localStorage.setItem(name, String(value));
        } catch (e) {
            console.warn('[Rezka] setSetting failed:', e);
        }
    }

    function notify(message) {
        if (typeof Lampa !== 'undefined' && Lampa.Noty) {
            Lampa.Noty.show(message);
        } else {
            console.log(message);
        }
    }

    function getMirror() {
        let mirror = getSetting('mirror', 'https://rezka.fi');
        if (!mirror.endsWith('/')) mirror += '/';
        return mirror;
    }

    function getCookies() {
        return getSetting('cookies', '');
    }

    function setCookies(cookieStr) {
        setSetting('cookies', cookieStr);
    }

    function extractIdFromUrl(url) {
        const match = url.match(/\/(\d+)-/);
        return match ? match[1] : null;
    }

    function absoluteUrl(href) {
        if (href.startsWith('http')) return href;
        if (href.startsWith('//')) return 'https:' + href;
        return getMirror() + href.replace(/^\//, '');
    }

    // ==================== СЕТЕВЫЕ ЗАПРОСЫ ====================
    async function request(url, options = {}) {
        const headers = options.headers || {};
        // Прикрепляем сохранённые cookies, если есть
        const cookies = getCookies();
        if (cookies) {
            headers['Cookie'] = cookies;
        }
        options.headers = headers;
        options.credentials = 'include'; // Позволяет браузеру автоматически сохранять/отправлять куки

        try {
            const response = await fetch(url, options);
            // Сохраняем новые cookies, если они появились
            const newCookies = document.cookie;
            if (newCookies && newCookies !== cookies) {
                setCookies(newCookies);
            }
            return response;
        } catch (e) {
            // Fallback на Lampa.Request, если fetch недоступен
            if (typeof Lampa !== 'undefined' && Lampa.Request && Lampa.Request.get) {
                return new Promise((resolve, reject) => {
                    Lampa.Request.get(
                        url,
                        (result) => {
                            resolve({
                                text: () => Promise.resolve(result),
                                json: () => Promise.resolve(JSON.parse(result))
                            });
                        },
                        {
                            withCredentials: true,
                            headers: headers
                        }
                    );
                });
            }
            throw e;
        }
    }

    async function postForm(url, formData) {
        return request(url, {
            method: 'POST',
            body: formData
        });
    }

    // ==================== АВТОРИЗАЦИЯ ====================
    async function login() {
        const email = getSetting('email');
        const password = getSetting('password');
        if (!email || !password) return false;

        try {
            const formData = new FormData();
            formData.append('login_name', email);
            formData.append('login_password', password);
            formData.append('login', 'submit');

            await postForm(getMirror() + 'ajax/login/', formData);

            // Сохраняем cookies после успешной авторизации
            const cookies = document.cookie;
            if (cookies) {
                setCookies(cookies);
                notify('Авторизация Rezka успешна');
                return true;
            } else {
                notify('Не удалось получить cookies после авторизации');
                return false;
            }
        } catch (e) {
            notify('Ошибка авторизации: ' + e.message);
            return false;
        }
    }

    async function ensureAuth() {
        const cookies = getCookies();
        if (cookies) return true;

        // Если cookies нет, пробуем войти по логину/паролю
        const email = getSetting('email');
        const password = getSetting('password');
        if (email && password) {
            return await login();
        }
        return false;
    }

    // ==================== ПАРСЕРЫ ====================
    function parseSearchResults(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const items = doc.querySelectorAll('div.b-content__inline_item');
        const results = [];

        items.forEach(item => {
            const link = item.querySelector('a.b-content__inline_item-link');
            if (!link) return;

            const href = link.getAttribute('href');
            const titleElement = item.querySelector('.b-content__inline_item-title');
            const title = titleElement ? titleElement.textContent.trim() : link.textContent.trim();
            const img = item.querySelector('img');
            const poster = img ? img.getAttribute('src') : '';

            results.push({
                id: absoluteUrl(href),
                title: title,
                poster: absoluteUrl(poster),
                type: href.includes('/series/') ? 'serial' : 'movie'
            });
        });

        return results;
    }

    function parseTranslations(doc) {
        const translators = [];
        const selectors = [
            'ul#translators-list > li',
            'ul#translator-list > li',
            'li[data-translator_id]'
        ];

        for (const sel of selectors) {
            const elements = doc.querySelectorAll(sel);
            if (elements.length > 0) {
                elements.forEach(li => {
                    const id = li.getAttribute('data-translator_id');
                    const title = li.textContent.trim();
                    if (id && title) {
                        translators.push({ id, title });
                    }
                });
                break;
            }
        }
        return translators;
    }

    function parseSeasons(doc) {
        const seasons = [];
        const elements = doc.querySelectorAll('ul#simple-seasons-tabs > li[data-season]');
        elements.forEach(li => {
            seasons.push({
                id: li.getAttribute('data-season'),
                title: li.textContent.trim()
            });
        });
        return seasons;
    }

    async function fetchEpisodes(contentId, seasonId) {
        const formData = new FormData();
        formData.append('id', contentId);
        formData.append('season', seasonId);

        try {
            const response = await postForm(getMirror() + 'ajax/get_episodes/', formData);
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const episodeItems = doc.querySelectorAll('li[data-episode_id]');
            return Array.from(episodeItems).map(li => ({
                id: li.getAttribute('data-episode_id'),
                title: li.textContent.trim()
            }));
        } catch (e) {
            console.error('Ошибка получения серий:', e);
            return [];
        }
    }

    async function parseInfoPage(html, url) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const contentId = extractIdFromUrl(url);
        if (!contentId) throw new Error('Не удалось определить ID контента');

        const isSerial = url.includes('/series/');
        const titleElement = doc.querySelector('h1');
        const title = titleElement ? titleElement.textContent.trim() : 'Без названия';
        const posterElement = doc.querySelector('img.b-post__image');
        const poster = posterElement ? absoluteUrl(posterElement.getAttribute('src')) : '';

        const info = {
            id: url,
            title: title,
            poster: poster,
            type: isSerial ? 'serial' : 'movie',
            translations: parseTranslations(doc)
        };

        if (isSerial) {
            info.seasons = parseSeasons(doc);
            info.episodes = {};

            // Загружаем серии для всех сезонов параллельно
            if (info.seasons.length > 0) {
                const seasonPromises = info.seasons.map(season =>
                    fetchEpisodes(contentId, season.id).then(episodes => {
                        info.episodes[season.id] = episodes;
                    })
                );
                await Promise.all(seasonPromises);
            }
        }

        return info;
    }

    // ==================== ДЕКОДИРОВАНИЕ ССЫЛОК (FALLBACK) ====================
    function decodeRezkaUrl(encoded) {
        if (!encoded) return [];

        // Первичная очистка: заменяем известные разделители на '|'
        let str = encoded;
        str = str.replace(/\/\/_\//g, '|');
        str = str.replace(/#/g, '');
        str = str.replace(/[^A-Za-z0-9+/=|]/g, '');

        const parts = str.split('|').filter(p => p.length > 5);
        const urls = [];

        function tryDecodePart(part) {
            try {
                const padded = part.padEnd(Math.ceil(part.length / 4) * 4, '=');
                const decoded = atob(padded);
                if (decoded.includes('http') || decoded.includes('m3u8') || decoded.includes('//')) {
                    let cleanUrl = decoded.trim();
                    if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
                    if (cleanUrl.startsWith('http')) {
                        let quality = 'unknown';
                        const qMatch = cleanUrl.match(/(\d{3,4})p?/);
                        if (qMatch) quality = qMatch[1] + 'p';
                        urls.push({ url: cleanUrl, quality });
                    } else {
                        const urlMatch = cleanUrl.match(/https?:\/\/[^\s"']+/);
                        if (urlMatch) {
                            let quality = 'unknown';
                            const qMatch = urlMatch[0].match(/(\d{3,4})p?/);
                            if (qMatch) quality = qMatch[1] + 'p';
                            urls.push({ url: urlMatch[0], quality });
                        }
                    }
                }
            } catch (e) {
                // игнорируем
            }
        }

        parts.forEach(tryDecodePart);

        // Если ничего не нашли, ищем валидные base64-подстроки
        if (urls.length === 0) {
            const base64Regex = /[A-Za-z0-9+/=]{20,}/g;
            let match;
            while ((match = base64Regex.exec(encoded)) !== null) {
                tryDecodePart(match[0]);
            }
        }

        // Убираем дубликаты
        const unique = [];
        const seen = new Set();
        for (const u of urls) {
            if (!seen.has(u.url)) {
                seen.add(u.url);
                unique.push(u);
            }
        }

        return unique;
    }

    // ==================== ПОЛУЧЕНИЕ ССЫЛКИ НА ВОСПРОИЗВЕДЕНИЕ ====================
    async function resolveVideo(item) {
        await ensureAuth();

        const contentId = extractIdFromUrl(item.id);
        if (!contentId) throw new Error('Некорректный ID');

        const translatorId = item.translator_id;
        const season = item.season_id || null;
        const episode = item.episode_id || null;

        const formData = new FormData();
        formData.append('id', contentId);
        formData.append('translator_id', translatorId);
        if (season && episode) {
            formData.append('season', season);
            formData.append('episode', episode);
        }
        formData.append('action', 'get_stream');
        formData.append('favs', '0');

        const response = await postForm(getMirror() + 'ajax/get_cdn_series/', formData);
        const data = await response.json();

        if (!data.success || !data.url) {
            throw new Error('Сервер не вернул URL');
        }

        // Если data.url уже прямая ссылка на m3u8 — отдаём её как есть
        if (data.url.startsWith('http') && data.url.includes('m3u8')) {
            return {
                playlist: [{
                    url: data.url,
                    quality: 'auto'
                }]
            };
        }

        // Иначе пробуем декодировать (на случай старых версий сайта)
        const decoded = decodeRezkaUrl(data.url);
        if (decoded.length === 0) {
            throw new Error('Не удалось декодировать ссылку');
        }

        return {
            playlist: decoded
        };
    }

    // ==================== РЕГИСТРАЦИЯ НАСТРОЕК ====================
    function registerSettings() {
        if (typeof Lampa === 'undefined' || !Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: 'rezka',
            name: 'Rezka'
        });

        // Зеркало
        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: {
                name: 'mirror',
                type: 'input',
                default: 'https://rezka.fi',
                placeholder: 'Рабочее зеркало'
            },
            field: {
                name: 'Зеркало'
            },
            onChange: (value) => setSetting('mirror', value)
        });

        // Email
        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: {
                name: 'email',
                type: 'input',
                default: '',
                placeholder: 'Email / Логин'
            },
            field: {
                name: 'Email / Логин'
            },
            onChange: (value) => setSetting('email', value)
        });

        // Пароль
        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: {
                name: 'password',
                type: 'password',
                default: '',
                placeholder: 'Пароль'
            },
            field: {
                name: 'Пароль'
            },
            onChange: (value) => setSetting('password', value)
        });

        // Cookie вручную
        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: {
                name: 'cookies',
                type: 'input',
                default: '',
                placeholder: 'Cookie авторизации (необязательно)'
            },
            field: {
                name: 'Cookie авторизации (необязательно)'
            },
            onChange: (value) => setSetting('cookies', value)
        });

        // Кнопка "Войти"
        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: {
                name: 'login_btn',
                type: 'button',
                default: 'Войти'
            },
            field: {
                name: 'Войти'
            },
            onChange: () => login()
        });
    }

    // ==================== РЕГИСТРАЦИЯ ИСТОЧНИКА ====================
    function registerSource() {
        // Intentionally not registering the legacy Rezka source here.
        // The current Lampa source API is different from the old registerSource contract.
        console.info('[Rezka] UI/auth shell loaded; source adapter is disabled in this build.');
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    function init() {
        registerManifest();
        registerSettings();
        registerSource();

        // Authentication is explicit: no silent credential submission during plugin startup.
    }

    // Надёжный запуск: в актуальной Lampa готовность передаётся
    // через Lampa.Listener событием 'app' -> { type: 'ready' }.
    let started = false;

    function boot() {
        if (started) return;
        if (typeof Lampa === 'undefined' || !Lampa.SettingsApi) return;
        started = true;
        init();
    }

    if (typeof Lampa !== 'undefined') {
        boot();

        if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
            Lampa.Listener.follow('app', function (event) {
                if (event && event.type === 'ready') boot();
            });
        }
    } else {
        const timer = setInterval(function () {
            if (typeof Lampa !== 'undefined' && Lampa.SettingsApi) {
                clearInterval(timer);
                boot();
            }
        }, 250);
    }
})();
