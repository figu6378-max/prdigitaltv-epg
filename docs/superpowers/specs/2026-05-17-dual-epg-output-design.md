# Dual EPG Output Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two separate EPG files — `output/epg.xml` (P1/DINO channel IDs) and `output/epg2.xml` (P2/old provider channel IDs) — so each provider's M3U clients get an EPG that matches their channel ID space exactly.

**Architecture:** During fetch, collect `p1ChannelIds` (DINO) and `p2ChannelIds` (old provider) as Sets. Run enrichment once on the merged programme set. After enrichment, split channels and programmes by provider membership and write two files. Bypass channels (open-epg-pr, WKAQ.pr, WAPA.pr etc.) go into both outputs. No duplicate API calls.

**Tech Stack:** Node.js ESM, `fast-xml-parser`, existing `src/build.js` / `src/index.js`

---

## Provider Channel ID Spaces

| Provider | EPG URL | Allowlist coverage | Worker route |
|---|---|---|---|
| P1 (DINO) | `PROVIDER_EPG_URL_2` | 304 / 700 channels | `/playlist2` → `epg.xml` |
| P2 (old) | `PROVIDER_EPG_URL` | 649 / 700 channels | `/playlist` → `epg2.xml` |

Channels in both providers: appear in both outputs (same channel ID, same enriched programmes).
Bypass channels (open-epg-pr): appear in both outputs regardless of provider membership.

---

## Data Flow

```
1. Fetch P1 (DINO)      → providerEpg, record p1ChannelIds Set
2. Fetch P2 (old)       → gap-fill merge, record p2ChannelIds Set
3. primary_additional   → merge into providerEpg, record bypassChannelIds Set
4. Filter / dedup / purge / channel-aliases / enrich  (unchanged)
5. Split output:
     epg.xml  = channels ∈ (p1ChannelIds ∪ bypassChannelIds) + programmes for those channels
     epg2.xml = channels ∈ (p2ChannelIds ∪ bypassChannelIds) + programmes for those channels
```

---

## File Changes

### `src/build.js`
- Add optional `filename` param to `writeEpgFile(epgData, filename = 'epg.xml')`
- `writeFileSync(`output/${filename}`, xml, 'utf8')`
- Log message uses filename instead of hardcoded path

### `src/index.js`
- After P1 fetch: `const p1ChannelIds = new Set(providerEpg.channels.map(c => c.id))`
- After P2 gap-fill merge: `const p2ChannelIds = new Set(epg1.channels.map(c => c.id))`
- After primary_additional merge: `bypassChannelIds` already exists as `additionalBypassIds`
- After cross-channel desc share (current final step), add split + dual write:

```js
// Split by provider
const p1Set = new Set([...p1ChannelIds, ...additionalBypassIds]);
const p2Set = new Set([...p2ChannelIds, ...additionalBypassIds]);

const p1Channels = filtered.channels.filter(c => p1Set.has(c.id));
const p2Channels = filtered.channels.filter(c => p2Set.has(c.id));
const p1Programmes = finalProgrammes.filter(p => p1Set.has(p.channel));
const p2Programmes = finalProgrammes.filter(p => p2Set.has(p.channel));

writeEpgFile({ channels: p1Channels, programmes: p1Programmes }, 'epg.xml');
writeEpgFile({ channels: p2Channels, programmes: p2Programmes }, 'epg2.xml');
```

- Remove existing single `writeEpgFile` call

**Edge cases:**
- If P1 fetch fails entirely, `p1ChannelIds` is empty → `epg.xml` gets only bypass channels (acceptable — P1 was down)
- If P2 fetch fails entirely, `p2ChannelIds` is empty → `epg2.xml` gets only bypass channels
- Channel in both providers → same enriched programmes in both files

### `.github/workflows/update-epg.yml`
- Commit step: also copy `output/epg2.xml` → `epg2.xml` and add to git
- SMS message: include P1 channels + P2 channels counts separately
- Parse both from pipeline log (`p1Channels` and `p2Channels` counts logged at build step)

---

## Logging

Pipeline should log at build time:
```
[build] epg.xml  — 320 channels, 8400 programmes  (P1 + bypass)
[build] epg2.xml — 650 channels, 18200 programmes (P2 + bypass)
```

---

## Testing

- Unit test: `writeEpgFile` accepts filename param, writes to correct path
- Unit test: split logic — channel in p1Only goes to epg.xml only; channel in p2Only goes to epg2.xml only; channel in both goes to both; bypass channel goes to both
- Existing build tests must still pass

---

## CI / GitHub Pages

Both `epg.xml` and `epg2.xml` committed to repo root → served via GitHub Pages:
- `https://figu6378-max.github.io/prdigitaltv-epg/epg.xml`
- `https://figu6378-max.github.io/prdigitaltv-epg/epg2.xml`

Worker `wrangler.toml` EPG URL env vars already point to correct files per route — no worker changes needed.
