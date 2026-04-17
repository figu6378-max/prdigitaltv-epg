import { readFileSync, writeFileSync } from 'node:fs';
import { downloadM3u, parseM3u, buildM3u } from './m3u.js';

async function main() {
  const m3uUrl = process.env.PROVIDER_M3U_URL;
  if (!m3uUrl) {
    console.error('ERROR: PROVIDER_M3U_URL env var not set');
    process.exit(1);
  }

  const allowlist = JSON.parse(readFileSync('config/channels-allowlist.json', 'utf8'));
  const allowedIds = new Set(allowlist.channels.map(c => c['tvg-id']));
  console.log(`[playlist] Allowlist: ${allowedIds.size} channels`);

  console.log('[playlist] Downloading provider M3U...');
  const m3uText = await downloadM3u(m3uUrl);
  const all = parseM3u(m3uText);
  console.log(`[playlist] Provider M3U: ${all.length} channels`);

  const filtered = all.filter(ch => allowedIds.has(ch.tvgId));
  console.log(`[playlist] Filtered to: ${filtered.length} channels`);

  const m3u = buildM3u(filtered);
  writeFileSync('playlist.m3u', m3u, 'utf8');
  console.log('[playlist] Written playlist.m3u');
}

main().catch(err => { console.error('[playlist] Fatal:', err); process.exit(1); });
