/**
HDREZKA for Lampa/Luxo — v4.1.0
v4 + horizontal feed rows with right-scroll pagination (onEnd + page button),
+ poster enrichment for /continue/ items (quick title search),
mirror cascade + instant meta + scroll fixes kept. Worker: v9.
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
var parts = rel.split('?');
var base = parts[0].replace(/\/+$/, '');
return base + '/page/' + page + '/' + (parts[1] ? '?' + parts[1] : '');
}
function ajaxRel(path) { return path + '?t=' + Date.now(); }
function hasNextPage(html, next) { return String(html).indexOf('/page/' + next + '/') >= 0; }
function isBadHtml(html) {
var t = String(html || '');
if (!t) return true;
if (/^\s*redirect/i.test(t)) return true;
if (t.length < 500 && !/<html/i.test(t)) return true;
if (/<title[^>]*>\s*(ВХОД|Вход|Login)/i.test(t) && t.indexOf('post_id') < 0 && t.indexOf('b-content__inline') < 0) return true;
return false;
}
function acceptCard(html) {
return !isBadHtml(html) && /id="post_id"|translators-list|data-translator_id|b-post__|simple-seasons/i.test(html);
}

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
var base = options.mirror || mirror();
var url, headers = {};
if (mode === 'proxy') {
url = proxyUrl() + '?r=' + encodeURIComponent(rel) + '&m=' + encodeURIComponent(base);
headers['X-Rezka-Cookie'] = jarGet();
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

// ==================== ПАРСЕРЫ ====================
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
function htmlTitle(t) { var m = /<title[^>]*>([^<]{0,80})/i.exec(t || ''); return m ? m[1].trim() : ''; }
function parseCardHtml(html, rel, base) {
var doc = new DOMParser().parseFromString(html, 'text/html');
var m = rel.match(/\/(\d+)-/);
var pid = doc.querySelector('input#post_id');
var title = textOf(doc.querySelector('h1')) ||
textOf(doc.querySelector('.b-post__title')) ||
(doc.querySelector('meta[property="og:title"]') ? doc.querySelector('meta[property="og:title"]').getAttribute('content') || '' : '') ||
cleanTitle((htmlTitle(html) || '').replace(/[-|].*$/, ''));
if (!title) {
var mh = html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i);
if (mh) title = cleanTitle(stripTags(mh[1]));
}
var posterEl = doc.querySelector('.b-post__poster img') || doc.querySelector('img.b-post__image') ||
doc.querySelector('meta[property="og:image"]') || doc.querySelector('link[rel="image_src"]');
var poster = posterEl ? absUrl(posterEl.getAttribute('src') || posterEl.getAttribute('content') || posterEl.getAttribute('href') || '', base) : '';
var translators = [], seen = {};
nodeList('ul#translators-list li[data-translator_id], ul#translator-list li[data-translator_id], li[data-translator_id]', doc)
.forEach(function (li) {
var id = li.getAttribute('data-translator_id'), t = textOf(li);
if (id && t && !seen[id]) { seen[id] = 1; translators.push({ id: id, title: t }); }
});
if (!translators.length) {
var re = /data-translator_id=["']?(\d+)["']?[^>]*>\s*([^<]{1,60})</g, mm;
while ((mm = re.exec(html)) !== null) {
if (!seen[mm[1]] && cleanTitle(mm[2])) { seen[mm[1]] = 1; translators.push({ id: mm[1], title: cleanTitle(mm[2]) }); }
}
}
var seasons = nodeList('ul#simple-seasons-tabs li[data-season], li.b-simple_season__item[data-tab_id], li[data-season]', doc).map(function (li) {
return { id: li.getAttribute('data-season') || li.getAttribute('data-tab_id'), title: textOf(li) };
});
if (!seasons.length) {
var rs = /data-season=["']?(\d+)["']?/g, ms, uniq = {};
while ((ms = rs.exec(html)) !== null) if (!uniq[ms[1]]) { uniq[ms[1]] = 1; seasons.push({ id: ms[1], title: ms[1] + ' сезон' }); }
seasons.sort(function (a, b) { return a.id - b.id; });
}
var contentId = pid ? pid.getAttribute('value') : (m ? m[1] : null);
return {
rel: rel, contentId: contentId, title: title, poster: poster,
descr: textOf(doc.querySelector('.b-post__description')),
translators: translators, seasons: seasons,
isSerial: rel.indexOf('/series/') >= 0
};
}
function scrapeEpisodesFromHtml(html) {
var eps = {};
var re = /<li[^>]*data-episode_id=["']?(\d+)["']?[^>]*>([\s\S]*?<\/li>)/g, m;
while ((m = re.exec(html)) !== null) {
var tag = m[0].slice(0, m[0].indexOf('>') + 1);
var sid = (tag.match(/data-season_id=["']?(\d+)["']?/) || [])[1] || '1';
if (!eps[sid]) eps[sid] = [];
eps[sid].push({ id: m[1], title: cleanTitle(stripTags(m[2])) || ('Серия ' + m[1]) });
}
return eps;
}

// ==================== REZKA API ====================
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
if (jarHasAuth()) { cb(true, m); return; }
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
getJsonAny(ajaxRel('ajax/get_cdn_series/'), { id: card.contentId, translator_id: voiceId || '', action: 'get_episodes' }, card.rel, card._mirror, function (d) {
var sdoc = new DOMParser().parseFromString(d.seasons || '<i></i>', 'text/html');
var edoc = new DOMParser().parseFromString(d.episodes || '<i></i>', 'text/html');
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
// 2026: rezka отдаёт прямой CORS-HLS manifest (voidslam.org -> 302 -> emerald.*)
if (/^https?:/.test(url) && /\.m3u8(?=$|\?)/.test(url)) return { 'AUTO': url };
if (/^https?:/.test(url)) return { '1080p': url };
var list = decodeRezkaUrl(url), map = {};
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
function apiStream(card, voiceId, season, episode, cb, fail) {
var form = { id: card.contentId, translator_id: voiceId || '', action: 'get_stream', favs: '0' };
if (card.isSerial && season && episode) { form.season = season; form.episode = episode; }
getJsonAny(ajaxRel('ajax/get_cdn_series/'), form, card.rel, card._mirror, function (data) {
if (!data || !data.success || !data.url) {
var q0 = streamFromHtml(card);
if (q0 && !card.isSerial) { cb(q0); return; }
fail(new Error((data && data.message) || 'сервер не вернул ссылку'));
return;
}
cb(buildQuality(data.url));
}, function (e) {
var q0 = streamFromHtml(card);
if (q0 && !card.isSerial) { cb(q0); return; }
fail(e);
});
}

// ==================== ПОДБОР КАРТОЧКИ ====================
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

// ==================== NAV / SCROLL ====================
function pageWrap(scroll) {
var w = $('<div class="rezka-page layer--wheight"></div>');
w.append(scroll.render());
return w;
}
function refreshNav(scroll, compName, getLast, interacted) {
try {
var act = Lampa.Activity.active();
if (!act || act.component !== compName) return;
Lampa.Controller.collectionSet(scroll.render());
if (!interacted) Lampa.Controller.collectionFocus((getLast && getLast()) || false, scroll.render());
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
else { if (i > 0) { Lampa.Controller.collectionFocus(items.eq(i - 1), scroll.render()); follow(); } else if (i === -1 && items.length) { Lampa.Controller.collectionFocus(items.eq(0), scroll.render()); follow(); } }
} catch (e) {}
}
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
up: function () { if (Navigator.canmove('up')) { Navigator.move('up'); follow(); } else manual('up'); },
down: function () { if (Navigator.canmove('down')) { Navigator.move('down'); follow(); } else manual('down'); },
back: function () { Lampa.Activity.backward(); }
});
Lampa.Controller.toggle('content');
};
comp.stop = function () {};
}

// ==================== UI ====================
function sectionTitle(t) { return $('<div class="rezka-section">' + esc(t) + '</div>'); }
function cardEl(item, withProgress) {
var metaLine = item.info || (item.year ? item.year : '');
var el = $('<div class="rezka-card selector">' +
'<div class="rezka-card__poster">' + (item.poster ? '<img src="' + esc(item.poster) + '" loading="lazy">' : '') + '</div>' +
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
return $('<div class="rezka-cont selector">' +
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

// ==================== ЭКРАН: ГЛАВНЫЙ ====================
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
var last = false, inited = false, interacted = false;
function setLast(el) { last = el; interacted = true; }
function nav() { refreshNav(scroll, COMP_MAIN, function () { return last; }, interacted); }
function openSearch() {
if (Lampa.Search && Lampa.Search.open) {
Lampa.Search.open({ onBack: function () { Lampa.Controller.toggle('content'); } });
return;
}
Lampa.Activity.push({ url: '', title: 'Поиск', component: COMP_LIST, search: '', page: 1 });
}
// горизонтальная лента с догрузкой вправо (onEnd скролла + кнопка-страница)
function makeRowH(rel, title) {
var box = $('<div class="rezka-rowbox"></div>');
box.append(sectionTitle(title));
var h = new Lampa.Scroll({ horizontal: true, mask: true, over: true, step: 400 });
var line = $('<div class="rezka-line"></div>');
line.append('<div class="rezka-note">Загрузка…</div>');
h.append(line);
box.append(h.render());
var page = 1, busy = false, doneAll = false;
function addItems(items) {
items.forEach(function (it) {
var el = cardEl(it, false);
el.on('hover:focus', function () {
setLast(el);
h.update(el, true);
scroll.update(box, true);
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
addItems(items);
if (!hasNextPage(html, page + 1)) doneAll = true;
else {
page++;
var more = btnEl('Ещё → стр. ' + page);
more.on('hover:focus', function () { setLast(more); h.update(more, true); scroll.update(box, true); });
more.on('hover:enter', function () { more.remove(); loadMore(); });
line.append(more);
}
nav();
}, function () {
busy = false;
if (inited) line.find('.rezka-note').text('Ошибка загрузки ленты');
});
}
h.onEnd = function () { line.find('.rezka-btn').remove(); loadMore(); };
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
var cg = $('<div class="rezka-rows"></div>');
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
HOME_ROWS.forEach(function (row) { scroll.append(makeRowH(row.rel, row.title)); });
if (!jarHasAuth()) {
scroll.append($('<div class="rezka-note">Нет авторизации: Настройки → HDREZKA → «Cookies вручную» или «Войти на rezka».</div>'));
}
nav();
}
this.create = function () { inited = true; build(); return this.render(); };
this.destroy = function () { inited = false; scroll.destroy(); };
this.render = function () { return wrap; };
this.empty = function () {};
makeController(this, scroll, function () { return last; });
}

// ==================== ЭКРАН: СПИСОК ====================
function RezkaList(object) {
var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
var wrap = pageWrap(scroll);
var last = false, page = object.page || 1, inited = false, interacted = false;
function setLast(el) { last = el; interacted = true; }
function nav() { refreshNav(scroll, COMP_LIST, function () { return last; }, interacted); }
function rel() {
if (object.search) return searchRel(object.search, page);
var base = object.section || 'films/';
return page > 1 ? base + 'page/' + page + '/' : base;
}
function load() {
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
next.on('hover:enter', function () { page++; load(); });
scroll.append(next);
}
nav();
}, function (e) {
if (!inited) return;
scroll.clear();
scroll.append(sectionTitle('Ошибка: ' + (e && e.message ? e.message : 'загрузки')));
nav();
});
}
this.create = function () { inited = true; load(); return this.render(); };
this.destroy = function () { inited = false; scroll.destroy(); };
this.render = function () { return wrap; };
this.empty = function () {};
makeController(this, scroll, function () { return last; });
}

// ==================== ЭКРАН: КАРТОЧКА ====================
function RezkaCard(object) {
var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
var wrap = pageWrap(scroll);
var last = false, inited = false, interacted = false;
var card = null, voiceIdx = 0, seasonId = '', episodes = [];
var meta = object.card_meta || {};
function setLast(el) { last = el; interacted = true; }
function nav() { refreshNav(scroll, COMP_CARD, function () { return last; }, interacted); }
function initialCard() {
var rel = object.card_url || meta.url || '';
var m = rel.match(/\/(\d+)-/);
return {
rel: rel, contentId: m ? m[1] : null,
title: meta.title || 'Загрузка…', poster: meta.poster || '',
descr: meta.info || '', translators: [], seasons: [],
isSerial: meta.type === 'serial' || rel.indexOf('/series/') >= 0,
_html: '', _mirror: ''
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
// добор постера через быстрый поиск (для «Досмотреть», где в таблице сайта постеров нет)
function enrichPoster() {
if (card.poster || !card.title || card.title === 'Загрузка…') return;
getText(searchRel(card.title, 1), { method: 'GET' }, function (html) {
if (!inited) return;
var items = parseList(html), nt = norm(card.title), i;
for (i = 0; i < items.length; i++) {
if (norm(items[i].title) === nt && items[i].url === card.rel) { card.poster = items[i].poster; if (!card.descr || card.descr === (meta.info || '')) card.descr = items[i].info; break; }
}
if (!card.poster) for (i = 0; i < items.length; i++) if (norm(items[i].title) === nt) { card.poster = items[i].poster; break; }
render();
}, function () {});
}
function render() {
scroll.clear();
if (!card) { scroll.append(sectionTitle('Загрузка…')); nav(); return; }
try { if (Lampa.Background && Lampa.Background.change) Lampa.Background.change(card.poster); } catch (e) {}
scroll.append($('<div class="rezka-head">' +
'<div class="rezka-head__poster">' + (card.poster ? '<img src="' + esc(card.poster) + '">' : '') + '</div>' +
'<div class="rezka-head__info"><div class="rezka-head__title">' + esc(card.title) + '</div>' +
'<div class="rezka-head__descr">' + esc(card.descr) + '</div></div></div>'));
if (card._htmlFail) scroll.append($('<div class="rezka-note">HTML карточки не получен: ' + esc(snippet(card._htmlFail, 120)) + '</div>'));
var btns = $('<div class="rezka-btns"></div>');
var hist = histGet().filter(function (h) { return h.url === card.rel; })[0];
var bPlay = btnEl(card.isSerial ? (hist ? ('Продолжить S' + hist.season + ' E' + hist.episode) : 'Смотреть') : 'Смотреть');
bPlay.on('hover:focus', function () { setLast(bPlay); scroll.update(bPlay, true); });
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
bV.on('hover:focus', function () { setLast(bV); scroll.update(bV, true); });
bV.on('hover:enter', function () {
Lampa.Select.show({
title: 'Озвучка',
items: card.translators.map(function (t) { return { title: t.title }; }),
onSelect: function (s) {
Lampa.Select.close();
for (var i = 0; i < card.translators.length; i++) if (card.translators[i].title === s.title) voiceIdx = i;
stSet('last_voice', s.title);
loadEpisodes(function () { render(); Lampa.Controller.toggle('content'); });
},
onBack: function () { Lampa.Controller.toggle('content'); }
});
});
btns.append(bV);
}
if (card.seasons.length > 1) {
var bS = btnEl('Сезон: ' + (seasonId || card.seasons[0].id));
bS.on('hover:focus', function () { setLast(bS); scroll.update(bS, true); });
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
if (!episodes.length) { scroll.append($('<div class="rezka-note">Серии не загрузились</div>')); nav(); return; }
episodes.forEach(function (ep) {
var meta2 = baseMeta(); meta2.episode = ep.id;
var p = percentOf(meta2);
var row = $('<div class="rezka-ep selector">' +
'<div class="rezka-ep__num">' + esc(ep.title || ('Серия ' + ep.id)) + '</div>' +
'<div class="rezka-ep__bar"><div style="width:' + p + '%"></div></div>' +
'<div class="rezka-ep__pct">' + (p ? Math.round(p) + '%' : '') + '</div></div>');
row.on('hover:focus', function () { setLast(row); scroll.update(row, true); });
row.on('hover:enter', function () { ensureAuth(function () { playEpisode(ep); }); });
row.on('hover:long', function () {
Lampa.Select.show({
title: ep.title,
items: [{ title: p >= 90 ? 'Отметить как непросмотренную' : 'Отметить как просмотренную' }],
onSelect: function () {
Lampa.Select.close();
try { Lampa.Timeline.update({ hash: hashFor(meta2), percent: p >= 90 ? 0 : 100, time: 0, duration: 0 }); } catch (e) {}
render();
Lampa.Controller.toggle('content');
},
onBack: function () { Lampa.Controller.toggle('content'); }
});
});
scroll.append(row);
});
}
nav();
}
function afterCard() {
pickVoice();
seasonId = (object.resume && object.resume.season) ? String(object.resume.season) : '';
if (!card.poster) enrichPoster();
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
card._html = html;
card._mirror = mHost;
afterCard();
}, function (err) {
if (!inited) return;
card._htmlFail = err.message;
card.translators = [{ id: '', title: 'По умолчанию' }];
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

// ==================== КНОПКА В КАРТОЧКЕ LAMPA ====================
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

// ==================== ПОИСК ====================
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

// ==================== НАСТРОЙКИ ====================
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
icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 6.5 6 3.5-6 3.5v-7z"/></svg>'
});
textParam('rezka_proxy', 'Прокси (Worker)', 'Адрес вашего Cloudflare Worker', { set: function (v) { stSet('proxy', v); } });
textParam('rezka_mirror', 'Основное зеркало', 'Зеркало для авторизованных разделов (/continue/, вход): https://rezka.fi', { set: function (v) { stSet('mirror', v || 'https://rezka.fi'); } });
textParam('rezka_mirrors', 'Каскад зеркал для карточек', 'Через запятую: https://rezka.fi,https://rezka.ag,https://hdrezka.ag', { set: function (v) { stSet('mirrors', v); } });
textParam('rezka_email', 'Email / логин rezka', 'От вашего аккаунта rezka', { set: function (v) { stSet('email', v); } });
textParam('rezka_password_ui', 'Пароль rezka', 'Хранится локально; редактор открывается пустым',
{ mask: true, get: function () { return stGet('password', ''); }, set: function (v) { stSet('password', v); } });
textParam('rezka_cookies_ui', 'Cookies вручную (необязательно)',
'ПОЛНАЯ строка cookie из браузера (для основного зеркала)',
{ mask: true, get: function () { return stGet('cookies', ''); }, set: function (v) { stSet('cookies', v); } });
Lampa.SettingsApi.addParam({
component: 'rezka',
param: { name: 'rezka_transport', type: 'select', values: { auto: 'Авто', proxy: 'Прокси (Worker)', direct: 'Напрямую' }, default: 'auto' },
field: { name: 'Режим запросов', description: 'Авто = прокси, если адрес worker’а задан' },
onChange: function (v) { stSet('transport', v); }
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
param: { name: 'rezka_test_btn', type: 'button', default: '' },
field: { name: 'Тест соединения', description: 'Запрос главной rezka через текущий транспорт' },
onChange: function () {
Lampa.Noty.show('Rezka: проверка… (' + transportMode() + ')');
getText('/', { method: 'GET' }, function (text, res) {
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
'.rezka-page{height:100%}' +
'.rezka-page>.scroll{height:100%}' +
'.rezka-section{font-size:1.3em;color:#9a9a9a;margin:1.2em 0 .8em}' +
'.rezka-note{color:#888;padding:.6em 0}' +
'.rezka-grid{display:flex;flex-wrap:wrap}' +
'.rezka-rows{display:flex;flex-direction:column;width:100%}' +
'.rezka-rowbox{margin-bottom:1.4em}' +
'.rezka-line{display:flex;flex-wrap:nowrap;width:max-content;align-items:flex-start}' +
'.rezka-line .rezka-card{flex-shrink:0}' +
'.rezka-line .rezka-btn{margin-top:3em}' +
'.rezka-card{width:9.5em;margin:0 1.2em 1.6em 0}' +
'.rezka-card__poster{width:9.5em;height:14em;background:#1c1c1c;border-radius:.6em;overflow:hidden;position:relative}' +
'.rezka-card__poster img{width:100%;height:100%;object-fit:cover}' +
'.rezka-card.focus .rezka-card__poster{box-shadow:0 0 0 .25em #fff}' +
'.rezka-card__title{font-size:.95em;margin-top:.5em;min-height:2.2em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}' +
'.rezka-card__meta,.rezka-card__ep{font-size:.8em;color:#8a8a8a;min-height:1.2em}' +
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
'.rezka-ep__num{width:12em}' +
'.rezka-ep__info{flex:1;color:#8a8a8a}' +
'.rezka-ep__bar{flex:1;height:.4em;background:#3a3a3a;border-radius:.2em;margin:0 1em}' +
'.rezka-ep__bar>div{height:100%;background:#5c86c5;border-radius:.2em}' +
'.rezka-ep__pct{width:3.5em;text-align:right;color:#8a8a8a}' +
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
version: '4.1.0',
name: 'HDREZKA Lab',
description: 'Фильмы и сериалы с rezka: каскад зеркал, ленты с догрузкой, озвучки, серии, история',
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
