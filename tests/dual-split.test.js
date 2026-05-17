import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitEpgByProvider } from '../src/split.js';

const ch = (id) => ({ id, displayName: id });
const pr = (channel) => ({ channel, start: '20260517100000 +0000', stop: '20260517110000 +0000', title: 'Test', desc: '' });

test('p1-only channel goes to epg.xml only', () => {
  const channels = [ch('AMC.us')];
  const programmes = [pr('AMC.us')];
  const p1Set = new Set(['AMC.us']);
  const p2Set = new Set();
  const { p1, p2 } = splitEpgByProvider(channels, programmes, p1Set, p2Set);
  assert.equal(p1.channels.length, 1);
  assert.equal(p1.programmes.length, 1);
  assert.equal(p2.channels.length, 0);
  assert.equal(p2.programmes.length, 0);
});

test('p2-only channel goes to epg2.xml only', () => {
  const channels = [ch('HBO.us')];
  const programmes = [pr('HBO.us')];
  const p1Set = new Set();
  const p2Set = new Set(['HBO.us']);
  const { p1, p2 } = splitEpgByProvider(channels, programmes, p1Set, p2Set);
  assert.equal(p1.channels.length, 0);
  assert.equal(p1.programmes.length, 0);
  assert.equal(p2.channels.length, 1);
  assert.equal(p2.programmes.length, 1);
});

test('channel in both providers goes to both outputs', () => {
  const channels = [ch('ESPN.us')];
  const programmes = [pr('ESPN.us')];
  const p1Set = new Set(['ESPN.us']);
  const p2Set = new Set(['ESPN.us']);
  const { p1, p2 } = splitEpgByProvider(channels, programmes, p1Set, p2Set);
  assert.equal(p1.channels.length, 1);
  assert.equal(p2.channels.length, 1);
  assert.equal(p1.programmes.length, 1);
  assert.equal(p2.programmes.length, 1);
});

test('bypass channel in both sets goes to both outputs', () => {
  const channels = [ch('WAPA.pr')];
  const programmes = [pr('WAPA.pr')];
  const p1Set = new Set(['WAPA.pr']);
  const p2Set = new Set(['WAPA.pr']);
  const { p1, p2 } = splitEpgByProvider(channels, programmes, p1Set, p2Set);
  assert.equal(p1.channels.length, 1);
  assert.equal(p2.channels.length, 1);
});

test('channel not in either set is excluded from both outputs', () => {
  const channels = [ch('UNKNOWN.xx')];
  const programmes = [pr('UNKNOWN.xx')];
  const p1Set = new Set();
  const p2Set = new Set();
  const { p1, p2 } = splitEpgByProvider(channels, programmes, p1Set, p2Set);
  assert.equal(p1.channels.length, 0);
  assert.equal(p2.channels.length, 0);
});

test('programmes route to correct provider output', () => {
  const channels = [ch('FOX.us'), ch('NBC.us')];
  const programmes = [pr('FOX.us'), pr('NBC.us')];
  const p1Set = new Set(['FOX.us']);
  const p2Set = new Set(['NBC.us']);
  const { p1, p2 } = splitEpgByProvider(channels, programmes, p1Set, p2Set);
  assert.equal(p1.programmes[0].channel, 'FOX.us');
  assert.equal(p2.programmes[0].channel, 'NBC.us');
});
