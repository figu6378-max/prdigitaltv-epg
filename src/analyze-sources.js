/**
 * Source coverage analysis — compares EPG sources to determine priority order.
 * Run: node src/analyze-sources.js
 *
 * Does NOT require PROVIDER_EPG_URL. Compares public secondary sources only.
 */
import { readFileSync } from 'node:fs';
import { downloadXmltvUrl, parseXmltvString } from './fetch.js';

const SOURCES = [
  {
    name: 'open-epg (NEW)',
    url: 'https://www.open-epg.com/generate/VchmwyY7n2.xml',
    gzip: false,
  },
  {
    name: 'epg-pw-us',
    url: 'https://epg.pw/xmltv/epg_US.xml.gz',
    gzip: true,
  },
  {
    name: 'epg-pw-es',
    url: 'https://epg.pw/xmltv/epg_ES.xml.gz',
    gzip: true,
  },
  {
    name: 'iptv-epg-us',
    url: 'https://iptv-epg.org/files/epg-us.xml.gz',
    gzip: true,
  },
];

async function downloadSource(source) {
  console.log(`[analyze] Downloading ${source.name}...`);
  try {
    const xml = await downloadXmltvUrl(source.url, source.gzip);
    const { channels, programmes } = parseXmltvString(xml);
    console.log(`[analyze] ${source.name}: ${channels.length} channels, ${programmes.length} programmes`);
    return { channels, programmes, ok: true };
  } catch (err) {
    console.warn(`[analyze] ${source.name} FAILED: ${err.message}`);
    return { channels: [], programmes: [], ok: false };
  }
}

function buildTitleDescMap(programmes) {
  const map = new Map();
  for (const p of programmes) {
    if (!p.desc?.trim() || !p.title?.trim()) continue;
    const key = p.title.toLowerCase().trim();
    if (!map.has(key)) map.set(key, p.desc.trim());
  }
  return map;
}

function buildChannelIdSet(channels) {
  return new Set(channels.map(c => c.id?.toLowerCase()).filter(Boolean));
}

async function main() {
  console.log('\n=== EPG Source Coverage Analysis ===\n');

  // Download all sources in parallel
  const results = await Promise.all(SOURCES.map(downloadSource));

  const maps = results.map(r => buildTitleDescMap(r.programmes));
  const channelSets = results.map(r => buildChannelIdSet(r.channels));

  const [openEpgMap, epgPwUsMap, epgPwEsMap, iptvEpgMap] = maps;
  const [openEpgChs, epgPwUsChs, epgPwEsChs, iptvEpgChs] = channelSets;

  // --- Title coverage stats ---
  console.log('\n=== Programme Descriptions (unique titles with desc) ===');
  console.log(`open-epg (NEW)  : ${openEpgMap.size.toLocaleString()} titles`);
  console.log(`epg-pw-us       : ${epgPwUsMap.size.toLocaleString()} titles`);
  console.log(`epg-pw-es       : ${epgPwEsMap.size.toLocaleString()} titles`);
  console.log(`iptv-epg-us     : ${iptvEpgMap.size.toLocaleString()} titles`);

  // --- Channel coverage stats ---
  console.log('\n=== Channel Count (unique channel IDs) ===');
  console.log(`open-epg (NEW)  : ${openEpgChs.size.toLocaleString()} channels`);
  console.log(`epg-pw-us       : ${epgPwUsChs.size.toLocaleString()} channels`);
  console.log(`epg-pw-es       : ${epgPwEsChs.size.toLocaleString()} channels`);
  console.log(`iptv-epg-us     : ${iptvEpgChs.size.toLocaleString()} channels`);

  // --- For titles NOT in open-epg, how many does each other source add? ---
  const otherSources = [
    { name: 'epg-pw-us', map: epgPwUsMap },
    { name: 'epg-pw-es', map: epgPwEsMap },
    { name: 'iptv-epg-us', map: iptvEpgMap },
  ];

  console.log('\n=== Additional coverage AFTER open-epg (titles not in open-epg) ===');
  const sourceAdditional = otherSources.map(src => {
    let additional = 0;
    let overlap = 0;
    for (const [title] of src.map) {
      if (openEpgMap.has(title)) overlap++;
      else additional++;
    }
    return { name: src.name, additional, overlap, total: src.map.size };
  });

  sourceAdditional.sort((a, b) => b.additional - a.additional);

  for (const s of sourceAdditional) {
    const pct = s.total > 0 ? ((s.additional / s.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${s.name.padEnd(16)}: ${s.additional.toLocaleString()} additional titles (${pct}% unique), ${s.overlap.toLocaleString()} overlap with open-epg`);
  }

  // --- Cumulative after stacking sources in order ---
  console.log('\n=== Cumulative coverage stacking sources ===');
  const merged = new Map(openEpgMap);
  console.log(`  1. open-epg (NEW): ${merged.size.toLocaleString()} titles`);

  for (const s of sourceAdditional) {
    for (const [k, v] of s.map) {
      if (!merged.has(k)) merged.set(k, v);
    }
    console.log(`  + ${s.name}: ${merged.size.toLocaleString()} titles total`);
  }

  // --- Recommended order ---
  console.log('\n=== RECOMMENDED SOURCE ORDER ===');
  console.log('  Priority 1 (primary): open-epg (NEW)');
  for (let i = 0; i < sourceAdditional.length; i++) {
    console.log(`  Priority ${i + 2}: ${sourceAdditional[i].name} (${sourceAdditional[i].additional.toLocaleString()} additional titles)`);
  }

  // --- Sample descriptions from open-epg ---
  console.log('\n=== Sample descriptions from open-epg (first 5) ===');
  let count = 0;
  for (const [title, desc] of openEpgMap) {
    if (count++ >= 5) break;
    console.log(`  "${title}": ${desc.substring(0, 100)}...`);
  }

  // --- Channel ID samples from open-epg ---
  console.log('\n=== Sample channel IDs from open-epg (first 10) ===');
  let chCount = 0;
  for (const id of openEpgChs) {
    if (chCount++ >= 10) break;
    console.log(`  ${id}`);
  }
}

main().catch(err => {
  console.error('[analyze] Fatal:', err);
  process.exit(1);
});
