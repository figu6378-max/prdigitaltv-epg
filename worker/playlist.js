const EPG_MAP_URL = 'https://figu6378-max.github.io/prdigitaltv-epg/stream-epg-map.json';
const EPG_URL = 'https://figu6378-max.github.io/prdigitaltv-epg/epg.xml';
const CACHE_TTL = 3600;

const PROVIDER2_NAME_FALLBACK = {
  'latwapa':                       'WAPA.pr',
  'latwapaamerica':                'WAPAAM.pr',
  'lattelemundopuertorico':        'WKAQ.pr',
  'usatelemundo2wkaqpuertorico':   'WKAQDT2.pr',
  'usauniivision11prwlii':         'WLII.pr',
};

// Category consolidation for US/CA/UK/ES live channels
const CONSOLIDATE_SUFFIX = new Set(['us', 'ca', 'uk', 'gb', 'es']);
const MOVIE_CAT_RE = /pel[ií]culas?|cinema|cine\b|movies?|films?/i;
const SPORTS_CAT_RE = /deportes?|sports?/i;

function normalize(s) {
  return s
    .replace(/&amp;/g, '').replace(/&[a-z]+;/gi, '')
    .replace(/^[^:]+:\s*/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .replace(/(hd|fhd|uhd|4k|hevc)$/, '');
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

// Normalizes provider category names for live channels from target countries.
// VOD movies are always normalized separately since they lack a country-coded tvg-id.
function normalizeGroupTitle(raw, tvgId) {
  const suffix = (tvgId.split('.').pop() || '').toLowerCase();
  let cat = (raw || 'general')
    .replace(/^\|[^|]+\|\s*/, '')
    .replace(/^\d+[-.\s]+/, '')
    .trim() || 'general';
  if (CONSOLIDATE_SUFFIX.has(suffix)) {
    if (MOVIE_CAT_RE.test(cat)) return 'MOVIES';
    if (SPORTS_CAT_RE.test(cat)) return 'SPORTS';
  }
  return cat;
}

async function getMapping(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(EPG_MAP_URL);
  let cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const res = await fetch(EPG_MAP_URL);
  if (!res.ok) throw new Error(`Failed to fetch stream map: ${res.status}`);

  const cloned = new Response(await res.text(), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL}`,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, cloned.clone()));
  return cloned.json();
}

async function buildCategoryMap(base, action) {
  try {
    const res = await fetch(`${base}&action=${action}`, { cf: { cacheTtl: 300 } });
    if (!res.ok) return {};
    const cats = await res.json();
    const map = {};
    if (Array.isArray(cats)) for (const c of cats) map[c.category_id] = c.category_name;
    return map;
  } catch { return {}; }
}

async function fetchJsonArray(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function fetchSeriesInfo(base, seriesId) {
  try {
    const res = await fetch(`${base}&action=get_series_info&series_id=${seriesId}`, { cf: { cacheTtl: 3600 } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    let u, p, host, isProvider2, isSeries;
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.length === 3 && parts[0] === 'playlist') {
      u = parts[1]; p = parts[2];
      host = env.PROVIDER_HOST || 'prdigital.cc';
      isProvider2 = false; isSeries = false;
    } else if (parts.length === 3 && parts[0] === 'playlist2') {
      u = parts[1]; p = parts[2];
      host = env.PROVIDER_HOST_2 || 'line.host-prdigital.cc';
      isProvider2 = true; isSeries = false;
    } else if (parts.length === 3 && parts[0] === 'series') {
      u = parts[1]; p = parts[2];
      host = env.PROVIDER_HOST || 'prdigital.cc';
      isProvider2 = false; isSeries = true;
    } else if (parts.length === 3 && parts[0] === 'series2') {
      u = parts[1]; p = parts[2];
      host = env.PROVIDER_HOST_2 || 'line.host-prdigital.cc';
      isProvider2 = true; isSeries = true;
    } else if (url.pathname === '/playlist') {
      u = url.searchParams.get('u');
      p = url.searchParams.get('p');
      host = env.PROVIDER_HOST || 'prdigital.cc';
      isProvider2 = false; isSeries = false;
    } else {
      return new Response(
        'Use /playlist/USER/PASS, /playlist2/USER/PASS, /series/USER/PASS, or /series2/USER/PASS',
        { status: 404 },
      );
    }

    if (!u || !p) return new Response('Missing credentials', { status: 400 });

    const base = `http://${host}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
    const lines = [`#EXTM3U url-tvg="${EPG_URL}" refresh="3600"`];

    // ── Series route ─────────────────────────────────────────────────────────
    if (isSeries) {
      let seriesRes;
      try {
        seriesRes = await fetch(`${base}&action=get_series`, { cf: { cacheTtl: 0 } });
      } catch (err) {
        return new Response(`Provider unreachable: ${err.message}`, { status: 502 });
      }
      if (!seriesRes.ok) return new Response('Invalid credentials or provider error', { status: 401 });
      const allSeries = await seriesRes.json();
      if (!Array.isArray(allSeries)) return new Response('Invalid credentials or provider error', { status: 401 });

      const BATCH = 10;
      for (let i = 0; i < allSeries.length; i += BATCH) {
        const batch = allSeries.slice(i, i + BATCH);
        const infos = await Promise.all(batch.map(s => fetchSeriesInfo(base, s.series_id)));

        for (let j = 0; j < batch.length; j++) {
          const series = batch[j];
          const info = infos[j];
          if (!info?.episodes) continue;

          const groupTitle = series.name || 'Series';
          const cover = series.cover || '';

          for (const [season, episodes] of Object.entries(info.episodes)) {
            if (!Array.isArray(episodes)) continue;
            const s = String(season).padStart(2, '0');
            for (const ep of episodes) {
              const e = String(ep.episode_num).padStart(2, '0');
              const epTitle = ep.title ? ` - ${ep.title}` : '';
              const epName = `${series.name} S${s}E${e}${epTitle}`;
              const ext = ep.container_extension || 'mkv';
              lines.push(
                `#EXTINF:-1 tvg-id="" tvg-name="${epName}" tvg-logo="${cover}" group-title="${groupTitle}",${epName}`,
              );
              lines.push(`http://${host}/series/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${ep.id}.${ext}`);
            }
          }
        }
      }

      return new Response(lines.join('\n'), {
        headers: {
          'Content-Type': 'application/x-mpegurl; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // ── Playlist (live + VOD) route ───────────────────────────────────────────
    let liveRes;
    try {
      liveRes = await fetch(`${base}&action=get_live_streams`, { cf: { cacheTtl: 0 } });
    } catch (err) {
      return new Response(`Provider unreachable: ${err.message}`, { status: 502 });
    }
    if (!liveRes.ok) return new Response('Invalid credentials or provider error', { status: 401 });
    const liveStreams = await liveRes.json();

    let mapping = {};
    if (!isProvider2) {
      try {
        mapping = await getMapping(ctx);
      } catch (err) {
        return new Response(`EPG map unavailable: ${err.message}`, { status: 502 });
      }
    }

    const [vodStreams, liveCatMap, vodCatMap] = await Promise.all([
      fetchJsonArray(`${base}&action=get_vod_streams`, { cf: { cacheTtl: 0 } }),
      buildCategoryMap(base, 'get_live_categories'),
      buildCategoryMap(base, 'get_vod_categories'),
    ]);

    // Live channels
    const seen = new Set();
    for (const stream of liveStreams) {
      let tvgId, name, logo, groupTitle;

      if (isProvider2) {
        const epgId = stream.epg_channel_id && stream.epg_channel_id.trim();
        const resolvedId = epgId || PROVIDER2_NAME_FALLBACK[normalize(stream.name)] || '';
        if (!resolvedId) continue;
        if (seen.has(resolvedId)) continue;
        seen.add(resolvedId);
        tvgId = resolvedId;
        name = stream.name
          .replace(/^\|[^|]+\|\s*/, '')
          .replace(/^[A-Z]{2,4}\s*[-–]\s*/i, '')
          .trim();
        logo = stream.stream_icon || '';
        const rawCat = stream.category_name || liveCatMap[stream.category_id] || 'general';
        groupTitle = normalizeGroupTitle(rawCat, tvgId);
      } else {
        const key = normalize(stream.name);
        const epg = mapping[key];
        if (!epg) continue;
        if (seen.has(epg.tvgId)) continue;
        seen.add(epg.tvgId);
        tvgId = epg.tvgId;
        name = decodeEntities(epg.displayName);
        logo = stream.stream_icon || epg.icon || '';
        groupTitle = epg.groupTitle;
        if (groupTitle === 'movies') groupTitle = 'MOVIES';
        else if (groupTitle === 'sports') groupTitle = 'SPORTS';
      }

      lines.push(
        `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${name}" tvg-logo="${logo}" group-title="${groupTitle}",${name}`,
      );
      lines.push(`http://${host}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${stream.stream_id}.ts`);
    }

    // VOD movies
    for (const stream of vodStreams) {
      const name = stream.name || '';
      const logo = stream.stream_icon || '';
      const rawCat = stream.category_name || vodCatMap[stream.category_id] || 'movies';
      // All VOD movie categories normalize to 'movies' when they match; keep specific genre otherwise
      const groupTitle = MOVIE_CAT_RE.test(rawCat) ? 'MOVIES' : rawCat;
      const ext = stream.container_extension || 'mp4';
      lines.push(
        `#EXTINF:-1 tvg-id="" tvg-name="${name}" tvg-logo="${logo}" group-title="${groupTitle}",${name}`,
      );
      lines.push(`http://${host}/movie/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${stream.stream_id}.${ext}`);
    }

    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'application/x-mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
