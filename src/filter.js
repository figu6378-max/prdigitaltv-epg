/**
 * Filter EPG data to only include channels present in the allowlist.
 * Attaches category from allowlist to each channel object.
 * @param {{ channels: Array, programmes: Array }} epgData
 * @param {{ channels: Array<{'tvg-id': string, category: string}> }} allowlist
 * @returns {{ channels: Array, programmes: Array }}
 */
export function filterEpgData(epgData, allowlist) {
  const allowedMap = new Map(
    allowlist.channels.map(ch => [ch['tvg-id'], ch.category])
  );

  const channels = epgData.channels
    .filter(ch => allowedMap.has(ch.id))
    .map(ch => ({ ...ch, category: allowedMap.get(ch.id) }));

  const allowedIds = new Set(allowedMap.keys());
  const programmes = epgData.programmes.filter(p => allowedIds.has(p.channel));

  return { channels, programmes };
}
