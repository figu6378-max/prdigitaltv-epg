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

  // Build lookup of channels that exist in the merged EPG data
  const epgChannelMap = new Map(epgData.channels.map(ch => [ch.id, ch]));

  // Include ALL allowlist channels — even those with no EPG source data
  // (they appear in the output with no programmes, which is correct per user requirement)
  const channels = [...allowedMap.keys()].map(id => {
    if (epgChannelMap.has(id)) {
      return { ...epgChannelMap.get(id), category: allowedMap.get(id) };
    }
    // Channel in allowlist but absent from all EPG sources — include as stub
    return { id, displayName: id, icon: '', category: allowedMap.get(id) };
  });

  const allowedIds = new Set(allowedMap.keys());
  const programmes = epgData.programmes.filter(p => allowedIds.has(p.channel));

  return { channels, programmes };
}
