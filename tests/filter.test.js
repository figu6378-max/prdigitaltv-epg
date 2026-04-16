import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterEpgData } from '../src/filter.js';

const ALLOWLIST = {
  channels: [
    { 'tvg-id': 'ESPN.us', category: 'sports' },
    { 'tvg-id': 'WAPA.pr', category: 'puerto-rico' },
  ]
};

const EPG_DATA = {
  channels: [
    { id: 'ESPN.us', displayName: 'ESPN', icon: '' },
    { id: 'NHK.jp', displayName: 'NHK', icon: '' },
    { id: 'WAPA.pr', displayName: 'WAPA TV', icon: '' },
    { id: 'CCTV.cn', displayName: 'CCTV', icon: '' },
  ],
  programmes: [
    { channel: 'ESPN.us', start: '20260416010000 +0000', stop: '20260416020000 +0000', title: 'SportsCenter', desc: '', category: '', icon: '' },
    { channel: 'NHK.jp', start: '20260416010000 +0000', stop: '20260416020000 +0000', title: 'NHK News', desc: '', category: '', icon: '' },
    { channel: 'WAPA.pr', start: '20260416010000 +0000', stop: '20260416020000 +0000', title: 'Wapa a las 4', desc: '', category: '', icon: '' },
  ]
};

test('filterEpgData keeps only allowlisted channels', () => {
  const result = filterEpgData(EPG_DATA, ALLOWLIST);
  assert.equal(result.channels.length, 2);
  assert.ok(result.channels.some(c => c.id === 'ESPN.us'));
  assert.ok(result.channels.some(c => c.id === 'WAPA.pr'));
  assert.ok(!result.channels.some(c => c.id === 'NHK.jp'));
  assert.ok(!result.channels.some(c => c.id === 'CCTV.cn'));
});

test('filterEpgData keeps only programmes for allowlisted channels', () => {
  const result = filterEpgData(EPG_DATA, ALLOWLIST);
  assert.equal(result.programmes.length, 2);
  assert.ok(result.programmes.every(p => ['ESPN.us', 'WAPA.pr'].includes(p.channel)));
});

test('filterEpgData attaches category to channel objects', () => {
  const result = filterEpgData(EPG_DATA, ALLOWLIST);
  const espn = result.channels.find(c => c.id === 'ESPN.us');
  assert.equal(espn.category, 'sports');
});

test('filterEpgData handles empty allowlist', () => {
  const result = filterEpgData(EPG_DATA, { channels: [] });
  assert.equal(result.channels.length, 0);
  assert.equal(result.programmes.length, 0);
});
