import { writeFileSync } from 'node:fs';

/**
 * Build a deduplicated, sorted channel list from parsed EPG data.
 * @param {{ channels: Array }} epgData
 * @returns {Array<{'tvg-id': string, displayName: string, category: string}>}
 */
export function buildDiscoveredChannels(epgData) {
  const seen = new Set();
  const result = [];
  for (const ch of epgData.channels) {
    if (!seen.has(ch.id)) {
      seen.add(ch.id);
      result.push({ 'tvg-id': ch.id, displayName: ch.displayName ?? '', category: '' });
    }
  }
  return result.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}

/**
 * Write discovered channel list to config/channels-discovered.json.
 * @param {Array} channels
 */
export function writeDiscoveredChannels(channels) {
  const output = {
    _instructions: 'Copy desired entries into config/channels-allowlist.json and set the category field (sports/movies/news/puerto-rico/spain)',
    _total: channels.length,
    channels,
  };
  writeFileSync('config/channels-discovered.json', JSON.stringify(output, null, 2), 'utf8');
  console.log(`[discover] ${channels.length} channels written to config/channels-discovered.json`);
}
