/**
 * Expands channels-allowlist.json by cross-referencing provider's discovered channels
 * against the epg2.xml.gz source, keeping only US/CA/ES channels with EPG matches.
 *
 * Usage:
 *   node src/expand-allowlist.js [--epg2 <path-or-url>]
 *
 * Matching strategy (in order):
 *   1. Exact tvg-id match (discovered id === epg2 channel id)
 *   2. Normalized display name match
 */

import { XMLParser } from 'fast-xml-parser';
import { createGunzip } from 'node:zlib';
import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import axios from 'axios';

const EPG2_URL = 'https://github.com/ferteque/Curated-M3U-Repository/raw/refs/heads/main/epg2.xml.gz';
const ALLOWED_TLDS = ['.us', '.ca', '.es'];

function normalize(s) {
  return s
    .replace(/&amp;/g, '').replace(/&[a-z]+;/gi, '')
    .replace(/^[^:]+:\s*/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .replace(/(hd|fhd|uhd|4k|hevc)$/, '');
}

function guessCategory(tvgId, displayName) {
  const id = tvgId.toLowerCase();
  const name = displayName.toLowerCase();
  if (/sport|nfl|nba|nhl|mlb|espn|fox.*sport|beinsport|golf|racing|tennis|wrestling/.test(id + name)) return 'sports';
  if (/cnn|msnbc|fox.*news|abc.*news|nbc.*news|cbs.*news|cnbc|bloomberg|headline/.test(id + name)) return 'news';
  if (/cinemax|hbo|starz|showtime|amc|syfy|aande|fxx|tbs|tnt|lifetime|hallmark|bravo|e!|fx\b/.test(id + name)) return 'movies';
  if (/nick|cartoon|disney|family|kids|boomerang/.test(id + name)) return 'kids';
  if (/telemundo|univision|galavision|tlnovelas|multimedios|estrella/.test(id + name)) return 'spanish';
  return 'general';
}

async function loadEpg2(source) {
  let buffer;
  if (source.startsWith('http')) {
    console.log('[expand] Downloading epg2.xml.gz...');
    const res = await axios.get(source, { responseType: 'arraybuffer', timeout: 60000 });
    buffer = Buffer.from(res.data);
  } else {
    buffer = readFileSync(source);
  }

  // Decompress
  const { createGunzip } = await import('node:zlib');
  const { Readable } = await import('node:stream');
  const xml = await new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const readable = Readable.from(buffer);
    const chunks = [];
    readable.pipe(gunzip);
    gunzip.on('data', c => chunks.push(c));
    gunzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    gunzip.on('error', reject);
    readable.on('error', reject);
  });

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    isArray: n => ['channel', 'display-name'].includes(n),
  });
  const data = parser.parse(xml);
  return data.tv?.channel || [];
}

async function main() {
  const epg2Source = process.argv[3] || EPG2_URL;

  // Load existing allowlist
  const allowlist = JSON.parse(readFileSync('config/channels-allowlist.json', 'utf8'));
  const existingIds = new Set(allowlist.channels.map(c => c['tvg-id']));
  console.log(`[expand] Existing allowlist: ${allowlist.channels.length} channels`);

  // Load discovered channels from provider
  const discovered = JSON.parse(readFileSync('config/channels-discovered.json', 'utf8'));
  const discoveredChannels = discovered.channels || [];
  console.log(`[expand] Provider discovered: ${discoveredChannels.length} channels`);

  // Filter discovered to US/CA/ES only
  const regional = discoveredChannels.filter(c => ALLOWED_TLDS.some(tld => c['tvg-id']?.endsWith(tld)));
  console.log(`[expand] Regional (US/CA/ES): ${regional.length} channels`);

  // Load epg2
  const epg2Channels = await loadEpg2(epg2Source);
  console.log(`[expand] epg2 channels: ${epg2Channels.length}`);

  // Build epg2 lookup: by id and by normalized display name
  const epg2ById = new Map();
  const epg2ByName = new Map();
  for (const ch of epg2Channels) {
    const id = ch['@_id'] || '';
    epg2ById.set(id.toLowerCase(), id);
    const names = (ch['display-name'] || []).map(dn => typeof dn === 'object' ? dn['#text'] : dn).filter(Boolean);
    for (const name of names) {
      const key = normalize(name);
      if (key && !epg2ByName.has(key)) epg2ByName.set(key, id);
    }
  }

  // Match discovered regional channels against epg2
  let added = 0;
  const newChannels = [];

  for (const disc of regional) {
    const tvgId = disc['tvg-id'];
    if (existingIds.has(tvgId)) continue;

    // Try exact id match first
    let matched = epg2ById.has(tvgId.toLowerCase());

    // Try normalized display name match
    if (!matched) {
      const cleanName = (disc.displayName || '').replace(/^[^:]+:\s*/, '').trim();
      matched = epg2ByName.has(normalize(cleanName));
    }

    if (matched) {
      const category = guessCategory(tvgId, disc.displayName || '');
      newChannels.push({ 'tvg-id': tvgId, category });
      existingIds.add(tvgId);
      added++;
    }
  }

  console.log(`[expand] New channels to add: ${added}`);

  // Merge and write
  const merged = { channels: [...allowlist.channels, ...newChannels] };
  writeFileSync('config/channels-allowlist.json', JSON.stringify(merged, null, 2), 'utf8');
  console.log(`[expand] allowlist updated: ${merged.channels.length} total channels`);

  // Print breakdown by category
  const byCategory = {};
  for (const c of newChannels) byCategory[c.category] = (byCategory[c.category] || 0) + 1;
  console.log('[expand] Added by category:', byCategory);
}

main().catch(err => { console.error('[expand] Fatal:', err.message); process.exit(1); });
