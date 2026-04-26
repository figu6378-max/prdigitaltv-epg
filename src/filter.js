/**
 * Filter EPG data to only include channels present in the allowlist.
 * Attaches category from allowlist to each channel object.
 * @param {{ channels: Array, programmes: Array }} epgData
 * @param {{ channels: Array<{'tvg-id': string, category: string}> }} allowlist
 * @returns {{ channels: Array, programmes: Array }}
 */
export function filterEpgData(epgData, allowlist, additionalIds = new Set()) {
  const allowedMap = new Map(
    allowlist.channels.map(ch => [ch['tvg-id'], ch.category])
  );

  const epgChannelMap = new Map(epgData.channels.map(ch => [ch.id, ch]));

  // Include all allowlist channels (with stub if missing from EPG sources)
  const channels = [...allowedMap.keys()].map(id => {
    if (epgChannelMap.has(id)) {
      return { ...epgChannelMap.get(id), category: allowedMap.get(id) };
    }
    return { id, displayName: id, icon: '', category: allowedMap.get(id) };
  });

  // Also include provider 2 channels not in allowlist (pass-through, no category)
  for (const id of additionalIds) {
    if (!allowedMap.has(id) && epgChannelMap.has(id)) {
      channels.push({ ...epgChannelMap.get(id), category: 'general' });
    }
  }

  const allIds = new Set([...allowedMap.keys(), ...additionalIds]);
  const programmes = epgData.programmes.filter(p => allIds.has(p.channel));

  return { channels, programmes };
}
