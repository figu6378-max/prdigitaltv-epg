const EPG_MAP_URL = 'https://figu6378-max.github.io/prdigitaltv-epg/stream-epg-map.json';
const EPG_URL = 'https://figu6378-max.github.io/prdigitaltv-epg/epg.xml';
const CACHE_TTL = 3600; // 1 hour

function normalize(s) {
  return s
    .replace(/&amp;/g, '').replace(/&[a-z]+;/gi, '')
    .replace(/^[^:]+:\s*/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .replace(/(hd|fhd|uhd|4k|hevc)$/, '');
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

    // Only handle /playlist
    if (url.pathname !== '/playlist') {
      return new Response('Use /playlist?u=USERNAME&p=PASSWORD', { status: 404 });
    }

    const u = url.searchParams.get('u');
    const p = url.searchParams.get('p');
    if (!u || !p) {
      return new Response('Missing u or p parameters', { status: 400 });
    }

    let mapping, streams;

    try {
      mapping = await getMapping(ctx);
    } catch (err) {
      return new Response(`EPG map unavailable: ${err.message}`, { status: 502 });
    }

    // Detect provider host from secrets or default
    const host = env.PROVIDER_HOST || 'prdigital.cc';

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

    for (const stream of streams) {
      const key = normalize(stream.name);
      const epg = mapping[key];
      if (!epg) continue;

      const streamUrl = `http://${host}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${stream.stream_id}.ts`;
      lines.push(
        `#EXTINF:-1 tvg-id="${epg.tvgId}" tvg-name="${epg.displayName}" tvg-logo="${epg.icon || stream.stream_icon || ''}" group-title="${epg.groupTitle}",${epg.displayName}`
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
