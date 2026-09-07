/**
HDREZKA for Lampa/Luxo (Apple TV / web / Android)
v2.5.0 — кнопка-источник в карточке фильма (панель «Источник» кнопки «Смотреть»),
умный подбор совпадения карточки TMDB ↔ rezka (год+название, ручной выбор при сомнении),
ряд «Новинки rezka» на главном экране, fallback-парсер списков.
*/
(function () {
'use strict';
if (window.rezka_plugin_ready) return;
window.rezka_plugin_ready = true;
var COMP_MAIN = 'rezka_main', COMP_LIST = 'rezka_list', COMP_CARD = 'rezka_card';
function log() { try { console.log.apply(console, ['[rezka]'].concat([].slice.call(arguments))); } catch (e) {} }

// ==================== ХРАНИЛИЩЕ / УТИЛИТЫ ====================
function stGet(k, d) { return Lampa.Storage.get('rezka_' + k, d === undefined ? '' : d); }
function stSet(k, v) { Lampa.Storage.set('rezka_' + k, v); }
function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mirror() {
    var m = (stGet('mirror', 'https://rezka.fi') || '').trim();
    if (!m) m = 'https://rezka.fi';
    if (m.slice(-1) !== '/') m += '/';
    return m;
}
function proxyUrl() {
    var p = (stGet('proxy', '') || '').trim().replace(/\s+/g, '');
    if (!p) return '';
    if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
    if (p.slice(-1) !== '/') p += '/';
    return p;
}
function transportMode() {
    var t = stGet('transport', 'auto');
    if (t === 'proxy' || t === 'direct') return t;
    return proxyUrl() ? 'proxy' : 'direct';
}
function encodeForm(o) {
    var p = [];
    for (var k in o) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k]));
    return p.join('&');
}
function absUrl(href) {
    if (!href) return '';
    if (href.indexOf('http') === 0) return href;
    if (href.indexOf('//') === 0) return 'https:' + href;
    return mirror() + href.replace(/^\//, '');
}
function relOf(href) {
    if (!href) return '';
    if (href.indexOf('http') === 0) {
        try { var u = new URL(href); return u.pathname + u.search; }
        catch (e) { return href.replace(/^https?:\/\/[^/]+/, ''); }
    }
    if (href.indexOf('//') === 0) return href.replace(/^\/\/[^/]+/, '');
    return href.replace(/^\//, '');
}
function textOf(el) { return el ? el.textContent.trim() : ''; }
function nodeList(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function snippet(s, n) { return String(s || '').replace(/\s+/g, ' ').slice(0, n || 100); }
function norm(s) { return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ''); }

// ==================== COOKIE-JAR ====================
function jarGet() { return stGet('cookies', '') || ''; }
function jarMerge(str) {
    if (!str) return;
    var jar = {};
    jarGet().split(';').forEach(function (p) {
        var i = p.indexOf('='); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    str.split(';').forEach(function (p) {
        var i = p.indexOf('=');
        if (i > 0) {
            var k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
            if (v === '') delete jar[k]; else jar[k] = v;
        }
    });
    var out = [];
    for (var k in jar) out.push(k + '=' + jar[k]);
    stSet('cookies', out.join('; '));
}
function jarHasAuth() { return /dle_user_id=|dle_password=|dle_user_token=|user_hash=/.test(jarGet()); }

// ==================== ТРАНСПОРТ ====================
function request(rel, options, onDone, onFail, _retry) {
    options = options || {};
    var method = options.method || 'GET';
    var body = options.form ? encodeForm(options.form) : null;
    var mode = transportMode();
    var url, headers = {};
    if (mode === 'proxy') {
        url = proxyUrl() + '?r=' + encodeURIComponent(rel) + '&m=' + encodeURIComponent(mirror());
        headers['X-Rezka-Cookie'] = jarGet();
        if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
        url = mirror() + rel;
        headers['X-Requested-With'] = 'XMLHttpRequest';
        if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    fetch(url, {
        method: method, headers: headers, body: body,
        credentials: mode === 'proxy' ? 'omit' : 'include'
    })
        .then(function (r) {
            var sc = '';
            try { sc = r.headers.get('x-rezka-set-cookie') || ''; } catch (e) {}
            if (sc) jarMerge(sc);
            return r.text().then(function (text) { return { status: r.status, text: text }; });
        })
        .then(function (res) {
            if (mode === 'direct') { try { jarMerge(document.cookie); } catch (e) {} }
            onDone(res);
        })
        .catch(function (e) {
            if (!_retry && mode === 'direct' && proxyUrl()) { request(rel, options, onDone, onFail, true); return; }
            var hint = '';
            if (mode === 'direct' && !proxyUrl())
                hint = '. Apple TV/web не могут ходить на rezka напрямую (CORS) — укажите «Прокси (Worker)»';
            else if (mode === 'proxy')
                hint = '. Worker недоступен или адрес неверный. Запрошено: ' + url;
            onFail(new Error(e.message + hint));
        });
}
function getText(rel, form, onDone, onFail) {
    request(rel, { method: form ? 'POST' : 'GET', form: form }, function (r) { onDone(r.text, r); }, onFail);
}
function getJson(rel, form, onDone, onFail) {
    request(rel, { method: form ? 'POST' : 'GET', form: form }, function (r) {
        var d = null;
        try { d = JSON.parse(r.text); } catch (e) {}
        if (d) onDone(d, r); else onFail(new Error('ответ не JSON: ' + snippet(r.text, 60)), r);
    }, onFail);
}

// ==================== REZKA API ====================
function htmlTitle(t) { var m = /<title[^>]*>([^<]{0,80})/i.exec(t || ''); return m ? m[1].trim() : ''; }
function apiLogin(cb) {
    var email = stGet('email', ''), pass = stGet('password', '');
    if (!email || !pass) { cb(false, 'укажите email и пароль'); return; }
    request('ajax/login/', {
        method: 'POST',
        form: { login_name: email, login_password: pass, login: 'submit' }
    }, function (res) {
        if (jarHasAuth()) { cb(true); return; }
        var isHtml = /<html|<!doctype/i.test(res.text || '');
        var extra = isHtml
            ? 'rezka вернула СТРАНИЦУ вместо ajax (title: «' + (htmlTitle(res.text) || '—') +
              '»). Обход: вставьте готовые cookies браузера в «Cookies вручную»'
            : 'ответ: ' + snippet(res.text, 120);
        cb(false, 'HTTP ' + res.status + ', куки не пришли. ' + extra);
    }, function (e) { cb(false, 'ошибка сети: ' + e.message); });
}
function ensureAuth(cb) {
    if (jarHasAuth()) { cb(true); return; }
    if (stGet('email') && stGet('password')) apiLogin(cb);
    else cb(true); // куки могли прийти сессией; пускаем, ошибка проявится на стриме
}
function parseList(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var out = [];
    nodeList('div.b-content__inline_item', doc).forEach(function (item) {
        var link = item.querySelector('a.b-content__inline_item-link');
        if (!link) return;
        var href = link.getAttribute('href') || '';
        var title = textOf(item.querySelector('.b-content__inline_item-title')) || textOf(link);
        var year = textOf(item.querySelector('.b-content__inline_item-year'));
        var img = item.querySelector('img');
        out.push({
            url: relOf(href),
            title: title,
            year: year,
            poster: img ? absUrl(img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original')) : '',
            type: href.indexOf('/series/') >= 0 ? 'serial' : 'movie'
        });
    });
    if (out.length) return out;
    // fallback: chunk-парсер (устойчив к перестановке атрибутов/классов)
    var chunks = String(html).split('b-content__inline_item');
    for (var i = 1; i < chunks.length; i++) {
        var c = chunks[i];
        var mh = /href="([^"]+\.html)"/.exec(c);
        if (!mh) continue;
        var href2 = mh[1];
        var mt = /class="b-content__inline_item-title"[^>]*>([^<]+)</.exec(c) || /<a[^>]*>\s*([^<]{2,90})\s*</.exec(c);
        var my = /class="b-content__inline_item-year"[^>]*>([^<]+)</.exec(c);
        var mi = /(?:src|data-src|data-original)="([^"]+\.(?:jpg|jpeg|png|webp))"/i.exec(c);
        out.push({
            url: relOf(href2),
            title: mt ? mt[1].trim() : '',
            year: my ? my[1].trim() : '',
            poster: mi ? absUrl(mi[1]) : '',
            type: href2.indexOf('/series/') >= 0 ? 'serial' : 'movie'
        });
    }
    return out;
}
function apiCard(rel, cb, fail) {
    getText(rel, null, function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var m = rel.match(/\/(\d+)-/);
        var pid = doc.querySelector('input#post_id');
        var translators = [], seen = {};
        nodeList('ul#translators-list li[data-translator_id], ul#translator-list li[data-translator_id], li[data-translator_id]', doc)
            .forEach(function (li) {
                var id = li.getAttribute('data-translator_id'), t = textOf(li);
                if (id && t && !seen[id]) { seen[id] = 1; translators.push({ id: id, title: t }); }
            });
        var seasons = nodeList('ul#simple-seasons-tabs li[data-season], li.b-simple_season__item[data-tab_id]', doc).map(function (li) {
            return { id: li.getAttribute('data-season') || li.getAttribute('data-tab_id'), title: textOf(li) };
        });
        var posterEl = doc.querySelector('img.b-post__image') || doc.querySelector('.b-post__poster img') || doc.querySelector('meta[property="og:image"]');
        cb({
            rel: rel,
            contentId: pid ? pid.getAttribute('value') : (m ? m[1] : null),
            title: textOf(doc.querySelector('h1')) || textOf(doc.querySelector('.b-post__title')) || 'Без названия',
            poster: posterEl ? absUrl(posterEl.getAttribute('src') || posterEl.getAttribute('content')) : '',
            descr: textOf(doc.querySelector('.b-post__description')),
            translators: translators,
            seasons: seasons,
            isSerial: rel.indexOf('/series/') >= 0
        });
    }, fail);
}
function apiEpisodes(contentId, season, cb, fail) {
    getText('ajax/get_episodes/', { id: contentId, season: season }, function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        cb(nodeList('li[data-episode_id]', doc).map(function (li) {
            return { id: li.getAttribute('data-episode_id'), title: textOf(li) };
        }));
    }, fail);
}
function decodeRezkaUrl(encoded) {
    var urls = [];
    if (!encoded) return urls;
    if (/^https?:/.test(encoded)) {
        var q0 = /(\d{3,4})p/.exec(encoded);
        return [{ url: encoded, quality: /\.m3u8/.test(encoded) ? 'AUTO' : (q0 ? q0[1] + 'p' : '1080p') }];
    }
    var str = encoded.replace(/\/\/_\/\//g, '|').replace(/#/g, '').replace(/[^A-Za-z0-9+/=|]/g, '');
    var parts = str.split('|').filter(function (p) { return p.length > 5; });
    function tryPart(part) {
        try {
            var dec = atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='));
            var mm = dec.match(/https?:\/\/[^\s"']+/);
            if (mm) {
                var q = mm[0].match(/(\d{3,4})p?/);
                urls.push({ url: mm[0], quality: q ? q[1] + 'p' : '1080p' });
            }
        } catch (e) {}
    }
    parts.forEach(tryPart);
    if (!urls.length) {
        var re = /[A-Za-z0-9+/=]{20,}/g, m;
        while ((m = re.exec(encoded)) !== null) tryPart(m[0]);
    }
    return urls;
}
function buildQuality(url) {
    if (/^https?:/.test(url) && /\.m3u8(?=$|\?)/.test(url)) return { 'AUTO': url };
    if (/^https?:/.test(url)) return { '1080p': url };
    var list = decodeRezkaUrl(url), map = {};
    list.forEach(function (q) { map[q.quality] = q.url; });
    return map;
}
function apiStream(card, voiceId, season, episode, cb, fail) {
    var form = { id: card.contentId, translator_id: voiceId || '', action: 'get_stream', favs: '0' };
    if (card.isSerial && season && episode) { form.season = season; form.episode = episode; }
    getJson('ajax/get_cdn_series/', form, function (data) {
        if (!data || !data.success || !data.url) { fail(new Error((data && data.message) || 'сервер не вернул ссылку')); return; }
        cb(buildQuality(data.url));
    }, fail);
}

// ==================== ПОДБОР КАРТОЧКИ TMDB ↔ REZKA ====================
function scoreOf(item, titles, year) {
    var t = norm(item.title), best = 0;
    titles.forEach(function (tt) {
        var n = norm(tt);
        if (!n) return;
        if (t === n) best = Math.max(best, 3);
        else if (t.indexOf(n) >= 0 || n.indexOf(t) >= 0) best = Math.max(best, 2);
    });
    if (year && item.year) {
        if (String(item.year) === year) best += 1;
        else if (Math.abs(parseInt(item.year, 10) - parseInt(year, 10)) <= 1) best += 0.5;
    }
    return best;
}
function findOnRezka(movie, cb, fail) {
    var titles = [];
    [movie.title, movie.original_title, movie.name, movie.original_name].forEach(function (t) {
        if (t && titles.indexOf(t) < 0) titles.push(t);
    });
    var year = ((movie.release_date || movie.first_air_date || '') + '').slice(0, 4);
    var qi = 0;
    function next() {
        if (qi >= titles.length) { fail(new Error('не найдено на rezka: ' + (titles.join(' / ') || movie.title))); return; }
        var q = titles[qi++];
        getText('search/?do=search&subaction=search&story=' + encodeURIComponent(q), null, function (html) {
            var scored = parseList(html)
                .map(function (it) { it._s = scoreOf(it, titles, year); return it; })
                .filter(function (it) { return it._s >= 2; })
                .sort(function (a, b) { return b._s - a._s; });
            if (!scored.length) { next(); return; }
            if (scored.length === 1 || scored[0]._s >= 4) { cb(scored[0]); return; }
            Lampa.Select.show({
                title: 'HDREZKA: выберите совпадение',
                items: scored.slice(0, 8).map(function (it) {
                    return { title: it.title + (it.year ? ' (' + it.year + ')' : ''), url: it.url };
                }),
                onSelect: function (s) {
                    Lampa.Select.close();
                    cb({ url: s.url, title: s.title.replace(/\s*\(\d{4}\)\s*$/, '') });
                },
                onBack: function () {
                    Lampa.Select.close();
                    Lampa.Controller.toggle('content');
                    fail(null, true);
                }
            });
        }, function () { next(); });
    }
    next();
}

// ==================== ИСТОРИЯ / TIMELINE ====================
function hashFor(meta) { return Lampa.Utils.hash(['rezka', meta.url, meta.season || 0, meta.episode || 0].join('|')); }
function histGet() { var h = stGet('history', []); return Array.isArray(h) ? h : []; }
function histSave(l) { stSet('history', l.slice(0, 100)); }
function histPush(meta) {
    var list = histGet().filter(function (x) {
        return !(x.url === meta.url && String(x.season || 0) === String(meta.season || 0) && String(x.episode || 0) === String(meta.episode || 0));
    });
    meta.ts = Date.now();
    list.unshift(meta);
    histSave(list);
}
function percentOf(meta) {
    try { return Lampa.Timeline.view(hashFor(meta)).percent || 0; } catch (e) { return 0; }
}

// ==================== ПЛЕЕР ====================
function playMeta(meta, playlist) {
    Lampa.Loading.start(function () { Lampa.Loading.stop(); });
    apiStream(meta._card, meta.voice_id, meta.season, meta.episode, function (quality) {
        Lampa.Loading.stop();
        var keys = Object.keys(quality);
        if (!keys.length) { Lampa.Noty.show('Rezka: не удалось получить ссылку', { style: 'error' }); return; }
        meta.hash = hashFor(meta);
        var file = {
            title: meta.title + (meta.season ? ' (S' + meta.season + ' E' + meta.episode + ')' : ''),
            url: quality[keys[0]],
            quality: quality,
            subtitles: [],
            isonline: true,
            hash: meta.hash,
            timeline: Lampa.Timeline.view(meta.hash),
            rezka: meta
        };
        Lampa.Player.play(file);
        if (playlist && playlist.length > 1) Lampa.Player.playlist(playlist);
    }, function (e) {
        Lampa.Loading.stop();
        Lampa.Noty.show('Rezka: ' + e.message, { style: 'error' });
    });
}
function buildSeasonPlaylist(card, baseMeta, episodes, cb) {
    var res = new Array(episodes.length), done = 0;
    function fin() { cb(res.filter(function (r) { return r && r.url; })); }
    episodes.forEach(function (ep, i) {
        var meta = {};
        for (var k in baseMeta) meta[k] = baseMeta[k];
        meta.episode = ep.id;
        meta.hash = hashFor(meta);
        apiStream(card, baseMeta.voice_id, baseMeta.season, ep.id, function (q) {
            var keys = Object.keys(q);
            res[i] = {
                title: card.title + ' — ' + (ep.title || ('Серия ' + ep.id)),
                url: keys.length ? q[keys[0]] : '',
                quality: q,
                isonline: true,
                hash: meta.hash,
                timeline: Lampa.Timeline.view(meta.hash),
                rezka: meta
            };
            if (++done === episodes.length) fin();
        }, function () { if (++done === episodes.length) fin(); });
    });
}
function initPlayerHooks() {
    Lampa.Player.listener.follow('start', function (data) {
        if (!data || !data.rezka) return;
        var cur = data.rezka;
        histPush(cur);
        function finalize() {
            cur.percent = percentOf(cur);
            histPush(cur);
            if (stGet('sync', '') === 'true' && cur._card) {
                request('ajax/send_watching/', {
                    method: 'POST',
                    form: {
                        id: cur._card.contentId, season: cur.season || '', episode: cur.episode || '',
                        translator_id: cur.voice_id || '', percent: Math.round(cur.percent || 0)
                    }
                }, function () {}, function () {});
            }
        }
        function onEnd() { finalize(); }
        function onDestroy() {
            finalize();
            try { Lampa.PlayerVideo.listener.remove('ended', onEnd); } catch (e) {}
            try { Lampa.Player.listener.remove('destroy', onDestroy); } catch (e) {}
        }
        Lampa.PlayerVideo.listener.follow('ended', onEnd);
        Lampa.Player.listener.follow('destroy', onDestroy);
    });
}

// ==================== UI: ОБЩИЕ ЭЛЕМЕНТЫ ====================
function sectionTitle(t) { return $('<div class="rezka-section">' + esc(t) + '</div>'); }
function cardEl(item, withProgress) {
    var el = $('<div class="rezka-card selector">' +
        '<div class="rezka-card__poster">' + (item.poster ? '<img src="' + esc(item.poster) + '" loading="lazy">' : '') + '</div>' +
        '<div class="rezka-card__title">' + esc(item.title) + '</div>' +
        '<div class="rezka-card__meta">' + esc(item.year || '') + (item.type === 'serial' ? ' · сериал' : '') + '</div>' +
        '</div>');
    if (withProgress) {
        var p = percentOf(item);
        if (p > 0) el.find('.rezka-card__poster').append('<div class="rezka-bar"><div style="width:' + p + '%"></div></div>');
        if (item.episode) el.append('<div class="rezka-card__ep">S' + item.season + ' E' + item.episode + '</div>');
    }
    return el;
}
function bindCard(el, it, getLast, setLast, withResume) {
    el.on('hover:focus', function () { setLast(el); });
    el.on('hover:enter', function () {
        Lampa.Activity.push({
            url: '', title: it.title, component: COMP_CARD,
            card_url: it.url, resume: withResume ? it : undefined, page: 1
        });
    });
}
function btnEl(label) { return $('<div class="rezka-btn selector">' + esc(label) + '</div>'); }
function makeController(comp, scroll, getLast) {
    comp.start = function () {
        Lampa.Controller.add('content', {
            toggle: function () {
                Lampa.Controller.collectionSet(scroll.render());
                Lampa.Controller.collectionFocus(getLast() || false, scroll.render());
            },
            left: function () {
                if (Navigator.canmove('left')) Navigator.move('left');
                else Lampa.Controller.toggle('menu');
            },
            right: function () { if (Navigator.canmove('right')) Navigator.move('right'); },
            up: function () { if (Navigator.canmove('up')) Navigator.move('up'); },
            down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
            back: function () { Lampa.Activity.backward(); }
        });
        Lampa.Controller.toggle('content');
    };
    comp.stop = function () {};
}

// ==================== ЭКРАН: ГЛАВНЫЙ ====================
var SECTIONS = [
    { key: 'films', title: 'Фильмы', path: 'films/' },
    { key: 'series', title: 'Сериалы', path: 'series/' },
    { key: 'cartoons', title: 'Мультфильмы', path: 'cartoons/' },
    { key: 'anime', title: 'Аниме', path: 'anime/' }
];
function RezkaMain(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var last = false, inited = false;
    function setLast(el) { last = el; }
    function openSearch() {
        if (Lampa.Search && Lampa.Search.open) {
            Lampa.Search.open({ onBack: function () { Lampa.Controller.toggle('content'); } });
            return;
        }
        Lampa.Activity.push({ url: '', title: 'Поиск', component: COMP_LIST, search: '', page: 1 });
    }
    function build() {
        scroll.clear();
        var hist = histGet();
        if (hist.length) {
            scroll.append(sectionTitle('Продолжить просмотр'));
            var hg = $('<div class="rezka-grid"></div>');
            hist.slice(0, 10).forEach(function (h) {
                var el = cardEl(h, true);
                bindCard(el, h, null, setLast, true);
                el.on('hover:long', function () {
                    Lampa.Select.show({
                        title: h.title,
                        items: [{ title: 'Убрать из истории' }, { title: 'Отмена' }],
                        onSelect: function (s) {
                            Lampa.Select.close();
                            if (s.title === 'Убрать из истории') {
                                histSave(histGet().filter(function (x) { return x.ts !== h.ts; }));
                                build();
                            }
                            Lampa.Controller.toggle('content');
                        },
                        onBack: function () { Lampa.Controller.toggle('content'); }
                    });
                });
                hg.append(el);
            });
            scroll.append(hg);
        }
        scroll.append(sectionTitle('Каталог Rezka'));
        var btns = $('<div class="rezka-btns"></div>');
        SECTIONS.forEach(function (sec) {
            var b = btnEl(sec.title);
            b.on('hover:focus', function () { last = b; });
            b.on('hover:enter', function () {
                Lampa.Activity.push({ url: '', title: sec.title, component: COMP_LIST, section: sec.path, page: 1 });
            });
            btns.append(b);
        });
        var bs = btnEl('Поиск');
        bs.on('hover:focus', function () { last = bs; });
        bs.on('hover:enter', openSearch);
        btns.append(bs);
        scroll.append(btns);
        scroll.append(sectionTitle('Новинки rezka'));
        var ng = $('<div class="rezka-grid"></div>');
        ng.append('<div class="rezka-note">Загрузка…</div>');
        scroll.append(ng);
        getText('', null, function (html) {
            if (!inited) return;
            ng.empty();
            var items = parseList(html).slice(0, 14);
            if (!items.length) { ng.append('<div class="rezka-note">Не удалось распознать главную страницу rezka</div>'); return; }
            items.forEach(function (it) {
                var el = cardEl(it, false);
                bindCard(el, it, null, setLast, false);
                ng.append(el);
            });
        }, function () {
            if (inited) ng.html('<div class="rezka-note">Ошибка загрузки новинок (проверьте «Тест соединения»)</div>');
        });
        if (!jarHasAuth()) {
            scroll.append($('<div class="rezka-note">Нет авторизации: Настройки → HDREZKA → «Cookies вручную» или «Войти на rezka».</div>'));
        }
    }
    this.create = function () { inited = true; build(); return this.render(); };
    this.destroy = function () { inited = false; scroll.destroy(); };
    this.render = function () { return scroll.render(); };
    this.empty = function () {};
    makeController(this, scroll, function () { return last; });
}

// ==================== ЭКРАН: СПИСОК ====================
function RezkaList(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var last = false, page = object.page || 1, inited = false;
    function setLast(el) { last = el; }
    function rel() {
        if (object.search) {
            var r = 'search/?do=search&subaction=search&story=' + encodeURIComponent(object.search);
            if (page > 1) r += '&search_start=' + page + '&full_search=1';
            return r;
        }
        var base = object.section || 'films/';
        return page > 1 ? base + 'page/' + page + '/' : base;
    }
    function load() {
        scroll.clear();
        scroll.append(sectionTitle('Загрузка…'));
        getText(rel(), null, function (html) {
            if (!inited) return;
            scroll.clear();
            var items = parseList(html);
            if (!items.length) { scroll.append(sectionTitle('Ничего не найдено')); return; }
            var grid = $('<div class="rezka-grid"></div>');
            items.forEach(function (it) {
                var el = cardEl(it, false);
                bindCard(el, it, null, setLast, false);
                grid.append(el);
            });
            scroll.append(grid);
            var next = btnEl('Следующая страница (' + (page + 1) + ')');
            next.on('hover:focus', function () { last = next; });
            next.on('hover:enter', function () { page++; load(); });
            scroll.append(next);
        }, function (e) {
            if (!inited) return;
            scroll.clear();
            scroll.append(sectionTitle('Ошибка: ' + (e && e.message ? e.message : 'загрузки')));
        });
    }
    this.create = function () { inited = true; load(); return this.render(); };
    this.destroy = function () { inited = false; scroll.destroy(); };
    this.render = function () { return scroll.render(); };
    this.empty = function () {};
    makeController(this, scroll, function () { return last; });
}

// ==================== ЭКРАН: КАРТОЧКА ====================
function RezkaCard(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var last = false, inited = false;
    var card = null, voiceIdx = 0, seasonId = '', episodes = [];
    function setLast(el) { last = el; }
    function pickVoice() {
        if (!card || !card.translators.length) return;
        var pref = stGet('last_voice', '');
        var idx = -1;
        for (var i = 0; i < card.translators.length; i++) if (card.translators[i].title === pref) idx = i;
        voiceIdx = idx >= 0 ? idx : 0;
    }
    function curVoice() { return card && card.translators.length ? card.translators[voiceIdx] : { id: '', title: '' }; }
    function loadEpisodes(cb) {
        if (!card.isSerial) { episodes = []; if (cb) cb(); return; }
        var sid = seasonId || (card.seasons.length ? card.seasons[0].id : '1');
        seasonId = sid;
        apiEpisodes(card.contentId, sid, function (eps) { episodes = eps; if (cb) cb(); }, function () { episodes = []; if (cb) cb(); });
    }
    function baseMeta() {
        var v = curVoice();
        return {
            _card: card, url: card.rel, title: card.title, poster: card.poster,
            type: card.isSerial ? 'serial' : 'movie',
            voice_id: v.id, voice: v.title,
            season: card.isSerial ? seasonId : '', episode: ''
        };
    }
    function playEpisode(ep) {
        var meta = baseMeta();
        meta.episode = ep.id;
        meta.hash = hashFor(meta);
        buildSeasonPlaylist(card, meta, episodes, function (playlist) { playMeta(meta, playlist); });
    }
    function playMovie() { playMeta(baseMeta(), null); }
    function render() {
        scroll.clear();
        if (!card) { scroll.append(sectionTitle('Загрузка…')); return; }
        try { if (Lampa.Background && Lampa.Background.change) Lampa.Background.change(card.poster); } catch (e) {}
        scroll.append($('<div class="rezka-head">' +
            '<div class="rezka-head__poster">' + (card.poster ? '<img src="' + esc(card.poster) + '">' : '') + '</div>' +
            '<div class="rezka-head__info"><div class="rezka-head__title">' + esc(card.title) + '</div>' +
            '<div class="rezka-head__descr">' + esc(card.descr) + '</div></div></div>'));
        var btns = $('<div class="rezka-btns"></div>');
        var hist = histGet().filter(function (h) { return h.url === card.rel; })[0];
        var bPlay = btnEl(card.isSerial ? (hist ? ('Продолжить S' + hist.season + ' E' + hist.episode) : 'Смотреть') : 'Смотреть');
        bPlay.on('hover:focus', function () { last = bPlay; });
        bPlay.on('hover:enter', function () {
            ensureAuth(function () {
                if (!card.isSerial) { playMovie(); return; }
                var target = object.resume || hist;
                if (target && target.season && String(target.season) !== String(seasonId || '')) seasonId = String(target.season);
                loadEpisodes(function () {
                    var ep = null;
                    if (target) for (var i = 0; i < episodes.length; i++) if (String(episodes[i].id) === String(target.episode)) ep = episodes[i];
                    if (!ep) ep = episodes[0];
                    if (ep) playEpisode(ep); else Lampa.Noty.show('Rezka: нет серий');
                });
            });
        });
        btns.append(bPlay);
        if (card.translators.length) {
            var bV = btnEl('Озвучка: ' + curVoice().title);
            bV.on('hover:focus', function () { last = bV; });
            bV.on('hover:enter', function () {
                Lampa.Select.show({
                    title: 'Озвучка',
                    items: card.translators.map(function (t) { return { title: t.title }; }),
                    onSelect: function (s) {
                        Lampa.Select.close();
                        for (var i = 0; i < card.translators.length; i++) if (card.translators[i].title === s.title) voiceIdx = i;
                        stSet('last_voice', s.title);
                        render();
                        Lampa.Controller.toggle('content');
                    },
                    onBack: function () { Lampa.Controller.toggle('content'); }
                });
            });
            btns.append(bV);
        }
        if (card.seasons.length > 1) {
            var bS = btnEl('Сезон: ' + (seasonId || card.seasons[0].id));
            bS.on('hover:focus', function () { last = bS; });
            bS.on('hover:enter', function () {
                Lampa.Select.show({
                    title: 'Сезон',
                    items: card.seasons.map(function (s) { return { title: s.title, id: s.id }; }),
                    onSelect: function (s) {
                        Lampa.Select.close();
                        seasonId = s.id;
                        loadEpisodes(function () { render(); Lampa.Controller.toggle('content'); });
                    },
                    onBack: function () { Lampa.Controller.toggle('content'); }
                });
            });
            btns.append(bS);
        }
        scroll.append(btns);
        if (card.isSerial) {
            scroll.append(sectionTitle('Серии'));
            if (!episodes.length) { scroll.append($('<div class="rezka-note">Серии не загрузились</div>')); return; }
            episodes.forEach(function (ep) {
                var meta = baseMeta(); meta.episode = ep.id;
                var p = percentOf(meta);
                var row = $('<div class="rezka-ep selector">' +
                    '<div class="rezka-ep__num">' + esc(ep.title || ('Серия ' + ep.id)) + '</div>' +
                    '<div class="rezka-ep__bar"><div style="width:' + p + '%"></div></div>' +
                    '<div class="rezka-ep__pct">' + (p ? Math.round(p) + '%' : '') + '</div></div>');
                row.on('hover:focus', function () { last = row; });
                row.on('hover:enter', function () { ensureAuth(function () { playEpisode(ep); }); });
                row.on('hover:long', function () {
                    Lampa.Select.show({
                        title: ep.title,
                        items: [{ title: p >= 90 ? 'Отметить как непросмотренную' : 'Отметить как просмотренную' }],
                        onSelect: function () {
                            Lampa.Select.close();
                            try { Lampa.Timeline.update({ hash: hashFor(meta), percent: p >= 90 ? 0 : 100, time: 0, duration: 0 }); } catch (e) {}
                            render();
                            Lampa.Controller.toggle('content');
                        },
                        onBack: function () { Lampa.Controller.toggle('content'); }
                    });
                });
                scroll.append(row);
            });
        }
    }
    function loadBySearch(title, then) {
        getText('search/?do=search&subaction=search&story=' + encodeURIComponent(title), null, function (html) {
            var items = parseList(html);
            if (!items.length) { Lampa.Noty.show('Rezka: не найдено: ' + title, { style: 'error' }); return; }
            var n = norm(title);
            var best = items[0];
            for (var i = 0; i < items.length; i++) {
                var t = norm(items[i].title);
                if (t.indexOf(n) >= 0 || n.indexOf(t) >= 0) { best = items[i]; break; }
            }
            apiCard(best.url, then, function (e) { Lampa.Noty.show('Rezka: ' + e.message, { style: 'error' }); });
        }, function () { Lampa.Noty.show('Rezka: ошибка поиска', { style: 'error' }); });
    }
    this.create = function () {
        inited = true;
        var done = function (c) {
            if (!inited) return;
            card = c;
            pickVoice();
            seasonId = (object.resume && object.resume.season) ? String(object.resume.season) : (c.seasons.length ? c.seasons[0].id : '');
            loadEpisodes(function () { render(); });
        };
        if (object.card_url) apiCard(object.card_url, done, function (e) {
            scroll.clear(); scroll.append(sectionTitle('Ошибка: ' + e.message));
        });
        else if (object.search_title) loadBySearch(object.search_title, done);
        return this.render();
    };
    this.destroy = function () { inited = false; scroll.destroy(); };
    this.render = function () { return scroll.render(); };
    this.empty = function () {};
    makeController(this, scroll, function () { return last; });
}

// ==================== КНОПКА-ИСТОЧНИК В КАРТОЧКЕ LAMPA ====================
// Панель «Источник» кнопки «Смотреть» строится ядром из DOM-кнопок
// .buttons--container > .full-start__button (см. full/start/buttons.js).
// Поэтому вставляем свою кнопку ровно так же, как это делают рабочие онлайн-плагины.
function addFullButton(render, movie) {
    try {
        if (!render || !render.length) return;
        var cont = render.find('.buttons--container');
        if (!cont.length || cont.find('.rezka--fullbtn').length) return;
        var btn = $('<div class="full-start__button selector view--rezka rezka--fullbtn" data-subtitle="онлайн">' +
            '<div class="full-start__button__ico"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 6.5 6 3.5-6 3.5v-7z"/></svg></div>' +
            '<span>HDREZKA</span></div>');
        btn.on('hover:enter', function () {
            Lampa.Loading.start(function () { Lampa.Loading.stop(); Lampa.Controller.toggle('content'); });
            findOnRezka(movie, function (it) {
                Lampa.Loading.stop();
                Lampa.Activity.push({ url: '', title: it.title || movie.title || 'Rezka', component: COMP_CARD, card_url: it.url, page: 1 });
            }, function (e, silent) {
                Lampa.Loading.stop();
                if (!silent) Lampa.Noty.show('Rezka: ' + ((e && e.message) || 'не найдено'), { style: 'error' });
                Lampa.Controller.toggle('content');
            });
        });
        var anchor = render.find('.view--torrent');
        if (anchor.length) anchor.after(btn); else cont.append(btn);
        log('full button injected');
    } catch (e) { log('full button error', e.message); }
}
function registerFullButton() {
    Lampa.Listener.follow('full', function (e) {
        if (e.type !== 'complite') return;
        var render = null;
        try { render = e.object.activity.render(); } catch (err) {}
        addFullButton(render, e.data.movie);
    });
    setTimeout(function () {
        try {
            var a = Lampa.Activity.active();
            if (a && a.component === 'full') addFullButton(a.activity.render(), a.card || a.movie);
        } catch (e) {}
    }, 1200);
}

// ==================== ПОИСК: ИСТОЧНИК В ЯДРЕ ====================
function registerSearchSource() {
    if (!Lampa.Search || !Lampa.Search.addSource || window.rezka_search_added) return;
    window.rezka_search_added = true;
    Lampa.Search.addSource({
        title: 'HDREZKA',
        search: function (params, oncomplite) {
            var query = (params && params.query) || '';
            if (query.length < 3) { oncomplite([]); return; }
            getText('search/?do=search&subaction=search&story=' + encodeURIComponent(query), null, function (html) {
                var cards = parseList(html).slice(0, 20).map(function (it) {
                    return {
                        id: 'rezka_' + Lampa.Utils.hash(it.url),
                        title: it.title,
                        original_title: it.title,
                        release_date: it.year || '0000',
                        overview: '',
                        img: it.poster,
                        rezka_url: it.url,
                        rezka_type: it.type,
                        source: 'rezka'
                    };
                });
                oncomplite(cards.length ? [{ title: 'HDREZKA', results: cards }] : []);
            }, function () { oncomplite([]); });
        },
        onCancel: function () {},
        onMore: function (params, close) { close(); },
        onSelect: function (params, close) {
            close();
            var el = params.element || {};
            Lampa.Activity.push({ url: '', title: el.title || 'Rezka', component: COMP_CARD, card_url: el.rezka_url, page: 1 });
        }
    });
}

// ==================== НАСТРОЙКИ ====================
function textParam(name, title, descr, opts) {
    opts = opts || {};
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: {
            name: name,
            type: 'input',
            values: '',
            default: '',
            placeholder: opts.mask ? '' : '— не задано —'
        },
        field: { name: title, description: descr },
        onRender: function (item) {
            if (opts.mask) {
                item.attr('data-static', 'true');
                item.find('.settings-param__value').text(opts.get && opts.get() ? '••••••' : '— не задано —');
            }
        },
        onChange: function (v) {
            if (typeof v !== 'string') return;
            opts.set(v);
            if (opts.mask) {
                try { Lampa.Storage.set(name, ''); } catch (e) {}
                $('.settings-param[data-name="' + name + '"] .settings-param__value').text(v ? '••••••' : '— не задано —');
            }
            Lampa.Noty.show('Сохранено: ' + title);
        }
    });
}
function registerSettings() {
    Lampa.SettingsApi.addComponent({
        component: 'rezka',
        name: 'HDREZKA',
        icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 6.5 6 3.5-6 3.5v-7z"/></svg>'
    });
    textParam('rezka_proxy', 'Прокси (Worker)',
        'Адрес вашего Cloudflare Worker, например https://xxx.workers.dev/',
        { set: function (v) { stSet('proxy', v); } });
    textParam('rezka_mirror', 'Зеркало rezka',
        'Актуальный домен, например https://rezka.fi',
        { set: function (v) { stSet('mirror', v || 'https://rezka.fi'); } });
    textParam('rezka_email', 'Email / логин rezka',
        'От вашего аккаунта rezka',
        { set: function (v) { stSet('email', v); } });
    textParam('rezka_password_ui', 'Пароль rezka',
        'Хранится только локально. Редактор всегда открывается пустым — вводите пароль целиком',
        { mask: true, get: function () { return stGet('password', ''); }, set: function (v) { stSet('password', v); } });
    textParam('rezka_cookies_ui', 'Cookies вручную (необязательно)',
        'Строка cookie из браузера: PHPSESSID=…; dle_user_id=…; dle_password=…',
        { mask: true, get: function () { return stGet('cookies', ''); }, set: function (v) { stSet('cookies', v); } });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_transport', type: 'select', values: { auto: 'Авто', proxy: 'Прокси (Worker)', direct: 'Напрямую' }, default: 'auto' },
        field: { name: 'Режим запросов', description: 'Авто = прокси, если адрес worker’а задан' },
        onChange: function (v) { stSet('transport', v); }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_reset_btn', type: 'button', default: '' },
        field: { name: 'Сбросить секреты', description: 'Стирает email, пароль и cookies из хранилища' },
        onChange: function () {
            stSet('email', ''); stSet('password', ''); stSet('cookies', '');
            try { Lampa.Storage.set('rezka_password_ui', ''); Lampa.Storage.set('rezka_cookies_ui', ''); } catch (e) {}
            Lampa.Noty.show('Секреты сброшены — введите заново');
            try { Lampa.Settings.update(); } catch (e) {}
        }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_diag_btn', type: 'button', default: '' },
        field: { name: 'Диагностика входа', description: 'Показывает, что сохранено и каким транспортом пойдёт запрос' },
        onChange: function () {
            var email = stGet('email', ''), pass = stGet('password', '');
            Lampa.Noty.show('email ' + email.length + ' симв., пароль ' + pass.length + ' симв., jar ' + jarGet().length +
                ' симв.' + (jarHasAuth() ? ' (auth есть)' : ' (auth нет)') + ', транспорт ' + transportMode());
        }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_login_btn', type: 'button', default: '' },
        field: { name: 'Войти на rezka', description: 'Отправляет логин/пароль и сохраняет cookies авторизации' },
        onChange: function () {
            Lampa.Noty.show('Rezka: вход… (' + transportMode() + ')');
            apiLogin(function (ok, err) {
                Lampa.Noty.show(ok ? 'Rezka: вход выполнен' : ('Rezka: ' + err), ok ? {} : { style: 'error' });
                try { Lampa.Settings.update(); } catch (e) {}
            });
        }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_test_btn', type: 'button', default: '' },
        field: { name: 'Тест соединения', description: 'Запрос главной rezka через текущий транспорт' },
        onChange: function () {
            Lampa.Noty.show('Rezka: проверка… (' + transportMode() + ')');
            getText('/', null, function (text, res) {
                var okHtml = /b-content__inline|<html/i.test(text || '');
                Lampa.Noty.show('Rezka: HTTP ' + (res ? res.status : '?') +
                    (okHtml ? ', HTML похож на rezka' : ', ответ: ' + snippet(text, 60)) +
                    (jarHasAuth() ? ', авторизация есть' : ', без авторизации'));
            }, function (e) { Lampa.Noty.show('Rezka: ' + e.message, { style: 'error' }); });
        }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_sync', type: 'trigger', default: false },
        field: { name: 'Синхронизация истории с rezka', description: 'Экспериментально: ajax/send_watching' },
        onChange: function (v) { stSet('sync', v ? 'true' : ''); }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_clear_hist', type: 'button', default: '' },
        field: { name: 'Очистить историю плагина' },
        onChange: function () { stSet('history', []); Lampa.Noty.show('История Rezka очищена'); }
    });
}

