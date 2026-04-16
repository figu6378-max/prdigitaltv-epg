import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXmltvString } from '../src/fetch.js';
import { buildDiscoveredChannels } from '../src/discover.js';

const SAMPLE_XMLTV = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="Test">
  <channel id="ESPN.us">
    <display-name lang="en">ESPN</display-name>
    <icon src="https://example.com/espn.png"/>
  </channel>
  <channel id="NHK.jp">
    <display-name lang="en">NHK World</display-name>
  </channel>
  <programme start="20260416010000 +0000" stop="20260416020000 +0000" channel="ESPN.us">
    <title lang="en">SportsCenter</title>
    <desc lang="en">Sports highlights.</desc>
    <category lang="en">Sports</category>
  </programme>
  <programme start="20260416030000 +0000" stop="20260416040000 +0000" channel="NHK.jp">
    <title lang="en">NHK News</title>
  </programme>
</tv>`;

test('parseXmltvString returns channels array with correct fields', () => {
  const result = parseXmltvString(SAMPLE_XMLTV);
  assert.equal(result.channels.length, 2);
  assert.equal(result.channels[0].id, 'ESPN.us');
  assert.equal(result.channels[0].displayName, 'ESPN');
  assert.equal(result.channels[0].icon, 'https://example.com/espn.png');
});

test('parseXmltvString returns programmes array with correct fields', () => {
  const result = parseXmltvString(SAMPLE_XMLTV);
  assert.equal(result.programmes.length, 2);
  assert.equal(result.programmes[0].channel, 'ESPN.us');
  assert.equal(result.programmes[0].title, 'SportsCenter');
  assert.equal(result.programmes[0].desc, 'Sports highlights.');
  assert.equal(result.programmes[0].start, '20260416010000 +0000');
  assert.equal(result.programmes[0].stop, '20260416020000 +0000');
});

test('parseXmltvString returns empty string for missing desc', () => {
  const result = parseXmltvString(SAMPLE_XMLTV);
  const nhkProg = result.programmes.find(p => p.channel === 'NHK.jp');
  assert.equal(nhkProg.desc, '');
});

test('parseXmltvString returns empty string for missing icon', () => {
  const result = parseXmltvString(SAMPLE_XMLTV);
  const nhkCh = result.channels.find(c => c.id === 'NHK.jp');
  assert.equal(nhkCh.icon, '');
});

test('buildDiscoveredChannels deduplicates and sorts channels', () => {
  const epgData = {
    channels: [
      { id: 'ESPN.us', displayName: 'ESPN', icon: '' },
      { id: 'HBO.us', displayName: 'HBO', icon: '' },
      { id: 'ESPN.us', displayName: 'ESPN', icon: '' },
    ],
    programmes: []
  };
  const result = buildDiscoveredChannels(epgData);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { 'tvg-id': 'ESPN.us', displayName: 'ESPN', category: '' });
  assert.deepEqual(result[1], { 'tvg-id': 'HBO.us', displayName: 'HBO', category: '' });
});
