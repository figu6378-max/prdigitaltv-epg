import { readFileSync, existsSync } from 'node:fs';
import { downloadXmltvUrl, parseXmltvString, buildSecondaryDescMap } from './fetch.js';
import { filterEpgData } from './filter.js';
import { enrichAllProgrammes } from './enrich.js';
import { writeEpgFile } from './build.js';
import { buildDiscoveredChannels, writeDiscoveredChannels } from './discover.js';

const DISCOVER_MODE = process.argv.includes('--discover');

async function main() {
  console.log(`[pipeline] Starting ${DISCOVER_MODE ? 'DISCOVERY MODE' : 'EPG update'}`);

  const providerUrl = process.env.PROVIDER_EPG_URL;
  const tmdbApiKey = process.env.TMDB_API_KEY || '';

  if (!providerUrl) {
    console.error('[pipeline] ERROR: PROVIDER_EPG_URL env var not set');
    process.exit(1);
  }

  // Load config
  const sources = JSON.parse(readFileSync('config/sources.json', 'utf8'));
  const allowlist = existsSync('config/channels-allowlist.json')
    ? JSON.parse(readFileSync('config/channels-allowlist.json', 'utf8'))
    : { channels: [] };

  // FETCH: Provider EPG
  let providerEpg;
  try {
    console.log('[pipeline] Fetching provider EPG...');
    const xml = await downloadXmltvUrl(providerUrl, false);
    providerEpg = parseXmltvString(xml);
    console.log(`[pipeline] Provider: ${providerEpg.channels.length} channels, ${providerEpg.programmes.length} programmes`);
  } catch (err) {
    console.error(`[pipeline] Cannot fetch provider EPG: ${err.message}`);
    console.log('[pipeline] Keeping existing output/epg.xml unchanged');
    process.exit(0); // exit 0 — not a build failure, just a network issue
  }

  // DISCOVERY MODE: write channel list and exit
  if (DISCOVER_MODE) {
    writeDiscoveredChannels(buildDiscoveredChannels(providerEpg));
    console.log('[pipeline] Done. Update config/channels-allowlist.json then run: npm start');
    return;
  }

  // FILTER
  console.log('[pipeline] Filtering channels...');
  const filtered = filterEpgData(providerEpg, allowlist);
  console.log(`[pipeline] After filter: ${filtered.channels.length} channels, ${filtered.programmes.length} programmes`);

  if (filtered.channels.length === 0) {
    console.warn('[pipeline] WARNING: 0 channels matched allowlist.');
    console.warn('[pipeline] Run: npm run discover  to see actual tvg-id values from provider');
  }

  // FETCH: Secondary EPG for descriptions
  console.log('[pipeline] Loading secondary EPG sources...');
  const secondaryDescMap = await buildSecondaryDescMap(sources.secondary);
  console.log(`[pipeline] Secondary map: ${secondaryDescMap.size} entries`);

  // ENRICH
  console.log('[pipeline] Enriching descriptions...');
  const enriched = await enrichAllProgrammes(filtered.programmes, secondaryDescMap, tmdbApiKey);

  // BUILD
  const ok = writeEpgFile({ channels: filtered.channels, programmes: enriched });
  if (!ok) {
    console.error('[pipeline] Build failed — previous epg.xml preserved');
    process.exit(1);
  }

  console.log('[pipeline] Done.');
}

main().catch(err => {
  console.error('[pipeline] Fatal:', err);
  process.exit(1);
});
