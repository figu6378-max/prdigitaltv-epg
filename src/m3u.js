import axios from 'axios';

/**
 * Download M3U playlist from URL.
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function downloadM3u(url) {
  const res = await axios.get(url, {
    responseType: 'text',
    timeout: 60000,
    headers: { 'User-Agent': 'PRDigitalTV-Selector/1.0' },
  });
  return res.data;
}

/**
 * Parse M3U+ text into array of channel objects.
 * @param {string} text
 * @returns {Array}
 */
export function parseM3u(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const channels = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      current = parseExtinf(line);
    } else if (current && !line.startsWith('#')) {
      current.url = line;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

function parseExtinf(line) {
  const attrs = {};
  const attrRe = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(line)) !== null) {
    attrs[m[1]] = m[2];
  }
  const nameMatch = line.match(/,(.+)$/);
  const displayName = nameMatch ? nameMatch[1].trim() : '';
  return {
    tvgId: attrs['tvg-id'] || '',
    tvgName: attrs['tvg-name'] || displayName,
    tvgLogo: attrs['tvg-logo'] || '',
    groupTitle: attrs['group-title'] || 'Uncategorized',
    displayName,
    url: '',
  };
}

/**
 * Build M3U string from channels array.
 * @param {Array} channels
 * @param {Set<string>} favoritesIds - tvgIds to also include in Favoritos group
 * @returns {string}
 */
export function buildM3u(channels, favoritesIds = new Set()) {
  const lines = ['#EXTM3U'];

  // Favoritos group first
  if (favoritesIds.size > 0) {
    for (const ch of channels) {
      if (favoritesIds.has(ch.tvgId)) {
        lines.push(formatExtinf(ch, 'Favoritos'));
        lines.push(ch.url);
      }
    }
  }

  // All selected channels in their original groups
  for (const ch of channels) {
    lines.push(formatExtinf(ch, ch.groupTitle));
    lines.push(ch.url);
  }

  return lines.join('\n');
}

function formatExtinf(ch, group) {
  return `#EXTINF:-1 tvg-id="${ch.tvgId}" tvg-name="${ch.tvgName}" tvg-logo="${ch.tvgLogo}" group-title="${group}",${ch.displayName}`;
}

/**
 * Infer EPG category from M3U group-title.
 * @param {string} groupTitle
 * @returns {string}
 */
export function inferCategory(groupTitle) {
  const g = groupTitle.toLowerCase();
  if (/sport|espn|nfl|nba|mlb|nhl|soccer|futbol|deport|golf|tennis/.test(g)) return 'sports';
  if (/movie|cine|film|hbo|showtime|starz|cinemax|max|epix/.test(g)) return 'movies';
  if (/news|noticias|cnn|msnbc|fox news/.test(g)) return 'news';
  if (/spain|espa|\.es\b/.test(g)) return 'spain';
  if (/puerto rico|\.pr\b/.test(g)) return 'puerto-rico';
  return 'general';
}
