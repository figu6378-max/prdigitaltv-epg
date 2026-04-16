import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectProgrammeType,
  formatSportsDescription,
  extractTitleAndYear,
} from '../src/enrich.js';

test('detectProgrammeType identifies sports by keyword', () => {
  assert.equal(detectProgrammeType('NFL Sunday Night Football'), 'sports');
  assert.equal(detectProgrammeType('NBA Basketball: Lakers vs Celtics'), 'sports');
  assert.equal(detectProgrammeType('UFC 300 Main Card'), 'sports');
  assert.equal(detectProgrammeType('MLB Baseball'), 'sports');
  assert.equal(detectProgrammeType('MLS Soccer'), 'sports');
});

test('detectProgrammeType identifies movies by year in title', () => {
  assert.equal(detectProgrammeType('The Dark Knight (2008)'), 'movie');
  assert.equal(detectProgrammeType('Spider-Man: No Way Home (2021)'), 'movie');
});

test('detectProgrammeType identifies TV series by SxxExx pattern', () => {
  assert.equal(detectProgrammeType('Breaking Bad S01E03'), 'series');
  assert.equal(detectProgrammeType('Game of Thrones S08E06'), 'series');
});

test('detectProgrammeType returns unknown for unmatched titles', () => {
  assert.equal(detectProgrammeType('Noticentro Al Amanecer'), 'unknown');
  assert.equal(detectProgrammeType('Avengers: Endgame'), 'unknown');
});

test('formatSportsDescription formats matchup correctly', () => {
  const event = {
    strHomeTeam: 'Dallas Cowboys',
    strAwayTeam: 'Philadelphia Eagles',
    strLeague: 'NFL',
    strSport: 'American Football',
  };
  const desc = formatSportsDescription(event);
  assert.ok(desc.includes('Dallas Cowboys'));
  assert.ok(desc.includes('Philadelphia Eagles'));
  assert.ok(desc.includes('NFL'));
});

test('formatSportsDescription handles missing teams gracefully', () => {
  const event = { strHomeTeam: null, strAwayTeam: null, strLeague: 'NFL', strSport: 'American Football' };
  const desc = formatSportsDescription(event);
  assert.equal(desc, 'NFL');
});

test('extractTitleAndYear extracts year from parentheses', () => {
  const result = extractTitleAndYear('The Batman (2022)');
  assert.equal(result.title, 'The Batman');
  assert.equal(result.year, '2022');
});

test('extractTitleAndYear returns null year when no year present', () => {
  const result = extractTitleAndYear('SportsCenter');
  assert.equal(result.title, 'SportsCenter');
  assert.equal(result.year, null);
});
