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
  const providerUrl2 = process.env.PROVIDER_EPG_URL_2 || '';
  const tmdbApiKey = process.env.TMDB_API_KEY || '';

  // Load config
  const sources = JSON.parse(readFileSync('config/sources.json', 'utf8'));
  const allowlist = existsSync('config/channels-allowlist.json')
    ? JSON.parse(readFileSync('config/channels-allowlist.json', 'utf8'))
    : { channels: [] };
  const channelAliases = existsSync('config/channel-aliases.json')
    ? JSON.parse(readFileSync('config/channel-aliases.json', 'utf8'))
    : {};
  console.log(`[pipeline] Channel aliases loaded: ${Object.keys(channelAliases).length}`);

  // Load known-active DINO epg_channel_ids (from player_api — only channels with live streams)
  const provider2ChannelIds = new Set(
    existsSync('config/provider2-epg-ids.json')
      ? JSON.parse(readFileSync('config/provider2-epg-ids.json', 'utf8'))
      : []
  );
  console.log(`[pipeline] DINO active channel IDs loaded: ${provider2ChannelIds.size}`);

  // FETCH: Primary provider EPG — DINO (PROVIDER_EPG_URL_2) is now primary
  let providerEpg = null;

  if (providerUrl2) {
    try {
      console.log('[pipeline] Fetching provider EPG (primary: DINO)...');
      const xml2 = await downloadXmltvUrl(providerUrl2, false);
      providerEpg = parseXmltvString(xml2);
      console.log(`[pipeline] DINO (primary): ${providerEpg.channels.length} channels, ${providerEpg.programmes.length} programmes`);
    } catch (err) {
      console.error(`[pipeline] ERROR: DINO (primary) EPG unavailable: ${err.message}`);
      console.error('[pipeline] Falling back to old provider...');
    }
  } else {
    console.warn('[pipeline] PROVIDER_EPG_URL_2 not set — DINO primary skipped');
  }

  // FETCH: Old provider (PROVIDER_EPG_URL) — fallback base if DINO failed, else gap-fill merge
  if (providerUrl) {
    try {
      console.log('[pipeline] Fetching provider EPG (fallback: old P1)...');
      const xml = await downloadXmltvUrl(providerUrl, false);
      const epg1 = parseXmltvString(xml);
      console.log(`[pipeline] Old P1: ${epg1.channels.length} channels, ${epg1.programmes.length} programmes`);

      if (!providerEpg) {
        providerEpg = epg1;
        console.log('[pipeline] Using old P1 as base (DINO unavailable)');
      } else {
        const existingIds = new Set(providerEpg.channels.map(c => c.id));
        for (const ch of epg1.channels) {
          if (!existingIds.has(ch.id)) {
            providerEpg.channels.push(ch);
            existingIds.add(ch.id);
          }
        }
        const coveredIds = new Set(providerEpg.programmes.map(p => p.channel));
        for (const prog of epg1.programmes) {
          if (!coveredIds.has(prog.channel)) providerEpg.programmes.push(prog);
        }
        console.log(`[pipeline] After old P1 merge: ${providerEpg.channels.length} channels, ${providerEpg.programmes.length} programmes`);
      }
    } catch (err) {
      console.warn(`[pipeline] Old P1 EPG unavailable: ${err.message}`);
    }
  }

  if (!providerEpg) {
    console.error('[pipeline] Cannot fetch any provider EPG. Keeping existing output/epg.xml unchanged');
    process.exit(0);
  }

  // FETCH: Additional primary EPG sources — merge into provider data
  // Sources with bypass_filter:true have all their channel IDs added to the filter bypass set
  const additionalBypassIds = new Set();
  const additionalPrimary = (sources.primary_additional || []).filter(s => s.enabled);
  for (const source of additionalPrimary) {
    try {
      console.log(`[pipeline] Fetching additional primary EPG: ${source.name}...`);
      const xml = await downloadXmltvUrl(source.url, source.gzip);
      const extra = parseXmltvString(xml);
      console.log(`[pipeline] ${source.name}: ${extra.channels.length} channels, ${extra.programmes.length} programmes`);

      const existingIds = new Set(providerEpg.channels.map(c => c.id));
      for (const ch of extra.channels) {
        if (source.bypass_filter) additionalBypassIds.add(ch.id);
        if (!existingIds.has(ch.id)) {
          providerEpg.channels.push(ch);
          existingIds.add(ch.id);
        }
      }

      const progIndex = new Map(providerEpg.programmes.map((p, i) => [`${p.channel}|${p.start}`, i]));
      // channel_id_map in sources.json: { "our.pr": "epg-source.us" } (target→source)
      // Invert so we can look up by prog.channel (the source ID) → our target ID
      const idMap = Object.fromEntries(
        Object.entries(source.channel_id_map || {}).map(([target, src]) => [src, target])
      );
      let added = 0, upgraded = 0;
      for (const rawProg of extra.programmes) {
        // Remap channel ID before indexing so mapped channels land under the correct ID
        const remapped = idMap[rawProg.channel];
        const prog = remapped ? { ...rawProg, channel: remapped } : rawProg;
        const key = `${prog.channel}|${prog.start}`;
        if (progIndex.has(key)) {
          const idx = progIndex.get(key);
          const hasIncomingDesc = prog.desc?.trim();
          const existingEmpty = !providerEpg.programmes[idx].desc?.trim();
          if (hasIncomingDesc && (existingEmpty || source.prefer_desc)) {
            providerEpg.programmes[idx] = prog;
            upgraded++;
          }
        } else {
          progIndex.set(key, providerEpg.programmes.length);
          providerEpg.programmes.push(prog);
          added++;
        }
      }
      console.log(`[pipeline] After merge: ${providerEpg.channels.length} channels, ${providerEpg.programmes.length} programmes (+${added} new, ${upgraded} desc upgrades)`);
    } catch (err) {
      console.warn(`[pipeline] ${source.name} unavailable: ${err.message}`);
    }
  }

  // DISCOVERY MODE: write channel list and exit
  if (DISCOVER_MODE) {
    writeDiscoveredChannels(buildDiscoveredChannels(providerEpg));
    console.log('[pipeline] Done. Update config/channels-allowlist.json then run: npm start');
    return;
  }

  // FILTER
  console.log('[pipeline] Filtering channels...');
  const allBypassIds = new Set([...provider2ChannelIds, ...additionalBypassIds]);
  const filtered = filterEpgData(providerEpg, allowlist, allBypassIds);
  console.log(`[pipeline] After filter: ${filtered.channels.length} channels, ${filtered.programmes.length} programmes`);

  // Deduplicate programmes by channel+start (catches within-source and any gap-fill edge cases)
  const seenProgs = new Set();
  const beforeDedup = filtered.programmes.length;
  filtered.programmes = filtered.programmes.filter(p => {
    const key = `${p.channel}|${p.start}`;
    if (seenProgs.has(key)) return false;
    seenProgs.add(key);
    return true;
  });
  console.log(`[pipeline] After dedup: ${filtered.programmes.length} programmes (removed ${beforeDedup - filtered.programmes.length} duplicates)`);

  // Purge expired programmes (start time more than 1 hour in the past)
  const purgeThreshold = Date.now() - 60 * 60 * 1000;
  const beforePurge = filtered.programmes.length;
  filtered.programmes = filtered.programmes.filter(p => {
    const s = p.start; // e.g. "20260427183000 +0000"
    const [datePart, tzPart = '+0000'] = s.trim().split(/\s+/);
    const tz = tzPart.replace(/([+-])(\d{2})(\d{2})/, '$1$2:$3');
    const iso = `${datePart.slice(0,4)}-${datePart.slice(4,6)}-${datePart.slice(6,8)}T${datePart.slice(8,10)}:${datePart.slice(10,12)}:${datePart.slice(12,14)}${tz}`;
    const dt = new Date(iso);
    return isNaN(dt.getTime()) || dt.getTime() >= purgeThreshold;
  });
  console.log(`[pipeline] After purge: ${filtered.programmes.length} programmes (removed ${beforePurge - filtered.programmes.length} expired)`);

  if (filtered.channels.length === 0) {
    console.warn('[pipeline] WARNING: 0 channels matched allowlist.');
    console.warn('[pipeline] Run: npm run discover  to see actual tvg-id values from provider');
  }

  // CHANNEL ALIASES: copy programmes from source to alias when alias has no programmes
  // Used for DINO channels that share EPG data with a differently-named channel
  const CHANNEL_ALIASES = {
    'TelemundoWKAQ.us': 'WKAQ.us',
  };
  const progsByChannel = new Map();
  for (const p of filtered.programmes) {
    if (!progsByChannel.has(p.channel)) progsByChannel.set(p.channel, []);
    progsByChannel.get(p.channel).push(p);
  }
  const filteredChannelIds = new Set(filtered.channels.map(c => c.id));
  for (const [alias, source] of Object.entries(CHANNEL_ALIASES)) {
    if (filteredChannelIds.has(alias) && !progsByChannel.has(alias) && progsByChannel.has(source)) {
      const copied = progsByChannel.get(source).map(p => ({ ...p, channel: alias }));
      filtered.programmes.push(...copied);
      console.log(`[pipeline] Aliased ${copied.length} programmes from ${source} → ${alias}`);
    }
  }

  // FETCH: Secondary EPG for descriptions
  console.log('[pipeline] Loading secondary EPG sources...');
  const secondaryDescMap = await buildSecondaryDescMap(sources.secondary);
  console.log(`[pipeline] Secondary map: ${secondaryDescMap.size} entries`);

  // ENRICH
  console.log('[pipeline] Enriching descriptions...');
  const enriched = await enrichAllProgrammes(filtered.programmes, secondaryDescMap, tmdbApiKey, channelAliases);

  // CROSS-CHANNEL DESC SHARING: propagate best desc within channel families (same title)
  const CHANNEL_FAMILIES = [
    ['WAPA.pr', 'WAPADT2.pr', 'WAPAAM.pr', 'WAPADeportes.pr'],
    ['WLII.pr', 'WLIIDT2.pr'],
    ['WKAQ.pr', 'WKAQDT2.pr'],
  ];
  const familySet = new Set(CHANNEL_FAMILIES.flat());
  const famIdx = id => CHANNEL_FAMILIES.findIndex(f => f.includes(id));
  const famTitleDesc = new Map();
  for (const p of enriched) {
    if (!familySet.has(p.channel) || !p.desc?.trim() || p.desc === p.title) continue;
    const key = `${famIdx(p.channel)}::${p.title.toLowerCase().trim()}`;
    const cur = famTitleDesc.get(key) || '';
    if (p.desc.length > cur.length) famTitleDesc.set(key, p.desc);
  }
  let sharedDescs = 0;
  const finalProgrammes = enriched.map(p => {
    if (!familySet.has(p.channel) || p.desc?.trim()) return p;
    const shared = famTitleDesc.get(`${famIdx(p.channel)}::${p.title.toLowerCase().trim()}`);
    if (shared) { sharedDescs++; return { ...p, desc: shared }; }
    return p;
  });
  console.log(`[pipeline] Cross-channel desc share: ${sharedDescs} programmes filled`);

  // BUILD
  const ok = writeEpgFile({ channels: filtered.channels, programmes: finalProgrammes });
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
