#!/usr/bin/env node
/**
 * review-channels.js
 *
 * EXPORT: node review-channels.js export
 *   → writes channel-review.csv (tvg-id, display-name, category, NewDisplayName, NewCategory)
 *     All discovered channels; category pre-filled from allowlist (blank = not in allowlist).
 *
 * IMPORT: node review-channels.js import [csv]
 *   5-column CSV (with NewDisplayName/NewCategory): NewCategory wins over old category.
 *   3-column CSV: uses category column directly.
 *   blank category → remove from allowlist if present.
 *   Skips suffixes with no EPG source: .qa .in .cz .ae .fr .mn
 *   Normalizes "ESPANA GENERAL" → "ESPAÑA GENERAL"
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const ALLOWLIST_PATH = resolve('config/channels-allowlist.json');
const DISCOVERED_PATH = resolve('config/channels-discovered.json');
const DEFAULT_CSV = resolve('channel-review.csv');

const SKIP_SUFFIXES = new Set(['qa', 'in', 'cz', 'ae', 'fr', 'mn']);

const [, , mode, csvArg] = process.argv;

if (mode === 'export') {
  doExport();
} else if (mode === 'import') {
  doImport(csvArg || DEFAULT_CSV);
} else {
  console.error('Usage:\n  node review-channels.js export\n  node review-channels.js import [csv]');
  process.exit(1);
}

function doExport() {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  const discovered = JSON.parse(readFileSync(DISCOVERED_PATH, 'utf8'));

  const allowlistMap = {};
  for (const ch of allowlist.channels) {
    allowlistMap[ch['tvg-id']] = ch;
  }

  const channels = Array.isArray(discovered) ? discovered : (discovered.channels || []);

  const seen = new Set();
  const rows = ['tvg-id,display-name,category,NewDisplayName,NewCategory'];

  for (const ch of channels) {
    const id = ch['tvg-id'] || ch.tvgId || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = ch.displayName || ch['display-name'] || id;
    const existing = allowlistMap[id];
    const cat = existing ? (existing.category || '') : '';
    rows.push(`${csvEscape(id)},${csvEscape(name)},${csvEscape(cat)},,`);
  }

  writeFileSync(DEFAULT_CSV, rows.join('\n') + '\n', 'utf8');
  const inAllowlist = Object.keys(allowlistMap).length;
  console.log(`Exported ${rows.length - 1} channels → channel-review.csv (${inAllowlist} already in allowlist)`);
}

async function doImport(csvPath) {
  const updates = new Map(); // tvgId → { displayName, cat }

  const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
  let header = true;
  let skipped = 0;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    if (!line.trim()) continue;
    const cols = parseCsvRow(line);
    const id = (cols[0] || '').trim();
    if (!id) continue;

    const suffix = (id.split('.').pop() || '').toLowerCase();
    if (SKIP_SUFFIXES.has(suffix)) { skipped++; continue; }

    const oldCat = (cols[2] || '').trim();
    const newDisplayName = (cols[3] || '').trim();
    const newCat = (cols[4] || '').trim();

    let cat = newCat || oldCat;
    if (cat.toUpperCase() === 'ESPANA GENERAL') cat = 'ESPAÑA GENERAL';

    updates.set(id, { displayName: newDisplayName, cat });
  }

  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));

  const existing = new Map();
  for (const ch of allowlist.channels) {
    if (!existing.has(ch['tvg-id'])) existing.set(ch['tvg-id'], ch);
  }

  let added = 0, updated = 0, removed = 0;

  for (const [id, { displayName, cat }] of updates) {
    if (cat === '') {
      if (existing.has(id)) { existing.delete(id); removed++; }
    } else if (!existing.has(id)) {
      const entry = { 'tvg-id': id, category: cat };
      if (displayName) entry.displayName = displayName;
      existing.set(id, entry);
      added++;
    } else {
      const ex = existing.get(id);
      let changed = false;
      if (ex.category !== cat) { ex.category = cat; changed = true; }
      if (displayName && ex.displayName !== displayName) { ex.displayName = displayName; changed = true; }
      if (changed) updated++;
    }
  }

  allowlist.channels = Array.from(existing.values());
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(allowlist, null, 2) + '\n', 'utf8');
  console.log(`Import done → added ${added}, updated ${updated}, removed ${removed}, skipped ${skipped} (no EPG source)`);
}

function csvEscape(val) {
  val = String(val ?? '');
  if (/[,"\n]/.test(val)) return `"${val.replace(/"/g, '""')}"`;
  return val;
}

function parseCsvRow(line) {
  const cols = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { cols.push(cur); cur = ''; }
      else cur += c;
    }
  }
  cols.push(cur);
  return cols;
}
