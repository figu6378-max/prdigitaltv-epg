const EPG_MAP_URL = 'https://figu6378-max.github.io/prdigitaltv-epg/stream-epg-map.json';
const EPG_URL = 'https://figu6378-max.github.io/prdigitaltv-epg/epg.xml';
const CACHE_TTL = 3600; // 1 hour

// Fallback EPG IDs for provider 2 streams that have blank epg_channel_id.
// Keys are normalize(stream.name) values.
const PROVIDER2_NAME_FALLBACK = {
  'latwapa':                       'WAPA.pr',
  'latwapaamerica':                'WAPA.pr',
  'lattelemundopuertorico':        'WKAQ.pr',
  'usatelemundo2wkaqpuertorico':   'WKAQ.pr',
  'usauniivision11prwlii':         'WLII.pr',
};

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    // Handle /playlist/USER/PASS  OR  /playlist2/USER/PASS  OR  /playlist?u=USER&p=PASS
    let u, p, host;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 3 && parts[0] === 'playlist') {
      u = parts[1]; p = parts[2];
      host = env.PROVIDER_HOST || 'prdigital.cc';
    } else if (parts.length === 3 && parts[0] === 'playlist2') {
      u = parts[1]; p = parts[2];
      host = env.PROVIDER_HOST_2 || 'line.host-prdigital.cc';
    } else if (url.pathname === '/playlist') {
      u = url.searchParams.get('u');
      p = url.searchParams.get('p');
      host = env.PROVIDER_HOST || 'prdigital.cc';
    } else {
      return new Response('Use /playlist/USERNAME/PASSWORD or /playlist2/USERNAME/PASSWORD', { status: 404 });
    }

    if (!u || !p) {
      return new Response('Missing credentials', { status: 400 });
    }

    let mapping, streams;

    try {
      mapping = await getMapping(ctx);
    } catch (err) {
      return new Response(`EPG map unavailable: ${err.message}`, { status: 502 });
    }

    try {
      const apiUrl = `http://${host}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}&action=get_live_streams`;
      const res = await fetch(apiUrl, { cf: { cacheTtl: 0 } });

      if (!res.ok) return new Response('Invalid credentials or provider error', { status: 401 });
      streams = await res.json();
    } catch (err) {
      return new Response(`Provider unreachable: ${err.message}`, { status: 502 });
    }

    const lines = [
      `#EXTM3U url-tvg="${EPG_URL}" refresh="3600"`,
    ];

    const isProvider2 = parts[0] === 'playlist2';
    const seen = new Set();

    for (const stream of streams) {
      let tvgId, name, logo, groupTitle;

      if (isProvider2) {
        // Provider 2: use epg_channel_id when set; fall back to name-based map for blank ones
        const epgId = stream.epg_channel_id && stream.epg_channel_id.trim();
        const resolvedId = epgId || PROVIDER2_NAME_FALLBACK[normalize(stream.name)] || '';
        if (!resolvedId) continue;
        if (seen.has(resolvedId)) continue;
        seen.add(resolvedId);
        tvgId = resolvedId;
        // Clean display name: strip leading country prefix like "USA - " or "|XX| "
        name = stream.name
          .replace(/^\|[^|]+\|\s*/, '')
          .replace(/^[A-Z]{2,4}\s*[-–]\s*/i, '')
          .trim();
        logo = stream.stream_icon || '';
        groupTitle = 'general';
      } else {
        // Provider 1: use stream-map lookup by normalized name
        const key = normalize(stream.name);
        const epg = mapping[key];
        if (!epg) continue;
        if (seen.has(epg.tvgId)) continue;
        seen.add(epg.tvgId);
        tvgId = epg.tvgId;
        name = decodeEntities(epg.displayName);
        logo = stream.stream_icon || epg.icon || '';
        groupTitle = epg.groupTitle;
      }

      const streamUrl = `http://${host}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${stream.stream_id}.ts`;
      lines.push(
        `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${name}" tvg-logo="${logo}" group-title="${groupTitle}",${name}`
      );
      lines.push(streamUrl);
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
