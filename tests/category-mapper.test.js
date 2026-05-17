import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryMapper } from '../worker/category-mapper.js';

test('strips |XX| prefix before mapping', () => {
  assert.equal(categoryMapper('|NA| USA MOVIES'), 'Movies');
  assert.equal(categoryMapper('|ES| DEPORTES'), 'Sports');
  assert.equal(categoryMapper('|UK| MOVIES'), 'Movies');
});

test('maps movie variants to Movies', () => {
  assert.equal(categoryMapper('USA MOVIES'), 'Movies');
  assert.equal(categoryMapper('CINEMA'), 'Movies');
  assert.equal(categoryMapper('|ES| CINEMA'), 'Movies');
  assert.equal(categoryMapper('M.PELICULAS'), 'Movies');
});

test('maps sport variants to Sports', () => {
  assert.equal(categoryMapper('|NA| USA SPORTS'), 'Sports');
  assert.equal(categoryMapper('NFL'), 'Sports');
  assert.equal(categoryMapper('NHL'), 'Sports');
  assert.equal(categoryMapper('MLS'), 'Sports');
  assert.equal(categoryMapper('|ES| DEPORTES'), 'Sports');
});

test('NBA stays NBA, not Sports', () => {
  assert.equal(categoryMapper('|NA| USA NBA'), 'NBA');
  assert.equal(categoryMapper('NBA'), 'NBA');
});

test('MLB stays MLB, not Sports', () => {
  assert.equal(categoryMapper('|NA| USA MLB'), 'MLB');
  assert.equal(categoryMapper('MILB'), 'MLB');
  assert.equal(categoryMapper('MLB'), 'MLB');
});

test('WNBA stays WNBA, not NBA or Sports', () => {
  assert.equal(categoryMapper('|NA| USA WNBA'), 'WNBA');
  assert.equal(categoryMapper('WNBA'), 'WNBA');
  assert.notEqual(categoryMapper('|NA| USA WNBA'), 'NBA');
});

test('maps news variants to News', () => {
  assert.equal(categoryMapper('|NA| USA NEWS'), 'News');
  assert.equal(categoryMapper('NOTICIAS'), 'News');
});

test('maps kids variants to Kids', () => {
  assert.equal(categoryMapper('|NA| USA KIDS'), 'Kids');
  assert.equal(categoryMapper('NIÑOS'), 'Kids');
});

test('maps adults to Adults', () => {
  assert.equal(categoryMapper('FOR ADULTS'), 'Adults');
});

test('maps general/entertainment to Entertainment', () => {
  assert.equal(categoryMapper('|NA| USA GENERAL'), 'Entertainment');
  assert.equal(categoryMapper('|UK| GENERAL'), 'Entertainment');
  assert.equal(categoryMapper('GENERAL'), 'Entertainment');
});

test('maps PPV to PPV', () => {
  assert.equal(categoryMapper('|NA| USA DAZN PPV'), 'PPV');
  assert.equal(categoryMapper('PPV LIVE EVENT'), 'PPV');
});

test('maps España variants', () => {
  assert.equal(categoryMapper('|ES| GENERAL'), 'España');
  assert.equal(categoryMapper('TIVIFY'), 'España');
  assert.equal(categoryMapper('ESPAÑA HEVC'), 'España');
});

test('maps UK variants', () => {
  assert.equal(categoryMapper('|UK| ENTERTAINMENT'), 'UK');
  assert.equal(categoryMapper('|IE| IRELAND'), 'UK');
  assert.equal(categoryMapper('|UK| GENERAL'), 'Entertainment');
});

test('maps Canada', () => {
  assert.equal(categoryMapper('|AM| CANADA'), 'Canada');
});

test('maps Latin/Caribbean to Latino', () => {
  assert.equal(categoryMapper('|SA| CARRIBEAN'), 'Latino');
  assert.equal(categoryMapper('|SA| LATINO'), 'Latino');
});

test('maps documentary', () => {
  assert.equal(categoryMapper('|UK| DOCUMENTARY'), 'Documentary');
  assert.equal(categoryMapper('DOCUMENTALES'), 'Documentary');
});

test('maps music', () => {
  assert.equal(categoryMapper('|UK| MUSIC'), 'Music');
});

test('maps series/telenovela to Series', () => {
  assert.equal(categoryMapper('SERIES'), 'Series');
});

test('empty/null falls back to Entertainment', () => {
  assert.equal(categoryMapper(''), 'Entertainment');
  assert.equal(categoryMapper(null), 'Entertainment');
  assert.equal(categoryMapper(undefined), 'Entertainment');
});
