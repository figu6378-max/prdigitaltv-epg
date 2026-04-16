import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildXmltvString } from '../src/build.js';

const SAMPLE = {
  channels: [
    { id: 'ESPN.us', displayName: 'ESPN', icon: 'https://example.com/espn.png', category: 'sports' }
  ],
  programmes: [
    {
      channel: 'ESPN.us',
      start: '20260416010000 +0000',
      stop: '20260416020000 +0000',
      title: 'SportsCenter',
      desc: 'Latest sports highlights.',
      category: 'Sports',
      icon: ''
    }
  ]
};

test('buildXmltvString starts with XML declaration', () => {
  const xml = buildXmltvString(SAMPLE);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
});

test('buildXmltvString includes channel id attribute', () => {
  const xml = buildXmltvString(SAMPLE);
  assert.ok(xml.includes('id="ESPN.us"'));
});

test('buildXmltvString includes channel display name', () => {
  const xml = buildXmltvString(SAMPLE);
  assert.ok(xml.includes('ESPN'));
});

test('buildXmltvString includes programme with start/stop/channel', () => {
  const xml = buildXmltvString(SAMPLE);
  assert.ok(xml.includes('start="20260416010000 +0000"'));
  assert.ok(xml.includes('stop="20260416020000 +0000"'));
  assert.ok(xml.includes('channel="ESPN.us"'));
});

test('buildXmltvString includes programme title and description', () => {
  const xml = buildXmltvString(SAMPLE);
  assert.ok(xml.includes('SportsCenter'));
  assert.ok(xml.includes('Latest sports highlights.'));
});

test('buildXmltvString handles empty data without crashing', () => {
  const xml = buildXmltvString({ channels: [], programmes: [] });
  assert.ok(xml.includes('<tv'));
  assert.ok(xml.includes('</tv>'));
});
