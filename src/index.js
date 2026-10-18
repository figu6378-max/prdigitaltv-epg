import { readFileSync, existsSync } from 'node:fs';
import { downloadXmltvUrl, downloadXmltvFiltered, parseXmltvString, filterXmltvText, buildSecondaryDescMap } from './fetch.js';
import { filterEpgData } from './filter.js';
import { enrichAllProgrammes } from './enrich.js';
import { writeEpgFile } from './build.js';
import { splitEpgByProvider } from './split.js';
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
  let p1ChannelIds = new Set();
  let p2ChannelIds = new Set();

  if (providerUrl2) {
    try {
      console.log('[pipeline] Fetching provider EPG (primary: DINO)...');
      const xml2 = await downloadXmltvUrl(providerUrl2, false);
      providerEpg = parseXmltvString(xml2);
      console.log(`[pipeline] DINO (primary): ${providerEpg.channels.length} channels, ${providerEpg.programmes.length} programmes`);
      p1ChannelIds = new Set(providerEpg.channels.map(c => c.id));
      console.log(`[pipeline] P1 (DINO) channel IDs tracked: ${p1ChannelIds.size}`);
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
      p2ChannelIds = new Set(epg1.channels.map(c => c.id));
      console.log(`[pipeline] P2 (old) channel IDs tracked: ${p2ChannelIds.size}`);

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
  const additionalPrimaryChannelIds = new Set(); // all channel IDs from primary_additional sources → go to both outputs
  const additionalPrimary = (sources.primary_additional || []).filter(s => s.enabled);

  // Some sources (e.g. EPGenius) publish lowercase IDs ("wqrf.us") while the allowlist and provider use "WQRF.us".
  // Map each incoming ID to the existing casing so the filter and the channel|start merge key still match.
  const canonicalIds = new Map();
  for (const ch of allowlist.channels) canonicalIds.set(ch['tvg-id'].toLowerCase(), ch['tvg-id']);
  for (const ch of providerEpg.channels) {
    if (!canonicalIds.has(ch.id.toLowerCase())) canonicalIds.set(ch.id.toLowerCase(), ch.id);
  }
  const canonicalId = id => canonicalIds.get(id.toLowerCase()) ?? id;
  // IDs the filter step keeps for sources without bypass_filter: allowlist + active provider 2 IDs
  const keepIds = new Set([...allowlist.channels.map(ch => ch['tvg-id']), ...provider2ChannelIds]);

  for (const source of additionalPrimary) {
    try {
      console.log(`[pipeline] Fetching additional primary EPG: ${source.name}...`);
      // channel_id_map in sources.json: { "our.pr": "epg-source.us" } (target→source)
      // Invert so we can look up by the source ID → our target ID
      const idMap = Object.fromEntries(
        Object.entries(source.channel_id_map || {}).map(([target, src]) => [src, target])
      );
      // extra_suffixes: keep channels outside the allowlist by country suffix (e.g. "us"); they join the bypass set below
      const extraSuffixes = new Set((source.extra_suffixes || []).map(x => x.toLowerCase()));
      const isExtra = id => extraSuffixes.size > 0 && !keepIds.has(id) && extraSuffixes.has(id.slice(id.lastIndexOf('.') + 1).toLowerCase());
      const keep = id => source.bypass_filter || keepIds.has(id) || isExtra(id);

      const keepSource = id => keep(idMap[id] ?? canonicalId(id));
      // stream_filter: source too large to hold as one string (>512 MB), so filter while decompressing
      let xml = source.stream_filter
        ? await downloadXmltvFiltered(source.url, keepSource, { maxDays: source.max_days, extraId: id => isExtra(idMap[id] ?? canonicalId(id)) })
        // Cut unwanted blocks as text so the DOM parse of 60 MB sources fits in CI memory
        : await downloadXmltvUrl(source.url, source.gzip, source.cache);
      if (!source.stream_filter && !source.bypass_filter) xml = filterXmltvText(xml, keepSource);
      const extra = parseXmltvString(xml);
      xml = null;
      console.log(`[pipeline] ${source.name}: ${extra.channels.length} channels, ${extra.programmes.length} programmes (after text prefilter)`);

      // Remapped channels also need to join additionalPrimaryChannelIds, or the P1/P2 split drops their programmes
      extra.channels = extra.channels.map(ch => ({ ...ch, id: idMap[ch.id] ?? canonicalId(ch.id) }));

      // Drop channels the filter would discard anyway so large sources (15k channels, 1M programmes) don't pile up in memory
      extra.channels = extra.channels.filter(ch => keep(ch.id));
      if (extraSuffixes.size > 0) {
        // Extra channels without a single kept programme would only add empty <channel> entries
        const withProg = new Set(extra.programmes.map(pr => idMap[pr.channel] ?? canonicalId(pr.channel)));
        extra.channels = extra.channels.filter(ch => !isExtra(ch.id) || withProg.has(ch.id));
      }

      const existingIds = new Set(providerEpg.channels.map(c => c.id));
      for (const ch of extra.channels) {
        if (source.bypass_filter || isExtra(ch.id)) additionalBypassIds.add(ch.id);
        additionalPrimaryChannelIds.add(ch.id);
        if (!existingIds.has(ch.id)) {
          providerEpg.channels.push(ch);
          existingIds.add(ch.id);
        }
      }

      const progIndex = new Map(providerEpg.programmes.map((p, i) => [`${p.channel}|${p.start}`, i]));
      let added = 0, upgraded = 0;
      for (const rawProg of extra.programmes) {
        // Remap channel ID before indexing so mapped channels land under the correct ID
        const target = idMap[rawProg.channel] ?? canonicalId(rawProg.channel);
        if (!keep(target)) continue;
        const prog = target !== rawProg.channel ? { ...rawProg, channel: target } : rawProg;
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

  // BUILD — split by provider and write two files
  const p1Set = new Set([...p1ChannelIds, ...additionalBypassIds, ...additionalPrimaryChannelIds]);
  const p2Set = new Set([...p2ChannelIds, ...additionalBypassIds, ...additionalPrimaryChannelIds]);
  console.log(`[pipeline] P1 output set: ${p1Set.size} channel IDs, P2 output set: ${p2Set.size} channel IDs`);

  const { p1: p1Epg, p2: p2Epg } = splitEpgByProvider(filtered.channels, finalProgrammes, p1Set, p2Set);

  const ok1 = writeEpgFile(p1Epg, 'epg.xml');
  const ok2 = writeEpgFile(p2Epg, 'epg2.xml');
  if (!ok1 || !ok2) {
    console.error('[pipeline] Build failed — previous EPG files preserved');
    process.exit(1);
  }

  console.log('[pipeline] Done.');
}

main().catch(err => {
  console.error('[pipeline] Fatal:', err);
  process.exit(1);
});
