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

    // Если data.url уже прямая ссылка на m3u8
    if (data.url.startsWith('http') && data.url.includes('m3u8')) {
        return {
            playlist: [{
                url: data.url,
                quality: 'auto' // качество будет определено плеером из манифеста
            }]
        };
    }

    // Иначе пробуем старое декодирование
    const decoded = decodeRezkaUrl(data.url);
    if (decoded.length === 0) {
        throw new Error('Не удалось декодировать ссылку');
    }

    return {
        playlist: decoded
    };
}