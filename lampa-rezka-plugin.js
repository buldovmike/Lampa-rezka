/**
HDREZKA for Lampa/Luxo — v4.16.2
Fix: single-voice translator_id, user_hash, silent playlist build
*/
(function () {
'use strict';
if (window.rezka_plugin_ready) return;
window.rezka_plugin_ready = true;
var COMP_MAIN = 'rezka_main', COMP_LIST = 'rezka_list', COMP_CARD = 'rezka_card';
function log() { try { console.log.apply(console, ['[rezka]'].concat([].slice.call(arguments))); } catch (e) {} }

(function () {
    try {
        var origStringify = JSON.stringify;
        JSON.stringify = function (value, replacer, space) {
            try { return origStringify.call(JSON, value, replacer, space); }
            catch (e) { if (e && e.name === 'RangeError') return '{}'; throw e; }
        };
    } catch (e) {}
})();
(function () {
    try {
        var LIMIT = 60, WINDOW = 10000, t0 = Date.now(), cnt = 0;
        function guard(fn) {
            return function () {
                var n = Date.now();
                if (n - t0 > WINDOW) { t0 = n; cnt = 0; }
                cnt++;
                if (cnt > LIMIT) return undefined;
                try { return fn.apply(this, arguments); } catch (e) { return undefined; }
            };
        }
        if (window.history && typeof history.replaceState === 'function') history.replaceState = guard(history.replaceState.bind(history));
        if (window.history && typeof history.pushState === 'function') history.pushState = guard(history.pushState.bind(history));
    } catch (e) {}
})();

function stGet(k, d) { return Lampa.Storage.get('rezka_' + k, d === undefined ? '' : d); }
function stSet(k, v) { Lampa.Storage.set('rezka_' + k, v); }
function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mirror() {
    var m = (stGet('mirror', 'https://rezka.fi') || '').trim();
    if (!m) m = 'https://rezka.fi';
    if (m.slice(-1) !== '/') m += '/';
    return m;
}
function mirrorsList() {
    var def = 'https://rezka.fi,https://rezka.ag,https://hdrezka.ag';
    var raw = stGet('mirrors', def) || def;
    var arr = String(raw).split(/[\s,;]+/).filter(function (x) { return x; }).map(function (x) {
        if (!/^https?:\/\//i.test(x)) x = 'https://' + x;
        if (x.slice(-1) !== '/') x += '/';
        return x;
    });
    var prim = mirror();
    if (arr.indexOf(prim) < 0) arr.unshift(prim);
    return arr;
}
function mirrorsOrdered(preferred) {
    var list = mirrorsList();
    if (preferred) {
        var i = list.indexOf(preferred);
        if (i > 0) { list.splice(i, 1); list.unshift(preferred); }
    }
    return list;
}
function hostOf(m) { try { return new URL(m).host; } catch (e) { return m; } }
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
function absUrl(href, base) {
    if (!href) return '';
    if (href.indexOf('http') === 0) return href;
    if (href.indexOf('//') === 0) return 'https:' + href;
    return (base || mirror()) + href.replace(/^\//, '');
}
function relOf(href) {
    if (!href) return '';
    var h = String(href).split('#')[0];
    if (h.indexOf('http') === 0) {
        try { var u = new URL(h); return u.pathname + u.search; }
        catch (e) { return h.replace(/^https?:\/\/[^/]+/, ''); }
    }
    if (h.indexOf('//') === 0) return h.replace(/^\/\/[^/]+/, '');
    return h.replace(/^\//, '');
}
function textOf(el) { return el ? el.textContent.trim() : ''; }
function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function nodeList(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function snippet(s, n) { return String(s || '').replace(/\s+/g, ' ').slice(0, n || 100); }
function norm(s) { return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ''); }
function cleanTitle(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function searchRel(q, page) {
    var r = 'search/?do=search&subaction=search&q=' + encodeURIComponent(q);
    if (page && page > 1) r += '&search_start=' + page + '&full_search=1';
    return r;
}
function nextRel(rel, page) {
    if (page <= 1) return rel;
    if (rel.indexOf('?') >= 0) return rel + '&page=' + page;
    if (rel.slice(-1) !== '/') rel += '/';
    return rel + 'page/' + page + '/';
}
function hasNextPage(html, page) {
    if (!html) return false;
    if (html.indexOf('page/' + page + '/') >= 0) return true;
    if (html.indexOf('?page=' + page) >= 0) return true;
    return false;
}
function isBadHtml(html) {
    var t = String(html || '');
    if (!t) return true;
    if (/^\s*redirect/i.test(t)) return true;
    if (t.length < 500 && !/>(\s*?)(ВХОД|Вход|Login)/i.test(t) && t.indexOf('post_id') < 0 && t.indexOf('b-content__inline') < 0) return true;
    return false;
}
function acceptCard(html) {
    if (isBadHtml(html)) return false;
    return /id=["']?post_id|translator|data-translator_id|b-post|simple-seasons|simple_episodes|playerjs|initCDN|soCdnJS|file_list|data-episode_id|user_hash/.test(html);
}
function ajaxRel(r) { return 'engine/' + r.replace(/^\//, ''); }

function jarStore() {
    try { return JSON.parse(stGet('jars', '{}')) || {}; } catch (e) { return {}; }
}
function jarSave(o) { try { stSet('jars', JSON.stringify(o)); } catch (e) {} }
function jarGet(host) { return jarStore()[host] || ''; }
function jarMerge(host, str) {
    if (!str) return;
    var o = jarStore();
    var jar = {};
    (o[host] || '').split(';').forEach(function (p) {
        var i = p.indexOf('=');
        if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim();
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
    o[host] = out.join('; ');
    jarSave(o);
}
function jarSetHost(host, str) {
    var o = jarStore();
    o[host] = String(str || '');
    jarSave(o);
}
function jarHasAuth(host) {
    return /dle_user_id=|dle_password=|dle_user_token=|user_hash=/.test(jarGet(host || hostOf(mirror())));
}

function request(rel, options, onDone, onFail, _retry) {
    options = options || {};
    var method = options.method || 'GET';
    var body = options.form ? encodeForm(options.form) : null;
    var mode = transportMode();
    var base = options.mirror || mirror();
    var host = hostOf(base);
    var url, headers = {};
    if (mode === 'proxy') {
        url = proxyUrl() + '?r=' + encodeURIComponent(rel) + '&m=' + encodeURIComponent(base);
        headers['X-Rezka-Cookie'] = jarGet(host);
        if (options.referer) headers['X-Rezka-Referer'] = options.referer;
        if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
        url = base + rel;
        if (options.referer) headers['Referer'] = options.referer;
        if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (options.ajax) headers['X-Requested-With'] = 'XMLHttpRequest';
    fetch(url, {
        method: method, headers: headers, body: body,
        credentials: mode === 'proxy' ? 'omit' : 'include'
    })
    .then(function (r) {
        var sc = '';
        try { sc = r.headers.get('x-rezka-set-cookie') || ''; } catch (e) {}
        if (sc) jarMerge(host, sc);
        return r.text().then(function (text) { return { status: r.status, text: text }; });
    })
    .then(function (res) {
        if (mode === 'direct') { try { jarMerge(host, document.cookie); } catch (e) {} }
        onDone(res);
    })
    .catch(function (e) {
        if (!_retry && mode === 'direct' && proxyUrl()) { request(rel, options, onDone, onFail, true); return; }
        var hint = '';
        if (mode === 'direct' && !proxyUrl())
            hint = '. Apple TV/web не могут ходить на rezka напрямую (CORS) — укажите «Прокси»';
        else if (mode === 'proxy')
            hint = '. Прокси недоступен или адрес неверный. Запрошено: ' + url;
        onFail(new Error(e.message + hint));
    });
}
function getText(rel, opts, onDone, onFail) {
    request(rel, opts || { method: 'GET' }, function (r) { onDone(r.text, r); }, onFail);
}
function getJson(rel, form, referer, onDone, onFail, mirrorHost) {
    request(rel, { method: form ? 'POST' : 'GET', form: form, referer: referer, ajax: true, mirror: mirrorHost }, function (r) {
        var d = null;
        try { d = JSON.parse(r.text); } catch (e) {}
        if (d) onDone(d, r); else onFail(new Error('ответ не JSON: ' + snippet(r.text, 60)), r);
    }, onFail);
}
function fetchFromMirrors(rel, accept, cb, fail) {
    var list = mirrorsOrdered(''), i = 0, errs = [];
    function next() {
        if (i >= list.length) { fail(new Error(errs.join(' | ') || 'все зеркала отказали')); return; }
        var m = list[i++];
        getText(rel, { method: 'GET', mirror: m }, function (html) {
            if (accept(html)) cb(html, m);
            else { errs.push(hostOf(m) + ': ' + (isBadHtml(html) ? snippet(html, 30) || 'заглушка/301' : 'нет маркеров карточки')); next(); }
        }, function (e) { errs.push(hostOf(m) + ': ' + (e && e.message || 'сеть')); next(); });
    }
    next();
}
function getJsonAny(rel, form, refererBase, preferred, onDone, onFail) {
    var list = mirrorsOrdered(preferred), i = 0, errs = [];
    function next() {
        if (i >= list.length) { onFail(new Error(errs.join(' | ') || 'ajax недоступен на всех зеркалах')); return; }
        var m = list[i++];
        var ref = refererBase ? (m + refererBase.replace(/^\//, '')) : undefined;
        getJson(rel, form, ref, onDone, function (e) { errs.push(hostOf(m) + ': ' + (e && e.message || '')); next(); }, m);
    }
    next();
}

function parseList(html) {
    var out = [];
    try {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        nodeList('div.b-content__inline_item', doc).forEach(function (item) {
            var href = item.getAttribute('data-url') || '';
            var titleA = item.querySelector('.b-content__inline_item-link a');
            var anyA = item.querySelector('a[href]');
            if (!href && anyA) href = anyA.getAttribute('href') || '';
            if (!href || href.indexOf('.html') < 0) return;
            var img = item.querySelector('.b-content__inline_item-cover img') || item.querySelector('img');
            var title = textOf(titleA) || (anyA ? textOf(anyA) : '');
            var metaLine = '';
            var metaDivs = item.querySelectorAll('.b-content__inline_item-link div');
            if (metaDivs.length) metaLine = textOf(metaDivs[0]);
            var year = (metaLine.match(/(19|20)\d{2}/) || [])[0] || '';
            out.push({
                id: item.getAttribute('data-id') || '',
                url: relOf(href),
                title: cleanTitle(title) || 'Без названия',
                year: year,
                info: metaLine,
                poster: img ? absUrl(img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '') : '',
                type: href.indexOf('/series/') >= 0 ? 'serial' : 'movie'
            });
        });
    } catch (e) {}
    if (out.length) return out;
    var order = [], map = {};
    function rec(href) {
        var key = relOf(href);
        if (!map[key]) {
            map[key] = { url: key, title: '', year: '', info: '', poster: '', type: key.indexOf('/series/') >= 0 ? 'serial' : 'movie' };
            order.push(key);
        }
        return map[key];
    }
    function good(h) { return h && /\.html(\?|$)/.test(h) && h.indexOf('javascript:') < 0; }
    try {
        var doc2 = new DOMParser().parseFromString(html, 'text/html');
        nodeList('a[href]', doc2).forEach(function (a) {
            var href = a.getAttribute('href');
            if (!good(href)) return;
            var o = rec(href);
            var img = a.querySelector('img');
            if (img && !o.poster) o.poster = absUrl(img.getAttribute('src') || img.getAttribute('data-src') || '');
            var txt = textOf(a);
            if (!img && txt && !o.title) o.title = cleanTitle(txt.replace(/\s*(?:19|20)\d{2}.*$/, ''));
            if (!o.year && txt) { var ym = txt.match(/(19|20)\d{2}/); if (ym) o.year = ym[0]; }
        });
    } catch (e) {}
    order.forEach(function (k) { var o = map[k]; if (o.title || o.poster) out.push(o); });
    return out;
}

function parseContinue(html) {
    var out = [], seen = {};
    var BADGE = /смотреть\s+ещё|watch\s+more/i;
    var DATERE = /\b\d{1,2}[.-]\d{1,2}[.-]\d{2,4}\b|вчера|сегодня|today|yesterday/i;
    function push(date, title, href, info) {
        var key = relOf(href);
        if (!key || key.indexOf('.html') < 0 || seen[key]) return;
        var t = cleanTitle(title);
        if (!t || BADGE.test(t)) return;
        seen[key] = 1;
        var se = info.match(/(\d+)\s*(?:сезон|season)/i);
        var ep = info.match(/(\d+)\s*(?:серия|episode|сер\.)/i);
        out.push({
            url: key, title: t, date: cleanTitle(date), info: cleanTitle(info),
            season: se ? se[1] : '', episode: ep ? ep[1] : '',
            poster: '', type: key.indexOf('/series/') >= 0 ? 'serial' : 'movie'
        });
    }
    function fromRow(row) {
        if (!row) return;
        var anchors = nodeList('a[href*=".html"]', row);
        if (!anchors.length) return;
        var tds = row.querySelectorAll('td');
        var titleA = null, i;
        for (i = 0; i < anchors.length; i++) {
            var at = cleanTitle(textOf(anchors[i]));
            if (at && !BADGE.test(at)) { titleA = anchors[i]; break; }
        }
        if (!titleA) return;
        var href = (titleA.getAttribute('href') || '').split('#')[0];
        var title = cleanTitle(textOf(titleA));
        var date = '', info = '';
        if (tds.length >= 2) {
            date = textOf(tds[0]);
            info = textOf(tds[tds.length - 1]);
            if (BADGE.test(title)) title = cleanTitle(textOf(tds[tds.length >= 3 ? 1 : 0]));
        } else {
            var rowText = cleanTitle(textOf(row));
            var dm = rowText.match(DATERE);
            date = dm ? dm[0] : '';
            info = rowText.replace(title, '').replace(date, '').replace(/\s+/g, ' ').trim();
        }
        push(date, title, href, info);
    }
    function rowOf(a) {
        if (!a.closest) return null;
        return a.closest('tr') || a.closest('li') ||
               a.closest('[class*="item"]') || a.closest('[class*="row"]') || a.closest('[class*="line"]');
    }
    try {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var rows = nodeList('table tr', doc);
        if (rows.length) rows.forEach(fromRow);
        if (!out.length) {
            var handled = [];
            nodeList('a[href*=".html"]', doc).forEach(function (a) {
                var row = rowOf(a);
                if (!row || handled.indexOf(row) >= 0) return;
                handled.push(row);
                fromRow(row);
            });
        }
    } catch (e) {}
    return out;
}

function parseCardHtml(html, rel, base) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var title = '', origTitle = '', descr = '';
    var mh = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
    if (mh) {
        var tt = stripTags(mh[1]).split('|')[0].trim();
        if (tt) title = cleanTitle(tt.replace(/\s*(?:смотреть.*?онлайн|в\s+хорошем\s+качестве).*$/i, ''));
    }
    var ot = doc.querySelector('meta[property="og:title"]');
    if (ot) origTitle = cleanTitle(ot.getAttribute('content') || '');
    var od = doc.querySelector('meta[property="og:description"]');
    if (od) descr = cleanTitle(od.getAttribute('content') || '');
    var posterEl = doc.querySelector('.b-post__poster img') || doc.querySelector('img.b-post__image') ||
                   doc.querySelector('meta[property="og:image"]') || doc.querySelector('link[rel="image_src"]');
    var poster = posterEl ? absUrl(posterEl.getAttribute('src') || posterEl.getAttribute('content') || posterEl.getAttribute('href') || '', base) : '';
    var translators = [], seen = {};
    nodeList('ul#translators-list li[data-translator_id], ul#translator-list li[data-translator_id], .b-translator__item, li[data-translator_id]', doc)
    .forEach(function (li) {
        var id = li.getAttribute('data-translator_id'), t = textOf(li);
        if (id && t && !seen[id]) {
            seen[id] = 1;
            translators.push({
                id: id, title: t,
                camrip: li.getAttribute('data-camrip') === '1' ? '1' : '0',
                ads: li.getAttribute('data-ads') === '1' ? '1' : '0',
                director: li.getAttribute('data-director') === '1' ? '1' : '0'
            });
        }
    });
    if (!translators.length) {
        var re = /data-translator_id=["']?(\d+)["']?[^>]*>\s*([^<]+)/g, m;
        while ((m = re.exec(html)) !== null) {
            if (!seen[m[1]]) {
                seen[m[1]] = 1;
                translators.push({ id: m[1], title: cleanTitle(stripTags(m[2])), camrip: '0', ads: '0', director: '0' });
            }
        }
    }
    /* === FIX #1: расширенный поиск translator_id для сериалов с одной озвучкой === */
    var defaultTranslatorId = '';
    var mDef = html.match(/data-translator_id=["']?(\d+)["']?[^>]*class=["']?b-translator__item[^>]*?active/i) ||
               html.match(/id=["']?translators-list["']?[\s\S]*?data-translator_id=["']?(\d+)/i) ||
               html.match(/data-translator_id=["']?(\d+)/i) ||
               html.match(/translator_id["']?\s*[:=]\s*["']?(\d+)/i);
    if (mDef) defaultTranslatorId = mDef[1];
    var info = {};
    nodeList('.b-post__info tr', doc).forEach(function (tr) {
        var th = textOf(tr.querySelector('td.b-post__info-label')).replace(/:$/, '').toLowerCase();
        var td = tr.querySelector('td.b-post__info-data');
        if (td && th) info[th] = textOf(td);
    });
    var year = '', country = '', quality = '', age = '', duration = '';
    var imdb = '', kp = '';
    var genres = [];
    for (var k in info) {
        var v = info[k];
        if (/год|year/i.test(k)) year = (v.match(/\d{4}/) || [])[0] || year;
        if (/страна|country/i.test(k)) country = v.replace(/\s+/g, ' ').trim();
        if (/качество|quality/i.test(k)) quality = v.trim();
        if (/возраст|age/i.test(k)) age = v.trim();
        if (/время|duration/i.test(k)) duration = v.trim();
        if (/imdb/i.test(k)) imdb = (v.match(/[\d.]+/) || [])[0] || imdb;
        if (/кинопоиск|kp/i.test(k)) kp = (v.match(/[\d.]+/) || [])[0] || kp;
        if (/жанр|genre/i.test(k)) {
            genres = v.split(/[,;]/).map(function (g) { return cleanTitle(g); }).filter(function (g) { return g; });
        }
    }
    var actors = [];
    nodeList('.b-post__actors a, a[href*="/person/"]', doc).forEach(function (a) {
        var name = cleanTitle(textOf(a));
        if (!name) return;
        var img = a.querySelector('img');
        actors.push({
            name: name, role: '',
            purl: a.getAttribute('href') || '',
            img: img ? absUrl(img.getAttribute('src') || img.getAttribute('data-src') || '', base) : ''
        });
    });
    var similar = [];
    nodeList('.b-content__inline_item', doc).forEach(function (item) {
        var href = item.getAttribute('data-url') || '';
        var anyA = item.querySelector('a[href]');
        if (!href && anyA) href = anyA.getAttribute('href') || '';
        if (!href || href.indexOf('.html') < 0) return;
        var img = item.querySelector('.b-content__inline_item-cover img') || item.querySelector('img');
        var titleA = item.querySelector('.b-content__inline_item-link a');
        var title = textOf(titleA) || (anyA ? textOf(anyA) : '');
        similar.push({
            url: relOf(href),
            title: cleanTitle(title) || 'Без названия',
            poster: img ? absUrl(img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '') : '',
            type: href.indexOf('/series/') >= 0 ? 'serial' : 'movie'
        });
    });
    var franchiseTitle = '', franchise = [], franchiseUrl = '';
    var frEl = doc.querySelector('.b-post__franchise');
    if (frEl) {
        franchiseTitle = textOf(frEl.querySelector('.b-post__franchise-title'));
        franchiseUrl = '';
        nodeList('li a[href]', frEl).forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href.indexOf('.html') < 0) return;
            var img = a.querySelector('img');
            franchise.push({
                url: relOf(href),
                title: cleanTitle(a.getAttribute('title') || textOf(a)),
                poster: img ? absUrl(img.getAttribute('src') || '') : '',
                year: '',
                current: href === rel
            });
        });
    }
    var seasons = [];
    nodeList('ul.b-simple-seasons__list li, ul#seasons li, li[data-season]', doc)
    .forEach(function (li) {
        var id = li.getAttribute('data-tab_id') || li.getAttribute('data-season') || li.getAttribute('data-id') || li.getAttribute('data-value');
        var t = textOf(li);
        if (id && t) seasons.push({ id: id, title: t });
    });
    /* === FIX #2: извлечение user_hash из HTML === */
    var user_hash = '';
    var uh = html.match(/user_hash\s*[:=]\s*["']?([a-f0-9]{32})/i);
    if (uh) user_hash = uh[1];
    return {
        contentId: (rel.match(/\/(\d+)-/) || [])[1] || '',
        title: title || origTitle, origTitle: origTitle,
        poster: poster, descr: descr, info: info,
        translators: translators, seasons: seasons,
        year: year, country: country, quality: quality, age: age, duration: duration,
        imdb: imdb, kp: kp, genres: genres, actors: actors, similar: similar,
        franchiseTitle: franchiseTitle, franchise: franchise, franchiseUrl: franchiseUrl,
        isSerial: rel.indexOf('/series/') >= 0,
        user_hash: user_hash, defaultTranslatorId: defaultTranslatorId
    };
}

function scrapeEpisodesFromHtml(html) {
    var eps = {};
    var re = /<a[^>]*data-episode_id=["']?(\d+)["']?[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
        var tag = m[0].slice(0, m[0].indexOf('>') + 1);
        var sid = (tag.match(/data-season_id=["']?(\d+)["']?/) || [])[1] || '1';
        if (!eps[sid]) eps[sid] = [];
        eps[sid].push({ id: m[1], title: cleanTitle(stripTags(m[2])) || ('Серия ' + m[1]) });
    }
    return eps;
}

function parseQualityList(raw) {
    var map = {};
    if (!raw) return map;
    var re = /\[(\d+p[^\]]*)\]\s*(https?:\/\/[^\s\]]+)/g, m;
    while ((m = re.exec(String(raw))) !== null) map[m[1]] = m[2];
    if (!Object.keys(map).length) {
        var single = String(raw).match(/https?:\/\/[^\s"']+/);
        if (single) map[/\.m3u8/.test(single[0]) ? 'AUTO' : '1080p'] = single[0];
    }
    return map;
}
function pickInitial(map) {
    var pref = stGet('quality', 'auto');
    if (map[pref]) return map[pref];
    var nums = Object.keys(map).filter(function (k) { return /^\d+p/.test(k); })
        .sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
    if (nums.length) return map[nums[0]];
    var any = Object.keys(map);
    return any.length ? map[any[0]] : '';
}
function labelOfUrl(map, url) {
    for (var k in map) if (map[k] == url) return k;
    return '';
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
    var map = {};
    if (/^https?:/.test(url)) {
        if (/\.m3u8(?=$|\?)/.test(url)) return { 'AUTO': url };
        if (/\.mp4(?=$|\?|:)/.test(url)) { map['AUTO'] = url + ':hls:manifest.m3u8'; map['MP4'] = url; return map; }
        return { '1080p': url };
    }
    var list = decodeRezkaUrl(url);
    list.forEach(function (q) { map[q.quality] = q.url; });
    return map;
}
function streamFromHtml(card) {
    var h = card._html || '';
    var m = h.match(/file:\s*["']([^"']{20,})["']/) ||
            h.match(/initCDN\(\s*["']([^"']{20,})["']/) ||
            h.match(/soCdnJS\s*=\s*{[\s\S]{0,400}?url:\s*["']([^"']{20,})["']/);
    if (!m) return null;
    var q = buildQuality(m[1]);
    return Object.keys(q).length ? q : null;
}

function liteCard(card) {
    if (!card) return null;
    return {
        rel: card.rel, contentId: card.contentId, title: card.title, poster: card.poster,
        isSerial: card.isSerial, user_hash: card.user_hash, _mirror: card._mirror,
        translators: (card.translators || []).map(function (t) {
            return { id: t.id, title: t.title, camrip: t.camrip, ads: t.ads, director: t.director };
        })
    };
}
function sanitizeMeta(meta) {
    return {
        _card: liteCard(meta._card),
        url: meta.url, title: meta.title, poster: meta.poster, type: meta.type,
        voice_id: meta.voice_id, voice: meta.voice, season: meta.season, episode: meta.episode,
        hash: meta.hash, percent: meta.percent, ts: meta.ts
    };
}

function apiLogin(cb) {
    var email = stGet('email', ''), pass = stGet('password', '');
    if (!email || !pass) { cb(false, 'укажите email и пароль'); return; }
    var list = mirrorsOrdered(''), i = 0, errs = [];
    function next() {
        if (i >= list.length) { cb(false, errs.join(' | ') || 'вход не выполнен'); return; }
        var m = list[i++];
        request(ajaxRel('ajax/login/'), {
            method: 'POST',
            form: { login_name: email, login_password: pass, login: 'submit' },
            ajax: true, mirror: m
        }, function (res) {
            if (jarHasAuth(hostOf(m))) { cb(true, m); return; }
            errs.push(hostOf(m) + ': ' + snippet(res.text, 60));
            next();
        }, function (e) { errs.push(hostOf(m) + ': ' + e.message); next(); });
    }
    next();
}
function ensureAuth(cb) {
    if (jarHasAuth()) { cb(true); return; }
    if (stGet('email') && stGet('password')) apiLogin(function (ok) { cb(ok); });
    else cb(true);
}
function apiSeasonData(card, voiceId, cb, fail) {
    card._sd = card._sd || {};
    if (card._sd[voiceId]) { cb(card._sd[voiceId]); return; }
    function fromHtml() {
        var eps = scrapeEpisodesFromHtml(card._html || '');
        var keys = Object.keys(eps).sort(function (a, b) { return a - b; });
        if (!keys.length) return null;
        return { seasons: keys.map(function (k) { return { id: k, title: k + ' сезон' }; }), episodes: eps };
    }
    var tid = voiceId || card.defaultTranslatorId || '';
    var formE = { id: card.contentId, translator_id: tid, action: 'get_episodes' };
    getJsonAny(ajaxRel('ajax/get_cdn_series/'), formE, card.rel, card._mirror, function (d) {
        var sdoc = new DOMParser().parseFromString(d.seasons || '', 'text/html');
        var edoc = new DOMParser().parseFromString(d.episodes || '', 'text/html');
        var seasons = nodeList('li[data-tab_id], li[data-season]', sdoc).map(function (li) {
            return { id: li.getAttribute('data-tab_id') || li.getAttribute('data-season'), title: textOf(li) };
        });
        var eps = {};
        nodeList('li[data-episode_id]', edoc).forEach(function (li) {
            var sid = li.getAttribute('data-season_id') || '1';
            if (!eps[sid]) eps[sid] = [];
            eps[sid].push({ id: li.getAttribute('data-episode_id'), title: textOf(li) });
        });
        if (!seasons.length) {
            Object.keys(eps).sort(function (a, b) { return a - b; }).forEach(function (k) {
                seasons.push({ id: k, title: k + ' сезон' });
            });
        }
        if (!seasons.length) {
            var sd0 = fromHtml();
            if (sd0) { card._sd[voiceId] = sd0; cb(sd0); return; }
        }
        var sd = { seasons: seasons, episodes: eps };
        card._sd[voiceId] = sd;
        cb(sd);
    }, function (e) {
        log('get_episodes failed:', e && e.message);
        var sd0 = fromHtml();
        if (sd0) { card._sd[voiceId] = sd0; cb(sd0); return; }
        fail(e);
    });
}

/* === FIX #4a: добавлен параметр silent === */
function apiStream(card, voiceId, season, episode, cb, fail, silent) {
    var v = null, i;
    for (i = 0; i < (card.translators || []).length; i++) {
        if (card.translators[i].id === voiceId) v = card.translators[i];
    }
    var tid = voiceId || card.defaultTranslatorId || '';
    var form;
    if (card.isSerial && season && episode) {
        form = { id: card.contentId, translator_id: tid, season: season, episode: episode, action: 'get_stream' };
    } else {
        form = { id: card.contentId, translator_id: tid, action: 'get_movie',
            is_camrip: v ? v.camrip : '0', is_ads: v ? v.ads : '0', is_director: v ? v.director : '0' };
    }
    /* === FIX #3: передача user_hash === */
    if (card.user_hash) form.user_hash = card.user_hash;

    getJsonAny(ajaxRel('ajax/get_cdn_series/'), form, card.rel, card._mirror, function (data) {
        if (!data || !data.success) {
            var q0 = streamFromHtml(card);
            if (q0 && Object.keys(q0).length) { cb(q0); return; }
            var msg = (data && data.message) || 'сервер не вернул ссылку';
            /* === FIX #4b: тихий режим === */
            if (!silent) Lampa.Noty.show('Rezka: ' + msg, { style: 'error' });
            fail(new Error(msg));
            return;
        }
        var map = parseQualityList(data.url || data.streams);
        if (!Object.keys(map).length) {
            var q0 = streamFromHtml(card);
            if (q0 && Object.keys(q0).length) { cb(q0); return; }
            if (!silent) Lampa.Noty.show('Rezka: сервер не вернул ссылку', { style: 'error' });
            fail(new Error('сервер не вернул ссылку'));
            return;
        }
        cb(map);
    }, function (e) {
        var q0 = streamFromHtml(card);
        if (q0 && Object.keys(q0).length) { cb(q0); return; }
        /* === FIX #4c: тихий режим === */
        if (!silent) Lampa.Noty.show('Rezka: ' + (e && e.message || 'ошибка потока'), { style: 'error' });
        fail(e);
    });
}

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
    if (movie.title) titles.push(movie.title);
    if (movie.original_title && movie.original_title !== movie.title) titles.push(movie.original_title);
    if (!titles.length) { fail(new Error('нет названия')); return; }
    var year = movie.release_date ? String(movie.release_date).slice(0, 4) : '';
    var qi = 0;
    function next() {
        if (qi >= titles.length) { fail(new Error('не найдено на rezka: ' + (titles.join(' / ') || movie.title))); return; }
        var q = titles[qi++];
        getText(searchRel(q, 1), { method: 'GET' }, function (html) {
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

function hashFor(meta) { return Lampa.Utils.hash(['rezka', meta.url, meta.season || 0, meta.episode || 0].join('|')); }
function histGet() { var h = stGet('history', []); return Array.isArray(h) ? h : []; }
function histSave(l) { stSet('history', l.slice(0, 100)); }
function histPush(meta) {
    var safe = sanitizeMeta(meta);
    var list = histGet().filter(function (x) {
        return !(x.url === safe.url && String(x.season || 0) === String(safe.season || 0) && String(x.episode || 0) === String(safe.episode || 0));
    });
    safe.ts = Date.now();
    list.unshift(safe);
    histSave(list);
}
function percentOf(meta) {
    try { return Lampa.Timeline.view(hashFor(meta)).percent || 0; } catch (e) { return 0; }
}

function playMeta(meta, playlist) {
    Lampa.Loading.start(function () { Lampa.Loading.stop(); });
    apiStream(meta._card, meta.voice_id, meta.season, meta.episode, function (quality) {
        Lampa.Loading.stop();
        var keys = Object.keys(quality);
        if (!keys.length) { Lampa.Noty.show('Rezka: не удалось получить ссылку', { style: 'error' }); return; }
        var initial = pickInitial(quality);
        var qlabel = labelOfUrl(quality, initial) || 'AUTO';
        meta.hash = hashFor(meta);
        var file = {
            title: meta.title + (meta.season ? ' (S' + meta.season + ' E' + meta.episode + ')' : '') + ' · ' + qlabel,
            url: initial,
            quality: quality,
            subtitles: [],
            isonline: true,
            hash: meta.hash,
            timeline: Lampa.Timeline.view(meta.hash),
            rezka: sanitizeMeta(meta)
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
    if (!episodes.length) { fin(); return; }
    var queue = episodes.slice();
    (function step() {
        if (!queue.length) { fin(); return; }
        var ep = queue.shift();
        var i = episodes.indexOf(ep);
        var meta = {};
        for (var k in baseMeta) meta[k] = baseMeta[k];
        meta.episode = ep.id;
        meta.hash = hashFor(meta);
        apiStream(card, baseMeta.voice_id, baseMeta.season, ep.id, function (q) {
            var keys = Object.keys(q);
            res[i] = {
                title: card.title + ' — ' + (ep.title || ('Серия ' + ep.id)),
                url: keys.length ? pickInitial(q) : '',
                quality: q,
                isonline: true,
                hash: meta.hash,
                timeline: Lampa.Timeline.view(meta.hash),
                rezka: meta
            };
            setTimeout(step, 100);
        }, function () {
            res[i] = null;
            setTimeout(step, 100);
        /* === FIX #4d: silent=true для фонового плейлиста === */
        }, true);
    })();
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
                getJsonAny(ajaxRel('ajax/send_watching/'), {
                    id: cur._card.contentId, season: cur.season || '', episode: cur.episode || '',
                    translator_id: cur.voice_id || '', percent: Math.round(cur.percent || 0)
                }, cur._card.rel, cur._card._mirror, function () {}, function () {});
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

function pageWrap(scroll) {
    var w = $('<div class="rezka-page"></div>');
    w.append(scroll.render());
    return w;
}
var _navT = 0;
function refreshNav(scroll, compName, getLast) {
    var now = Date.now();
    if (now - _navT < 120) return;
    _navT = now;
    try {
        var act = Lampa.Activity.active();
        if (!act || act.component !== compName) return;
        var r = scroll.render();
        Lampa.Controller.collectionSet(r);
        if (!r.find('.focus').length) Lampa.Controller.collectionFocus((getLast && getLast()) || false, r);
    } catch (e) {}
}
function makeController(comp, scroll, getLast) {
    function follow() {
        setTimeout(function () {
            try {
                var f = scroll.render().find('.focus').first();
                if (f.length) scroll.update(f, true);
            } catch (e) {}
        }, 30);
    }
    function manual(dir) {
        try {
            var items = scroll.render().find('.selector');
            var cur = scroll.render().find('.focus').first();
            var i = items.index(cur);
            if (dir === 'down') { if (i >= 0 && i < items.length - 1) { Lampa.Controller.collectionFocus(items.eq(i + 1), scroll.render()); follow(); } }
            else { if (i > 0) { Lampa.Controller.collectionFocus(items.eq(i - 1), scroll.render()); follow(); } }
        } catch (e) {}
    }
    comp.start = function () {
        Lampa.Controller.add('content', {
            toggle: function () {
                var r = scroll.render();
                Lampa.Controller.collectionSet(r);
                Lampa.Controller.collectionFocus(getLast() || false, r);
            },
            left: function () {
                if (Navigator.canmove('left')) Navigator.move('left');
                else Lampa.Controller.toggle('menu');
            },
            right: function () { if (Navigator.canmove('right')) Navigator.move('right'); },
            up: function () { if (Navigator.canmove('up')) { Navigator.move('up'); follow(); } else manual('up'); },
            down: function () { if (Navigator.canmove('down')) { Navigator.move('down'); follow(); } else manual('down'); },
            back: function () { Lampa.Activity.backward(); }
        });
        Lampa.Controller.toggle('content');
        setTimeout(function () {
            try {
                var r = scroll.render();
                if (!r.find('.focus').length) {
                    Lampa.Controller.collectionSet(r);
                    Lampa.Controller.collectionFocus(getLast() || false, r);
                }
            } catch (e) {}
        }, 120);
    };
    comp.stop = function () {};
}

function sectionTitle(t) { return $('<div class="rezka-section">' + esc(t) + '</div>'); }
function cardEl(item, withProgress) {
    var metaLine = item.info || (item.year ? item.year : '');
    var el = $('<div class="rezka-card selector" data-url="' + esc(item.url) + '">' +
        '<div class="rezka-card__poster">' + (item.poster ? '<img src="' + esc(item.poster) + '">' : '') + '</div>' +
        '<div class="rezka-card__title">' + esc(item.title || 'Без названия') + '</div>' +
        '<div class="rezka-card__meta">' + esc(metaLine) + (item.type === 'serial' ? ' · сериал' : '') + '</div>' +
        '</div>');
    if (withProgress) {
        var p = percentOf(item);
        if (p > 0) el.find('.rezka-card__poster').append('<div class="rezka-bar"><div style="width:' + p + '%"></div></div>');
        if (item.episode) el.append('<div class="rezka-card__ep">S' + item.season + ' E' + item.episode + '</div>');
    }
    return el;
}
function continueHeadEl() {
    return $('<div class="rezka-cont rezka-cont--head">' +
        '<div class="rezka-cont__date">Дата</div>' +
        '<div class="rezka-cont__title">Название</div>' +
        '<div class="rezka-cont__info">Последняя информация</div></div>');
}
function continueRowEl(item) {
    return $('<div class="rezka-cont selector" data-url="' + esc(item.url) + '">' +
        '<div class="rezka-cont__date">' + esc(item.date || '') + '</div>' +
        '<div class="rezka-cont__title">' + esc(item.title) + '</div>' +
        '<div class="rezka-cont__info">' + esc(item.info || '') + '</div></div>');
}
function bindCard(el, it, scroll, setLast, resume) {
    el.on('hover:focus', function () {
        setLast(el);
        if (scroll) scroll.update(el, true);
    });
    el.on('hover:enter', function () {
        Lampa.Activity.push({
            url: '', title: it.title || 'Rezka', component: COMP_CARD,
            card_url: it.url, card_meta: it, resume: resume ? it : undefined, page: 1
        });
    });
}
function btnEl(label) { return $('<div class="rezka-btn selector">' + esc(label) + '</div>'); }
function actorEl(a, idx) {
    return $('<div class="rezka-actor selector" data-aidx="' + idx + '">' +
        '<div class="rezka-actor__ph">' + (a.img ? '<img src="' + esc(a.img) + '">' : '<div class="rezka-actor__ini">' + esc((a.name || '?').charAt(0)) + '</div>') + '</div>' +
        '<div class="rezka-actor__tx">' +
        '<div class="rezka-actor__n">' + esc(a.name) + '</div>' +
        '<div class="rezka-actor__r">' + esc(a.role || 'Фильмография') + '</div></div></div>');
}
function frCardEl(f) {
    var rv = parseFloat(f.rating || '0');
    var rcls = !f.rating ? '' : (rv >= 7 ? ' good' : (rv < 5 ? ' bad' : ''));
    return $('<div class="rezka-frcard selector' + (f.current ? ' cur' : '') + '" data-furl="' + esc(f.url) + '">' +
        '<div class="rezka-frcard__p">' + (f.poster ? '<img src="' + esc(f.poster) + '">' : '<div class="rezka-frcard__ph">' + esc(f.year || '—') + '</div>') + '</div>' +
        '<div class="rezka-frcard__t">' + esc(f.title) + '</div>' +
        '<div class="rezka-frcard__m">' +
        '<span>' + esc(f.year || '—') + '</span>' +
        '<span class="rezka-frcard__r' + rcls + '">' + esc(f.rating || '—') + '</span></div></div>');
}

var SECTIONS = [
    { key: 'films', title: 'Фильмы', path: 'films/' },
    { key: 'series', title: 'Сериалы', path: 'series/' },
    { key: 'cartoons', title: 'Мультфильмы', path: 'cartoons/' },
    { key: 'anime', title: 'Аниме', path: 'anime/' }
];
var HOME_ROWS = [
    { title: 'Сейчас смотрят на rezka', rel: 'new/?filter=watching' },
    { title: 'Последние поступления', rel: 'new/?filter=last' },
    { title: 'Популярное на rezka', rel: 'new/?filter=popular' }
];

function RezkaMain(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
    var wrap = pageWrap(scroll);
    var last = false, inited = false;
    function setLast(el) { last = el; }
    function nav() { refreshNav(scroll, COMP_MAIN, function () { return last; }); }
    function openSearch() {
        if (Lampa.Search && Lampa.Search.open) {
            Lampa.Search.open({ onBack: function () { Lampa.Controller.toggle('content'); } });
            return;
        }
        Lampa.Activity.push({ url: '', title: 'Поиск', component: COMP_LIST, search: '', page: 1 });
    }
    function makeRowCar(rel, title) {
        var box = $('<div class="rezka-rowbox"></div>');
        box.append(sectionTitle(title));
        var h = new Lampa.Scroll({ horizontal: true, mask: true, over: true, step: 300 });
        var line = $('<div class="rezka-line"></div>');
        line.append('<div class="rezka-note">Загрузка…</div>');
        h.append(line);
        box.append(h.render());
        var page = 1, busy = false, doneAll = false;
        function cardsOf(items) {
            items.forEach(function (it) {
                var el = cardEl(it, false);
                el.on('hover:focus', function () {
                    setLast(el);
                    h.update(el, true);
                    var r = box[0].getBoundingClientRect();
                    if (r.top < -10 || r.top > window.innerHeight - 140) scroll.update(box, false);
                });
                el.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '', title: it.title || 'Rezka', component: COMP_CARD,
                        card_url: it.url, card_meta: it, page: 1
                    });
                });
                line.append(el);
            });
        }
        function loadMore() {
            if (busy || doneAll || !inited) return;
            busy = true;
            getText(nextRel(rel, page), { method: 'GET' }, function (html) {
                busy = false;
                if (!inited) return;
                line.find('.rezka-note').remove();
                var items = parseList(html).slice(0, 14);
                if (!items.length) { doneAll = true; return; }
                cardsOf(items);
                if (!hasNextPage(html, page + 1)) doneAll = true; else page++;
                nav();
            }, function () {
                busy = false;
                if (inited && !line.children('.rezka-card').length) line.find('.rezka-note').text('Ошибка загрузки ленты');
            });
        }
        h.onEnd = function () { loadMore(); };
        loadMore();
        return box;
    }
    function fillContinue(grid) {
        getText('continue/', { method: 'GET' }, function (html) {
            if (!inited) return;
            grid.empty();
            if (isBadHtml(html)) { grid.append('<div class="rezka-note">«Досмотреть» недоступно (нужна авторизация rezka)</div>'); nav(); return; }
            var items = parseContinue(html).slice(0, 15);
            if (!items.length) { grid.append('<div class="rezka-note">На rezka нет начатых просмотров</div>'); nav(); return; }
            grid.append(continueHeadEl());
            items.forEach(function (it) {
                var el = continueRowEl(it);
                el.on('hover:focus', function () { setLast(el); scroll.update(el, true); });
                el.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '', title: it.title, component: COMP_CARD,
                        card_url: it.url, card_meta: it, resume: it, page: 1
                    });
                });
                grid.append(el);
            });
            nav();
        }, function () {
            if (inited) { grid.html('<div class="rezka-note">«Досмотреть» недоступно (нужна авторизация rezka)</div>'); nav(); }
        });
    }
    function build() {
        scroll.clear();
        scroll.append(sectionTitle('Досмотреть на rezka'));
        var cg = $('<div class="rezka-grid"></div>');
        cg.append('<div class="rezka-note">Загрузка…</div>');
        scroll.append(cg);
        fillContinue(cg);
        var hist = histGet();
        if (hist.length) {
            scroll.append(sectionTitle('Продолжить просмотр (локально)'));
            var hg = $('<div class="rezka-grid"></div>');
            hist.slice(0, 10).forEach(function (h) {
                var el = cardEl(h, true);
                bindCard(el, h, scroll, setLast, true);
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
            b.on('hover:focus', function () { setLast(b); scroll.update(b, true); });
            b.on('hover:enter', function () {
                Lampa.Activity.push({ url: '', title: sec.title, component: COMP_LIST, section: sec.path, page: 1 });
            });
            btns.append(b);
        });
        var bs = btnEl('Поиск');
        bs.on('hover:focus', function () { setLast(bs); scroll.update(bs, true); });
        bs.on('hover:enter', openSearch);
        btns.append(bs);
        scroll.append(btns);
        HOME_ROWS.forEach(function (row) { scroll.append(makeRowCar(row.rel, row.title)); });
        if (!jarHasAuth()) {
            scroll.append($('<div class="rezka-note">Нет авторизации rezka.fi: Настройки → HDREZKA → «Cookies вручную» или «Войти».</div>'));
        }
        nav();
    }
    this.create = function () { inited = true; build(); return this.render(); };
    this.destroy = function () { inited = false; scroll.destroy(); };
    this.render = function () { return wrap; };
    this.empty = function () {};
    makeController(this, scroll, function () { return last; });
}

function RezkaList(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
    var wrap = pageWrap(scroll);
    var last = false, page = object.page || 1, inited = false;
    function setLast(el) { last = el; }
    function nav() { refreshNav(scroll, COMP_LIST, function () { return last; }); }
    function rel() {
        if (object.person) return nextRel(object.person, page);
        if (object.search) return searchRel(object.search, page);
        var base = object.section || 'films/';
        return page > 1 ? base + 'page/' + page + '/' : base;
    }
    function load(restoreFocus) {
        scroll.clear();
        scroll.append(sectionTitle('Загрузка…'));
        getText(rel(), { method: 'GET' }, function (html) {
            if (!inited) return;
            scroll.clear();
            if (isBadHtml(html)) { scroll.append(sectionTitle('Недоступно: ' + snippet(html, 40))); nav(); return; }
            var items = parseList(html);
            if (!items.length) { scroll.append(sectionTitle('Ничего не найдено')); nav(); return; }
            var grid = $('<div class="rezka-grid"></div>');
            items.forEach(function (it) {
                var el = cardEl(it, false);
                bindCard(el, it, scroll, setLast, false);
                grid.append(el);
            });
            scroll.append(grid);
            if (hasNextPage(html, page + 1)) {
                var next = btnEl('Следующая страница (' + (page + 1) + ')');
                next.on('hover:focus', function () { setLast(next); scroll.update(next, true); });
                next.on('hover:enter', function () { page++; load(true); });
                scroll.append(next);
            }
            nav();
            if (restoreFocus) {
                var f = scroll.render().find('.selector').first();
                if (f.length) Lampa.Controller.collectionFocus(f, scroll.render());
            }
        }, function (e) {
            if (!inited) return;
            scroll.clear();
            scroll.append(sectionTitle('Ошибка: ' + (e && e.message ? e.message : 'загрузки')));
            nav();
        });
    }
    this.create = function () { inited = true; load(false); return this.render(); };
    this.destroy = function () { inited = false; scroll.destroy(); };
    this.render = function () { return wrap; };
    this.empty = function () {};
    makeController(this, scroll, function () { return last; });
}

function RezkaCard(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
    var wrap = pageWrap(scroll);
    var last = false, inited = false;
    var card = null, voiceIdx = 0, seasonId = '', episodes = [], lastEpId = '';
    var focusKey = 'play', needFocusRestore = false;
    var meta = object.card_meta || {};
    function setLast(el) {
        last = el;
        try { var fk = el.attr ? el.attr('data-fk') : ''; if (fk) focusKey = fk; } catch (e) {}
    }
    function nav() { refreshNav(scroll, COMP_CARD, function () { return last; }); }
    function focusRestore() {
        setTimeout(function () {
            try {
                var r = scroll.render();
                var cur = r.find('.focus').first();
                var detached = !cur.length || !document.contains(cur[0]);
                if (needFocusRestore || detached) {
                    var t = r.find('[data-fk="' + focusKey + '"]').first();
                    if (!t.length) t = r.find('.selector').first();
                    if (t.length) {
                        last = t;
                        Lampa.Controller.toggle('content');
                    }
                    needFocusRestore = false;
                }
            } catch (e) {}
        }, 80);
    }
    function initialCard() {
        var rel = object.card_url || meta.url || '';
        var m = rel.match(/\/(\d+)-/);
        return {
            rel: rel, contentId: m ? m[1] : null,
            title: meta.title || 'Загрузка…', poster: meta.poster || '',
            descr: meta.info || '', translators: [], seasons: [], info: {},
            origTitle: '', year: meta.year || '', country: '', quality: '', age: '', duration: '',
            imdb: '', kp: '', genres: [], actors: [], similar: [],
            franchiseTitle: '', franchise: [], franchiseUrl: '',
            isSerial: meta.type === 'serial' || rel.indexOf('/series/') >= 0,
            _html: '', _mirror: '', user_hash: '', defaultTranslatorId: ''
        };
    }
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
        apiSeasonData(card, curVoice().id, function (sd) {
            if (sd.seasons.length && (!card.seasons || !card.seasons.length)) card.seasons = sd.seasons;
            var sid = seasonId || ((sd.seasons[0] || {}).id) || '1';
            seasonId = sid;
            episodes = sd.episodes[sid] || [];
            if (cb) cb();
        }, function () { episodes = []; if (cb) cb(); });
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
        var meta2 = baseMeta();
        meta2.episode = ep.id;
        meta2.hash = hashFor(meta2);
        buildSeasonPlaylist(card, meta2, episodes, function (playlist) { playMeta(meta2, playlist); });
    }
    function playMovie() { playMeta(baseMeta(), null); }
    function enrichPoster() {
        if (card.poster || !card.title || card.title === 'Загрузка…') return;
        getText(searchRel(card.title, 1), { method: 'GET' }, function (html) {
            if (!inited) return;
            var items = parseList(html), nt = norm(card.title), i;
            for (i = 0; i < items.length; i++) {
                if (norm(items[i].title) === nt && items[i].url === card.rel) { card.poster = items[i].poster; break; }
            }
            if (!card.poster) for (i = 0; i < items.length; i++) if (norm(items[i].title) === nt) { card.poster = items[i].poster; break; }
            render();
        }, function () {});
    }
    function applyActorImg(a, idx) {
        try {
            if (!a.img) return;
            var ph = scroll.render().find('.rezka-actor[data-aidx="' + idx + '"] .rezka-actor__ph');
            if (ph.length && !ph.find('img').length) ph.html('<img src="' + esc(a.img) + '">');
        } catch (e) {}
    }
    function personImgCache() { try { return JSON.parse(stGet('actor_imgs', '{}')) || {}; } catch (e) { return {}; } }
    function personImgSave(c) { try { stSet('actor_imgs', JSON.stringify(c)); } catch (e) {} }
    function loadActorImgs() {
        var cache = personImgCache();
        var queue = [];
        (card.actors || []).forEach(function (a, i) {
            a._idx = i;
            if (a.img || !a.purl) return;
            if (cache[a.purl]) { a.img = cache[a.purl]; applyActorImg(a, i); return; }
            queue.push(a);
        });
        queue = queue.slice(0, 10);
        (function step() {
            if (!queue.length || !inited) return;
            var a = queue.shift();
            getText(a.purl, { method: 'GET' }, function (html) {
                var url = '';
                try {
                    var d2 = new DOMParser().parseFromString(html, 'text/html');
                    var im = d2.querySelector('.b-person__cover img, .b-person__avatar img, .b-post__poster img, img[itemprop="image"]');
                    if (im) url = absUrl(im.getAttribute('src') || im.getAttribute('data-src') || '');
                    if (!url) {
                        var mo = html.match(/og:image["']\s+content=["']([^"']+)["']/i);
                        if (mo) url = absUrl(mo[1]);
                    }
                } catch (e) {}
                if (url) {
                    cache[a.purl] = url;
                    personImgSave(cache);
                    a.img = url;
                    applyActorImg(a, a._idx);
                }
                step();
            }, function () { step(); });
        })();
    }
    function loadFranchisePosters() {
        if (!card.franchise || !card.franchise.length) return;
        var cache = {};
        try { cache = JSON.parse(stGet('fr_posters', '')) || {}; } catch (e) { cache = {}; }
        function normKey(u) { return String(u || '').replace(/-latest\.html(?=$|\?)/, '.html'); }
        function applyPoster(f) {
            try {
                var ph = scroll.render().find('.rezka-frcard[data-furl="' + f.url + '"] .rezka-frcard__p');
                if (ph.length && !ph.find('img').length) ph.html('<img src="' + esc(f.poster) + '">');
            } catch (e) {}
        }
        function saveCache() { try { stSet('fr_posters', JSON.stringify(cache)); } catch (e) {} }
        var missing = [];
        card.franchise.forEach(function (f) {
            if (!f.url) return;
            if (cache[f.url]) { f.poster = cache[f.url]; applyPoster(f); return; }
            missing.push(f);
        });
        if (!missing.length) return;
        function searchPosters(list) {
            (function step() {
                if (!list.length || !inited) return;
                var f = list.shift();
                getText(searchRel(f.title, 1), { method: 'GET' }, function (html3) {
                    var items3 = parseList(html3);
                    var nt = norm(f.title);
                    var pick = null;
                    for (var i = 0; i < items3.length; i++) {
                        if (norm(items3[i].title) !== nt || !items3[i].poster) continue;
                        if (!pick) pick = items3[i];
                        if (f.year && items3[i].year && items3[i].year === f.year) { pick = items3[i]; break; }
                    }
                    if (pick) { f.poster = pick.poster; cache[f.url] = f.poster; applyPoster(f); saveCache(); }
                    setTimeout(step, 120);
                }, function () { setTimeout(step, 120); });
            })();
        }
        if (card.franchiseUrl) {
            getText(card.franchiseUrl, { method: 'GET' }, function (html2) {
                if (!inited) return;
                var mapP = {};
                parseList(html2).forEach(function (it) { mapP[normKey(it.url)] = it; });
                var still = [];
                missing.forEach(function (f) {
                    var src = mapP[normKey(f.url)];
                    if (src && src.poster) { f.poster = src.poster; cache[f.url] = src.poster; applyPoster(f); }
                    else still.push(f);
                });
                saveCache();
                if (still.length) searchPosters(still);
            }, function () { searchPosters(missing); });
        } else {
            searchPosters(missing);
        }
    }
    function hRow(title, items, builder, onEnter) {
        if (!items || !items.length) return;
        var box = $('<div class="rezka-rowbox"></div>');
        box.append(sectionTitle(title));
        var h = new Lampa.Scroll({ horizontal: true, mask: true, over: true, step: 300 });
        var line = $('<div class="rezka-line"></div>');
        items.forEach(function (it, i) {
            var el = builder(it, i);
            el.on('hover:focus', function () {
                setLast(el);
                h.update(el, true);
                var r = box[0].getBoundingClientRect();
                if (r.top < -10 || r.top > window.innerHeight - 140) scroll.update(box, false);
            });
            el.on('hover:enter', function () { onEnter(it); });
            line.append(el);
        });
        h.append(line);
        box.append(h.render());
        scroll.append(box);
    }
    function chipsHtml() {
        var c = [];
        if (card.year) c.push('<span class="rezka-chip">' + esc(card.year) + '</span>');
        if (card.country) c.push('<span class="rezka-chip">' + esc(card.country) + '</span>');
        if (card.quality) c.push('<span class="rezka-chip">' + esc(card.quality) + '</span>');
        if (card.duration) c.push('<span class="rezka-chip">' + esc(card.duration) + '</span>');
        if (card.age) c.push('<span class="rezka-chip age">' + esc(card.age) + '</span>');
        if (card.imdb) c.push('<span class="rezka-chip rate">IMDb ' + esc(card.imdb) + '</span>');
        if (card.kp) c.push('<span class="rezka-chip rate">KP ' + esc(card.kp) + '</span>');
        (card.genres || []).slice(0, 3).forEach(function (g) { c.push('<span class="rezka-chip">' + esc(g) + '</span>'); });
        return c.join('');
    }
    function render() {
        scroll.clear();
        if (!card) { scroll.append(sectionTitle('Загрузка…')); nav(); focusRestore(); return; }
        try { if (Lampa.Background && Lampa.Background.change) Lampa.Background.change(card.poster); } catch (e) {}
        scroll.append($('<div class="rezka-head">' +
            '<div class="rezka-head__poster">' + (card.poster ? '<img src="' + esc(card.poster) + '">' : '') + '</div>' +
            '<div class="rezka-head__info">' +
            '<div class="rezka-head__title">' + esc(card.title) + '</div>' +
            (card.origTitle ? '<div class="rezka-head__orig">' + esc(card.origTitle) + '</div>' : '') +
            '<div class="rezka-chips">' + chipsHtml() + '</div>' +
            '<div class="rezka-head__descr">' + esc(card.descr) + '</div>' +
            '</div></div>'));
        if (card._htmlFail) scroll.append($('<div class="rezka-note">HTML карточки не получен: ' + esc(snippet(card._htmlFail, 120)) + '</div>'));
        var btns = $('<div class="rezka-btns"></div>');
        var hist = histGet().filter(function (h) { return h.url === card.rel; })[0];
        var bPlay = btnEl(card.isSerial ? (lastEpId ? ('Смотреть S' + seasonId + ' E' + lastEpId) : (hist ? ('Продолжить S' + hist.season + ' E' + hist.episode) : 'Смотреть')) : 'Смотреть');
        bPlay.attr('data-fk', 'play');
        bPlay.on('hover:focus', function () { setLast(bPlay); scroll.update(bPlay, true); });
        bPlay.on('hover:enter', function () {
            ensureAuth(function () {
                if (!card.isSerial) { playMovie(); return; }
                loadEpisodes(function () {
                    var ep = null, i;
                    if (lastEpId) for (i = 0; i < episodes.length; i++) if (String(episodes[i].id) === String(lastEpId)) ep = episodes[i];
                    var target = object.resume || hist;
                    if (!ep && target) for (i = 0; i < episodes.length; i++) if (String(episodes[i].id) === String(target.episode)) ep = episodes[i];
                    if (!ep) ep = episodes[0];
                    if (ep) { lastEpId = String(ep.id); playEpisode(ep); } else Lampa.Noty.show('Rezka: нет серий');
                });
            });
        });
        btns.append(bPlay);
        if (card.translators.length) {
            var bV = btnEl('Озвучка: ' + curVoice().title);
            bV.attr('data-fk', 'voice');
            bV.on('hover:focus', function () { setLast(bV); scroll.update(bV, true); });
            bV.on('hover:enter', function () {
                Lampa.Select.show({
                    title: 'Озвучка',
                    items: card.translators.map(function (t) { return { title: t.title }; }),
                    onSelect: function (s) {
                        Lampa.Select.close();
                        for (var i = 0; i < card.translators.length; i++) if (card.translators[i].title === s.title) voiceIdx = i;
                        stSet('last_voice', s.title);
                        focusKey = 'voice';
                        needFocusRestore = true;
                        setTimeout(function () { loadEpisodes(function () { render(); }); }, 0);
                    },
                    onBack: function () { Lampa.Select.close(); Lampa.Controller.toggle('content'); }
                });
            });
            btns.append(bV);
        }
        if (card.seasons.length > 1) {
            var bS = btnEl('Сезон: ' + (seasonId || card.seasons[0].id));
            bS.attr('data-fk', 'season');
            bS.on('hover:focus', function () { setLast(bS); scroll.update(bS, true); });
            bS.on('hover:enter', function () {
                Lampa.Select.show({
                    title: 'Сезон',
                    items: card.seasons.map(function (s) { return { title: s.title, id: s.id }; }),
                    onSelect: function (s) {
                        Lampa.Select.close();
                        seasonId = s.id;
                        lastEpId = '';
                        focusKey = 'season';
                        needFocusRestore = true;
                        setTimeout(function () { loadEpisodes(function () { render(); }); }, 0);
                    },
                    onBack: function () { Lampa.Select.close(); Lampa.Controller.toggle('content'); }
                });
            });
            btns.append(bS);
        }
        if (card.isSerial) {
            var curEp = null;
            for (var ei = 0; ei < episodes.length; ei++) if (String(episodes[ei].id) === String(lastEpId)) curEp = episodes[ei];
            var bE = btnEl('Серия: ' + (curEp ? (curEp.title || ('№' + curEp.id)) : (episodes.length ? 'выбрать' : '—')));
            bE.attr('data-fk', 'episode');
            bE.on('hover:focus', function () { setLast(bE); scroll.update(bE, true); });
            bE.on('hover:enter', function () {
                if (!episodes.length) { Lampa.Noty.show('Rezka: серии не загрузились'); return; }
                Lampa.Select.show({
                    title: 'Серии' + (seasonId ? ' (' + seasonId + ' сезон)' : ''),
                    items: episodes.map(function (e) {
                        var m2 = baseMeta(); m2.episode = e.id;
                        var p = percentOf(m2);
                        return { title: (e.title || ('Серия ' + e.id)) + (p ? ' — ' + Math.round(p) + '%' : ''), id: e.id };
                    }),
                    onSelect: function (s) {
                        Lampa.Select.close();
                        lastEpId = String(s.id);
                        focusKey = 'episode';
                        needFocusRestore = true;
                        setTimeout(function () { render(); }, 0);
                    },
                    onBack: function () { Lampa.Select.close(); Lampa.Controller.toggle('content'); }
                });
            });
            btns.append(bE);
        }
        scroll.append(btns);
        (card.franchise || []).forEach(function (f) {
            if (f.current) {
                if (!f.url) f.url = card.rel;
                if (!f.poster && card.poster) f.poster = card.poster;
            }
        });
        hRow(card.franchiseTitle || 'Подборки', card.franchise, frCardEl, function (f) {
            if (!f.url || f.url === card.rel) return;
            Lampa.Activity.push({
                url: '', title: f.title, component: COMP_CARD,
                card_url: f.url, card_meta: { title: f.title, year: f.year, poster: f.poster }, page: 1
            });
        });
        hRow('В ролях', card.actors, actorEl, function (a) {
            if (a.purl) {
                Lampa.Activity.push({ url: '', title: a.name, component: COMP_LIST, person: a.purl, page: 1 });
            } else {
                Lampa.Activity.push({ url: '', title: a.name, component: COMP_LIST, search: a.name, page: 1 });
            }
        });
        hRow('Похожее', card.similar, function (it) { return cardEl(it, false); }, function (it) {
            Lampa.Activity.push({
                url: '', title: it.title || 'Rezka', component: COMP_CARD,
                card_url: it.url, card_meta: it, page: 1
            });
        });
        nav();
        focusRestore();
        loadActorImgs();
    }
    function afterCard() {
        pickVoice();
        var tgt = object.resume || histGet().filter(function (h) { return h.url === card.rel; })[0];
        seasonId = tgt && tgt.season ? String(tgt.season) : '';
        lastEpId = tgt && tgt.episode ? String(tgt.episode) : '';
        if (!card.poster) enrichPoster();
        loadFranchisePosters();
        if (card.isSerial) loadEpisodes(function () { if (inited) render(); });
        else if (inited) render();
    }
    function loadCardHtml() {
        fetchFromMirrors(card.rel, acceptCard, function (html, mHost) {
            if (!inited) return;
            var parsed = parseCardHtml(html, card.rel, mHost);
            card.contentId = card.contentId || parsed.contentId;
            card.title = parsed.title || card.title;
            card.poster = parsed.poster || card.poster;
            card.descr = parsed.descr || card.descr;
            card.translators = parsed.translators;
            card.seasons = parsed.seasons;
            card.info = parsed.info || {};
            card.origTitle = parsed.origTitle || '';
            card.year = parsed.year || card.year;
            card.country = parsed.country || '';
            card.quality = parsed.quality || '';
            card.age = parsed.age || '';
            card.duration = parsed.duration || '';
            card.imdb = parsed.imdb || '';
            card.kp = parsed.kp || '';
            card.genres = parsed.genres || [];
            card.actors = parsed.actors || [];
            card.similar = parsed.similar || [];
            card.franchiseTitle = parsed.franchiseTitle || '';
            card.franchise = parsed.franchise || [];
            card.franchiseUrl = parsed.franchiseUrl || '';
            card.defaultTranslatorId = parsed.defaultTranslatorId || '';
            card.user_hash = parsed.user_hash || '';
            card._html = html;
            card._mirror = mHost;
            afterCard();
        }, function (err) {
            if (!inited) return;
            card._htmlFail = err.message;
            card.translators = [{ id: '', title: 'По умолчанию', camrip: '0', ads: '0', director: '0' }];
            afterCard();
        });
    }
    this.create = function () {
        inited = true;
        card = initialCard();
        render();
        if (card.rel) loadCardHtml();
        else { card.title = meta.title || 'Нет URL'; render(); }
        return this.render();
    };
    this.destroy = function () { inited = false; scroll.destroy(); };
    this.render = function () { return wrap; };
    this.empty = function () {};
    makeController(this, scroll, function () { return last; });
}

function addFullButton(render, movie) {
    try {
        if (!render || !render.length) return;
        var cont = render.find('.buttons--container');
        if (!cont.length || cont.find('.rezka--fullbtn').length) return;
        var btn = $('<div class="view--rezka selector"><div class="full-start__button__ico"></div> HDREZKA</div>');
        btn.on('hover:enter', function () {
            Lampa.Loading.start(function () { Lampa.Loading.stop(); Lampa.Controller.toggle('content'); });
            findOnRezka(movie, function (it) {
                Lampa.Loading.stop();
                Lampa.Activity.push({ url: '', title: it.title || movie.title || 'Rezka', component: COMP_CARD, card_url: it.url, card_meta: it, page: 1 });
            }, function (e, silent) {
                Lampa.Loading.stop();
                if (!silent) Lampa.Noty.show('Rezka: ' + ((e && e.message) || 'не найдено'), { style: 'error' });
                Lampa.Controller.toggle('content');
            });
        });
        var anchor = render.find('.view--torrent');
        if (anchor.length) anchor.after(btn); else cont.append(btn);
    } catch (e) {}
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

function registerSearchSource() {
    if (!Lampa.Search || !Lampa.Search.addSource || window.rezka_search_added) return;
    window.rezka_search_added = true;
    Lampa.Search.addSource({
        title: 'HDREZKA',
        params: { start_typing: false, abort: false },
        search: function (params, oncomplite) {
            var query = (params && params.query) || '';
            if (query.length < 3) { oncomplite([]); return; }
            getText(searchRel(query, 1), { method: 'GET' }, function (html) {
                var cards = parseList(html).slice(0, 20).map(function (it) {
                    return {
                        id: 'rezka_' + Lampa.Utils.hash(it.url),
                        title: it.title,
                        original_title: it.title,
                        release_date: it.year || '0000',
                        overview: it.info || '',
                        img: it.poster,
                        media_type: it.type === 'serial' ? 'tv' : 'movie',
                        rezka_url: it.url,
                        rezka_type: it.type,
                        source: 'rezka'
                    };
                });
                oncomplite(cards.length ? [{ title: 'HDREZKA', results: cards }] : []);
            }, function () { oncomplite([]); });
        },
        onCancel: function () {},
        onMore: function (a, close) { if (typeof close === 'function') close(); },
        onSelect: function (a, close) {
            try { if (typeof close === 'function') close(); } catch (e) {}
            var el = (a && (a.element || a.item || a.card)) || a || {};
            var url = el.rezka_url || '';
            if (!url) return;
            Lampa.Activity.push({
                url: '', title: el.title || 'Rezka', component: COMP_CARD, card_url: url,
                card_meta: { title: el.title, poster: el.img, year: (el.release_date || '').slice(0, 4), type: el.rezka_type, info: el.overview },
                page: 1
            });
        }
    });
}

function textParam(name, title, descr, opts) {
    opts = opts || {};
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: name, type: 'input', values: '', default: '', placeholder: opts.mask ? '' : '— не задано —' },
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
        icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
    });
    textParam('rezka_proxy', 'Прокси (Worker / локальный)', 'Адрес прокси: http://IP-ПК:8787 или https://xxx.workers.dev', { set: function (v) { stSet('proxy', v); } });
    textParam('rezka_mirror', 'Основное зеркало', 'Зеркало авторизованных разделов: https://rezka.fi', { set: function (v) { stSet('mirror', v || 'https://rezka.fi'); } });
    textParam('rezka_mirrors', 'Каскад зеркал для карточек', 'Через запятую: https://rezka.fi,https://rezka.ag,https://hdrezka.ag', { set: function (v) { stSet('mirrors', v); } });
    textParam('rezka_email', 'Email / логин rezka', 'От вашего аккаунта rezka', { set: function (v) { stSet('email', v); } });
    textParam('rezka_password_ui', 'Пароль rezka', 'Хранится локально; редактор открывается пустым',
        { mask: true, get: function () { return stGet('password', ''); }, set: function (v) { stSet('password', v); } });
    textParam('rezka_cookies_ui', 'Cookies вручную (для основного зеркала)',
        'ПОЛНАЯ строка cookie из браузера; пишется в jar зеркала rezka.fi',
        {
            mask: true,
            get: function () { return jarGet(hostOf(mirror())); },
            set: function (v) { jarSetHost(hostOf(mirror()), v); }
        });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_transport', type: 'select', values: { auto: 'Авто', proxy: 'Прокси', direct: 'Напрямую' }, default: 'auto' },
        field: { name: 'Режим запросов', description: 'Авто = прокси, если адрес задан' },
        onChange: function (v) { stSet('transport', v); }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_quality_sel', type: 'select', values: { auto: 'Авто (максимальное)', '1080p': '1080p', '720p': '720p', '480p': '480p', '360p': '360p' }, default: 'auto' },
        field: { name: 'Стартовое качество', description: 'С какого качества начинать; метка видна в заголовке плеера' },
        onChange: function (v) { stSet('quality', v); }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_login_btn', type: 'button', default: '' },
        field: { name: 'Войти на rezka', description: 'Пробует вход по каскаду зеркал' },
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
        param: { name: 'rezka_diag_btn', type: 'button', default: '' },
        field: { name: 'Диагностика', description: 'Показывает jars по хостам и транспорт' },
        onChange: function () {
            var o = jarStore(), parts = [];
            for (var k in o) parts.push(k + ':' + (o[k] || '').length);
            Lampa.Noty.show('транспорт ' + transportMode() + ', jars: ' + (parts.join(', ') || 'пусто') +
                ', auth fi: ' + (jarHasAuth() ? 'да' : 'нет'));
        }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_test_btn', type: 'button', default: '' },
        field: { name: 'Тест соединения', description: 'Запрос главной rezka через текущий транспорт' },
        onChange: function () {
            Lampa.Noty.show('Rezka: проверка… (' + transportMode() + ')');
            getText('/', { method: 'GET' }, function (text, res) {
                var okHtml = /b-content__inline|translators-list|b-post/.test(text);
                Lampa.Noty.show(okHtml ? ('Rezka: OK, длина ' + text.length) : ('Rezka: заглушка или ошибка (' + (res.status || '?') + ')'), okHtml ? {} : { style: 'error' });
            }, function (e) {
                Lampa.Noty.show('Rezka: ' + e.message, { style: 'error' });
            });
        }
    });
    Lampa.SettingsApi.addParam({
        component: 'rezka',
        param: { name: 'rezka_sync', type: 'switch', default: false },
        field: { name: 'Синхронизировать просмотры с rezka', description: 'Отправлять процент просмотра на сервер' },
        onChange: function (v) { stSet('sync', v ? 'true' : 'false'); }
    });
}

function addCss() {
    Lampa.Template.add('rezka_css', '<style>' +
        '.rezka-page{height:100%}' +
        '.rezka-page>.scroll{height:100%}' +
        '.rezka-section{font-size:1.3em;color:#9a9a9a;margin:1.2em 0 .8em}' +
        '.rezka-note{color:#888;padding:.6em 0}' +
        '.rezka-grid{display:flex;flex-wrap:wrap;align-items:flex-start}' +
        '.rezka-rows{display:flex;flex-direction:column;width:100%}' +
        '.rezka-rowbox{margin-bottom:1.2em}' +
        '.rezka-line{display:flex;flex-wrap:nowrap;width:max-content;align-items:flex-start}' +
        '.rezka-line .rezka-card,.rezka-line .rezka-actor,.rezka-line .rezka-frcard{flex-shrink:0}' +
        '.rezka-card{width:12em;margin:0 1.4em 1.8em 0}' +
        '.rezka-card__poster{width:12em;height:17.5em;background:#1c1c1c;border-radius:.6em;overflow:hidden;position:relative}' +
        '.rezka-card__poster img{width:100%;height:100%;object-fit:cover}' +
        '.rezka-card.focus .rezka-card__poster{box-shadow:0 0 0 .25em #fff}' +
        '.rezka-card__title{font-size:1em;margin-top:.5em;min-height:2.2em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}' +
        '.rezka-card__meta,.rezka-card__ep{font-size:.85em;color:#8a8a8a;min-height:1.2em}' +
        '.rezka-bar{position:absolute;left:0;right:0;bottom:0;height:.35em;background:#00000088}' +
        '.rezka-bar>div{height:100%;background:#5c86c5}' +
        '.rezka-btns{display:flex;flex-wrap:wrap;align-items:flex-start;margin:.4em 0 1em}' +
        '.rezka-btn{padding:.8em 1.4em;background:#2a2a2a;border-radius:.6em;margin:0 .8em .8em 0}' +
        '.rezka-btn.focus{background:#3d3d3d;box-shadow:0 0 0 .2em #fff}' +
        '.rezka-head{display:flex;padding:1em 0 1.4em}' +
        '.rezka-head__poster{width:14em;height:20em;border-radius:.7em;overflow:hidden;background:#1c1c1c;margin-right:2em;flex-shrink:0}' +
        '.rezka-head__poster img{width:100%;height:100%;object-fit:cover}' +
        '.rezka-head__info{flex:1;min-width:0}' +
        '.rezka-head__title{font-size:2em;margin-bottom:.2em}' +
        '.rezka-head__orig{color:#9a9a9a;margin:0 0 .7em;font-size:1.05em}' +
        '.rezka-head__descr{color:#b5b5b5;line-height:1.5;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}' +
        '.rezka-chips{display:flex;flex-wrap:wrap;margin:.2em 0 .9em}' +
        '.rezka-chip{padding:.35em .85em;background:#ffffff1f;border-radius:.5em;margin:0 .5em .5em 0;font-size:.9em;color:#e6e6e6}' +
        '.rezka-chip.rate{background:#5c86c5;color:#fff}' +
        '.rezka-chip.age{background:#c62828;color:#fff}' +
        '.rezka-actor{display:flex;align-items:center;width:16em;margin:0 1.2em 1.2em 0;padding:.6em .8em;background:#232323;border-radius:1em;box-sizing:border-box}' +
        '.rezka-actor__ph{width:5.2em;height:6.9em;border-radius:1em;overflow:hidden;background:#1c1c1c;flex-shrink:0;box-shadow:inset 0 0 0 .1em #ffffff14}' +
        '.rezka-actor__ph img{width:100%;height:100%;object-fit:cover;object-position:50% 18%}' +
        '.rezka-actor__ini{display:flex;width:100%;height:100%;align-items:center;justify-content:center;font-size:1.8em;color:#8a8a8a}' +
        '.rezka-actor__tx{margin-left:.9em;min-width:0}' +
        '.rezka-actor__n{font-size:.95em;color:#e8e8e8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.rezka-actor__r{font-size:.8em;color:#8a8a8a;margin-top:.3em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.rezka-actor.focus{background:#f2f2f2;box-shadow:0 0 0 .18em #ffffff55}' +
        '.rezka-actor.focus .rezka-actor__n{color:#141414}' +
        '.rezka-actor.focus .rezka-actor__r{color:#5a5a5a}' +
        '.rezka-frcard__ph{display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:#6f6f6f;font-size:1.1em}' +
        '.rezka-frcard.cur{box-shadow:inset 0 0 0 .12em #5c86c5}' +
        '.rezka-frcard{width:9em;margin:0 1.2em 1.2em 0;background:#232323;border-radius:.7em;padding:.7em;box-sizing:border-box}' +
        '.rezka-frcard.focus{box-shadow:0 0 0 .2em #fff}' +
        '.rezka-frcard__p{width:7.6em;height:11em;border-radius:.5em;overflow:hidden;background:#1c1c1c;margin-bottom:.5em}' +
        '.rezka-frcard__p img{width:100%;height:100%;object-fit:cover}' +
        '.rezka-frcard__t{min-height:2.4em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:.9em}' +
        '.rezka-frcard__m{display:flex;justify-content:space-between;align-items:center;margin-top:.5em;color:#8a8a8a;font-size:.8em}' +
        '.rezka-frcard__r{padding:.1em .55em;border-radius:.35em;background:#5a5a5a;color:#fff}' +
        '.rezka-frcard__r.good{background:#2e7d32}' +
        '.rezka-frcard__r.bad{background:#c62828}' +
        '.rezka-cont{display:flex;align-items:center;width:100%;padding:.8em 1.2em;background:#232323;border-radius:.6em;margin-bottom:.5em;box-sizing:border-box}' +
        '.rezka-cont.focus{box-shadow:0 0 0 .2em #fff}' +
        '.rezka-cont--head{background:transparent;color:#9a9a9a;padding:.4em 1.2em;margin-bottom:.2em}' +
        '.rezka-cont__date{width:7em;flex-shrink:0;color:#8a8a8a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.rezka-cont__title{flex:1;min-width:0;margin:0 1.2em;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.rezka-cont__info{width:16em;flex-shrink:0;text-align:right;color:#8a8a8a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.rezka-cont--head .rezka-cont__title,.rezka-cont--head .rezka-cont__info{color:#9a9a9a}' +
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
            var btn = $('<li class="menu__item selector rezka-menu-item"><div class="menu__ico"><svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg></div><div class="menu__text">HDREZKA</div></li>');
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
    try {
        if (Lampa.Select && typeof Lampa.Select.show === 'function' && !Lampa.Select.__rezkaWrapped) {
            var origShow = Lampa.Select.show.bind(Lampa.Select);
            Lampa.Select.show = function (params) {
                if (!params || typeof params !== 'object') return origShow(params);
                var busy = false;
                function wrap(fn) {
                    if (typeof fn !== 'function') return fn;
                    return function () {
                        if (busy) return undefined;
                        busy = true;
                        try { return fn.apply(this, arguments); }
                        finally { setTimeout(function () { busy = false; }, 0); }
                    };
                }
                params.onSelect = wrap(params.onSelect);
                params.onBack = wrap(params.onBack);
                return origShow(params);
            };
            Lampa.Select.__rezkaWrapped = true;
        }
    } catch (e) {}
    addCss();
    Lampa.Component.add(COMP_MAIN, RezkaMain);
    Lampa.Component.add(COMP_LIST, RezkaList);
    Lampa.Component.add(COMP_CARD, RezkaCard);
    Lampa.Manifest.plugins = {
        type: 'video',
        version: '4.16.2',
        name: 'HDREZKA',
        description: 'Фильмы и сериалы с rezka: карточка в стиле Lampa, франшизы, актёры, качества',
        component: COMP_MAIN,
        onContextMenu: function () { return { title: 'Смотреть на HDREZKA' }; },
        onContextLauch: function (card) {
            Lampa.Loading.start(function () { Lampa.Loading.stop(); Lampa.Controller.toggle('content'); });
            findOnRezka(card, function (it) {
                Lampa.Loading.stop();
                Lampa.Activity.push({ url: '', title: it.title || card.title, component: COMP_CARD, card_url: it.url, card_meta: it, page: 1 });
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
