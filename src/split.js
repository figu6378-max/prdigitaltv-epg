/**
 * Split enriched EPG data into two provider-specific subsets.
 * p1Set and p2Set should already include bypass channel IDs before calling.
 * @param {Array} channels
 * @param {Array} programmes
 * @param {Set<string>} p1Set  channel IDs for epg.xml (P1/DINO + bypass)
 * @param {Set<string>} p2Set  channel IDs for epg2.xml (P2/old + bypass)
 * @returns {{ p1: { channels, programmes }, p2: { channels, programmes } }}
 */
export function splitEpgByProvider(channels, programmes, p1Set, p2Set) {
  return {
    p1: {
      channels: channels.filter(c => p1Set.has(c.id)),
      programmes: programmes.filter(p => p1Set.has(p.channel)),
    },
    p2: {
      channels: channels.filter(c => p2Set.has(c.id)),
      programmes: programmes.filter(p => p2Set.has(p.channel)),
    },
  };
}
