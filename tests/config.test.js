import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('sources.json has valid structure', () => {
  const sources = JSON.parse(readFileSync('config/sources.json', 'utf8'));
  assert.ok(Array.isArray(sources.secondary), 'sources.secondary must be array');
  for (const s of sources.secondary) {
    assert.ok(s.name, `source missing name`);
    assert.ok(s.url, `source ${s.name} missing url`);
    assert.ok(typeof s.enabled === 'boolean', `source ${s.name} enabled must be boolean`);
    assert.ok(typeof s.gzip === 'boolean', `source ${s.name} gzip must be boolean`);
  }
});

test('channels-allowlist.json has valid structure', () => {
  const allow = JSON.parse(readFileSync('config/channels-allowlist.json', 'utf8'));
  assert.ok(Array.isArray(allow.channels), 'channels must be array');
  for (const ch of allow.channels) {
    assert.ok(ch['tvg-id'], `channel missing tvg-id: ${JSON.stringify(ch)}`);
    assert.ok(ch.category, `channel ${ch['tvg-id']} missing category`);
  }
});
