import axios from 'axios';
import { readFileSync, writeFileSync } from 'node:fs';

const PROVIDER_HOST = process.env.PROVIDER_HOST;
const PROVIDER_USER = process.env.PROVIDER_USER;
const PROVIDER_PASS = process.env.PROVIDER_PASS;

if (!PROVIDER_HOST || !PROVIDER_USER || !PROVIDER_PASS) {
  console.error('Required env vars: PROVIDER_HOST, PROVIDER_USER, PROVIDER_PASS');
  process.exit(1);
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '').replace(/&[a-z]+;/gi, '');
}

function normalize(s) {
  return decodeHtml(s)
    .replace(/^[^:]+:\s*/, '')       // strip prefix: "US: ", "GO: ", "◉: "
    .replace(/[^a-z0-9]/gi, '')      // alphanumeric only
    .toLowerCase()
    .replace(/(hd|fhd|uhd|4k|hevc)$/, ''); // strip quality suffix
}

async function main() {
  const allowlist = JSON.parse(readFileSync('config/channels-allowlist.json', 'utf8'));
  const discovered = JSON.parse(readFileSync('config/channels-discovered.json', 'utf8'));

  const discMap = new Map(discovered.channels.map(c => [c['tvg-id'], c]));

  console.log('[stream-map] Fetching live streams from provider API...');
  const res = await axios.get(`http://${PROVIDER_HOST}/player_api.php`, {
    params: { username: PROVIDER_USER, password: PROVIDER_PASS, action: 'get_live_streams' },
    timeout: 30000,
  });
  const streams = res.data;
  console.log(`[stream-map] Provider: ${streams.length} streams`);

  // Index streams by normalized name (first match wins)
  const streamIndex = new Map();
  for (const stream of streams) {
    const key = normalize(stream.name);
    if (key && !streamIndex.has(key)) streamIndex.set(key, stream);
  }

  const mapping = {};
  let matched = 0;
  const unmatched = [];

  for (const ch of allowlist.channels) {
    const disc = discMap.get(ch['tvg-id']);
    const displayName = disc?.displayName || ch['tvg-id'];
    const key = normalize(displayName);
    const stream = streamIndex.get(key);

    if (stream) {
      mapping[normalize(stream.name)] = {
        tvgId: ch['tvg-id'],
        displayName: displayName.replace(/^[^:]+:\s*/, '').trim(),
        groupTitle: ch.category,
        icon: stream.stream_icon || '',
      };
      matched++;
    } else {
      unmatched.push({ id: ch['tvg-id'], displayName, key });
    }
  }

  console.log(`[stream-map] Matched: ${matched} / ${allowlist.channels.length}`);
  if (unmatched.length > 0) {
    console.log('[stream-map] Unmatched:', unmatched.map(u => u.id).join(', '));
  }

  writeFileSync('stream-epg-map.json', JSON.stringify(mapping, null, 2), 'utf8');
  console.log('[stream-map] Written stream-epg-map.json');
}

main().catch(err => { console.error('[stream-map] Fatal:', err.message); process.exit(1); });