// ==================== СТИЛИ / МЕНЮ / СТАРТ ====================
function addCss() {
    Lampa.Template.add('rezka_css', '<style>' +
        '.rezka-section{font-size:1.3em;color:#9a9a9a;margin:1.2em 0 .8em}' +
        '.rezka-note{color:#888;padding:.6em 0}' +
        '.rezka-grid{display:flex;flex-wrap:wrap}' +
        '.rezka-card{width:9.5em;margin:0 1.2em 1.6em 0}' +
        '.rezka-card__poster{width:9.5em;height:14em;background:#1c1c1c;border-radius:.6em;overflow:hidden;position:relative}' +
        '.rezka-card__poster img{width:100%;height:100%;object-fit:cover}' +
        '.rezka-card.focus .rezka-card__poster{box-shadow:0 0 0 .25em #fff}' +
        '.rezka-card__title{font-size:.95em;margin-top:.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.rezka-card__meta,.rezka-card__ep{font-size:.8em;color:#8a8a8a}' +
        '.rezka-bar{position:absolute;left:0;right:0;bottom:0;height:.35em;background:#00000088}' +
        '.rezka-bar>div{height:100%;background:#5c86c5}' +
        '.rezka-btns{display:flex;flex-wrap:wrap;margin:.4em 0 1em}' +
        '.rezka-btn{padding:.8em 1.4em;background:#2a2a2a;border-radius:.6em;margin:0 .8em .8em 0}' +
        '.rezka-btn.focus{background:#3d3d3d;box-shadow:0 0 0 .2em #fff}' +
        '.rezka-head{display:flex;padding:1em 0 1.4em}' +
        '.rezka-head__poster{width:12em;height:18em;border-radius:.7em;overflow:hidden;background:#1c1c1c;margin-right:2em;flex-shrink:0}' +
        '.rezka-head__poster img{width:100%;height:100%;object-fit:cover}' +
        '.rezka-head__title{font-size:1.7em;margin-bottom:.6em}' +
        '.rezka-head__descr{color:#a5a5a5;line-height:1.45;max-height:12em;overflow:hidden}' +
        '.rezka-ep{display:flex;align-items:center;padding:.9em 1.2em;background:#232323;border-radius:.6em;margin-bottom:.6em}' +
        '.rezka-ep.focus{box-shadow:0 0 0 .2em #fff}' +
        '.rezka-ep__num{width:8em}' +
        '.rezka-ep__bar{flex:1;height:.4em;background:#3a3a3a;border-radius:.2em;margin:0 1em}' +
        '.rezka-ep__bar>div{height:100%;background:#5c86c5;border-radius:.2em}' +
        '.rezka-ep__pct{width:3.5em;text-align:right;color:#8a8a8a}' +
        '.view--rezka .full-start__button__ico{color:#5c86c5}' +
        '</style>');
    $('body').append(Lampa.Template.get('rezka_css', {}, true));
}
function addMenuItem() {
    var tries = 0;
    var iv = setInterval(function () {
        tries++;
        var list = $('.menu .menu__list').eq(0);
        if (list.length && !list.find('.rezka-menu-item').length) {
            var btn = $('<li class="menu__item selector rezka-menu-item">' +
                '<div class="menu__ico"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16v3H4zM4 9h10v3H4zM4 14h16v3H4zM4 19h10v2H4z"/></svg></div>' +
                '<div class="menu__text">HDREZKA</div></li>');
            btn.on('hover:enter', function () {
                Lampa.Activity.push({ url: '', title: 'HDREZKA', component: COMP_MAIN, page: 1 });
            });
            list.append(btn);
            clearInterval(iv);
        }
        if (tries > 20) clearInterval(iv);
    }, 1000);
}
function init() {
    addCss();
    Lampa.Component.add(COMP_MAIN, RezkaMain);
    Lampa.Component.add(COMP_LIST, RezkaList);
    Lampa.Component.add(COMP_CARD, RezkaCard);
    Lampa.Manifest.plugins = {
        type: 'video',
        version: '2.5.0',
        name: 'HDREZKA Lab',
        description: 'Фильмы и сериалы с rezka: озвучки, сезоны, серии, история',
        component: COMP_MAIN,
        onContextMenu: function () { return { title: 'Смотреть на HDREZKA' }; },
        onContextLauch: function (card) {
            Lampa.Loading.start(function () { Lampa.Loading.stop(); Lampa.Controller.toggle('content'); });
            findOnRezka(card, function (it) {
                Lampa.Loading.stop();
                Lampa.Activity.push({ url: '', title: it.title || card.title, component: COMP_CARD, card_url: it.url, page: 1 });
            }, function (e, silent) {
                Lampa.Loading.stop();
                if (!silent) Lampa.Noty.show('Rezka: ' + ((e && e.message) || 'не найдено'), { style: 'error' });
                Lampa.Controller.toggle('content');
            });
        }
    };
    registerSettings();
    registerSearchSource();
    registerFullButton();
    initPlayerHooks();
    addMenuItem();
}
if (window.appready) init();
else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') init(); });
})();
