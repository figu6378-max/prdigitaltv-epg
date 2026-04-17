import axios from 'axios';

const SPORTS_RE = /\b(NFL|NBA|MLB|NHL|MLS|UFC|boxing|soccer|football|basketball|baseball|hockey|tennis|golf|wrestling|NASCAR|F1|Formula)\b/i;
const SERIES_RE = /S\d{1,2}E\d{1,2}/i;
const MOVIE_YEAR_RE = /\((\d{4})\)/;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const SPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';
const TVMAZE_BASE = 'https://api.tvmaze.com';

// In-memory caches per pipeline run to avoid duplicate API calls
const tmdbCache = new Map();
const tvmazeCache = new Map();
const sportsCache = new Map();

/**
 * Detect the likely type of a programme from its title.
 * @param {string} title
 * @returns {'sports'|'movie'|'series'|'unknown'}
 */
export function detectProgrammeType(title) {
  if (SPORTS_RE.test(title)) return 'sports';
  if (SERIES_RE.test(title)) return 'series';
  if (MOVIE_YEAR_RE.test(title)) return 'movie';
  return 'unknown';
}

/**
 * Extract the clean title and optional year from a movie title string.
 * e.g. "The Batman (2022)" -> { title: "The Batman", year: "2022" }
 * @param {string} title
 * @returns {{ title: string, year: string|null }}
 */
export function extractTitleAndYear(title) {
  const match = title.match(MOVIE_YEAR_RE);
  if (match) {
    return { title: title.replace(MOVIE_YEAR_RE, '').trim(), year: match[1] };
  }
  return { title, year: null };
}

/**
 * Format a TheSportsDB event object into a Spanish-style description string.
 * @param {{ strHomeTeam, strAwayTeam, strLeague, strSport, strVenue, strSeason, intHomeScore, intAwayScore }} event
 * @returns {string}
 */
export function formatSportsDescription(event) {
  if (!event.strHomeTeam && !event.strAwayTeam) {
    return event.strLeague || event.strSport || '';
  }
  const score = (event.intHomeScore != null && event.intAwayScore != null)
    ? ` (${event.intHomeScore}-${event.intAwayScore})`
    : '';
  const venue = event.strVenue ? ` | ${event.strVenue}` : '';
  const season = event.strSeason ? ` | Temporada ${event.strSeason}` : '';
  return `${event.strHomeTeam} vs ${event.strAwayTeam}${score} \u2014 ${event.strLeague}${venue}${season}`;
}

/**
 * Look up a sports event from TheSportsDB by date extracted from XMLTV start field.
 * @param {string} title - programme title (used to detect sport type)
 * @param {string} xmltvStart - e.g. "20260416010000 +0000"
 * @returns {Promise<string>}
 */
export async function lookupSportsDescription(title, xmltvStart) {
  if (!xmltvStart) return '';
  const date = `${xmltvStart.slice(0,4)}-${xmltvStart.slice(4,6)}-${xmltvStart.slice(6,8)}`;
  const SPORT_MAP = {
    NFL: 'American Football', NBA: 'Basketball', MLB: 'Baseball',
    NHL: 'Ice Hockey', MLS: 'Soccer', soccer: 'Soccer',
    football: 'American Football', basketball: 'Basketball',
    baseball: 'Baseball', hockey: 'Ice Hockey', tennis: 'Tennis',
    golf: 'Golf', UFC: 'MMA', boxing: 'Boxing',
  };

  let sport = 'Soccer';
  for (const [kw, sp] of Object.entries(SPORT_MAP)) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(title)) { sport = sp; break; }
  }

  const cacheKey = `${date}::${sport}`;
  if (!sportsCache.has(cacheKey)) {
    try {
      const res = await axios.get(`${SPORTSDB_BASE}/eventsday.php`, {
        params: { d: date, s: sport },
        timeout: 10000,
      });
      sportsCache.set(cacheKey, res.data?.events || []);
    } catch {
      sportsCache.set(cacheKey, []);
    }
  }

  const events = sportsCache.get(cacheKey);
  if (!events?.length) return '';

  const lower = title.toLowerCase();
  const match = events.find(e =>
    (e.strHomeTeam && lower.includes(e.strHomeTeam.toLowerCase())) ||
    (e.strAwayTeam && lower.includes(e.strAwayTeam.toLowerCase()))
  ) || events[0];

  return formatSportsDescription(match);
}

/**
 * Look up Spanish movie description + rating from TMDB API.
 * @param {string} title
 * @param {string|null} year
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function lookupMovieDescription(title, year, apiKey) {
  if (!apiKey) return '';
  const cacheKey = `${title}::${year}`;
  if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

  try {
    const params = { api_key: apiKey, query: title, language: 'es-419' };
    if (year) params.year = year;
    const res = await axios.get(`${TMDB_BASE}/search/movie`, { params, timeout: 10000 });
    const result = res.data?.results?.[0];
    if (!result) { tmdbCache.set(cacheKey, ''); return ''; }
    const overview = result.overview || '';
    const rating = result.vote_average ? ` ★ ${result.vote_average.toFixed(1)}/10` : '';
    const desc = overview ? `${overview}${rating}` : '';
    tmdbCache.set(cacheKey, desc);
    return desc;
  } catch {
    tmdbCache.set(cacheKey, '');
    return '';
  }
}

/**
 * Look up Spanish TV series description + rating from TMDB API.
 * @param {string} title
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function lookupTvDescription(title, apiKey) {
  if (!apiKey) return '';
  const showName = title.replace(SERIES_RE, '').trim();
  const cacheKey = `tv::${showName}`;
  if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

  try {
    const res = await axios.get(`${TMDB_BASE}/search/tv`, {
      params: { api_key: apiKey, query: showName, language: 'es-419' },
      timeout: 10000,
    });
    const result = res.data?.results?.[0];
    if (!result) { tmdbCache.set(cacheKey, ''); return ''; }
    const overview = result.overview || '';
    const rating = result.vote_average ? ` ★ ${result.vote_average.toFixed(1)}/10` : '';
    const desc = overview ? `${overview}${rating}` : '';
    tmdbCache.set(cacheKey, desc);
    return desc;
  } catch {
    tmdbCache.set(cacheKey, '');
    return '';
  }
}

/**
 * Look up TV series description from TVMaze (free, no key required).
 * Strips HTML tags from the TVMaze summary field.
 * @param {string} title
 * @returns {Promise<string>}
 */
export async function lookupSeriesDescription(title) {
  const showName = title.replace(SERIES_RE, '').trim();
  if (tvmazeCache.has(showName)) return tvmazeCache.get(showName);

  try {
    const res = await axios.get(`${TVMAZE_BASE}/singlesearch/shows`, {
      params: { q: showName },
      timeout: 10000,
    });
    const summary = (res.data?.summary || '').replace(/<[^>]+>/g, '');
    tvmazeCache.set(showName, summary);
    return summary;
  } catch {
    tvmazeCache.set(showName, '');
    return '';
  }
}

/**
 * Enrich a single programme using the waterfall strategy:
 * 1. Existing description -> keep
 * 2. Secondary EPG map match -> use
 * 3. Sports -> TheSportsDB
 * 4. Movie -> TMDB (Spanish)
 * 5. Series -> TVMaze
 * 6. Fallback -> programme title
 * @param {Object} programme
 * @param {Map<string, string>} secondaryDescMap
 * @param {string} tmdbApiKey
 * @returns {Promise<Object>}
 */
export async function enrichProgramme(programme, secondaryDescMap, tmdbApiKey) {
  if (programme.desc?.trim()) return programme;

  const secKey = programme.title.toLowerCase().trim();
  const secDesc = secondaryDescMap.get(secKey);
  if (secDesc) return { ...programme, desc: secDesc };

  const type = detectProgrammeType(programme.title);

  if (type === 'sports') {
    const desc = await lookupSportsDescription(programme.title, programme.start);
    if (desc) return { ...programme, desc };
  }

  if (type === 'movie') {
    const { title, year } = extractTitleAndYear(programme.title);
    const desc = await lookupMovieDescription(title, year, tmdbApiKey);
    if (desc) return { ...programme, desc };
  }

  if (type === 'series') {
    const tmdbDesc = await lookupTvDescription(programme.title, tmdbApiKey);
    if (tmdbDesc) return { ...programme, desc: tmdbDesc };
    const desc = await lookupSeriesDescription(programme.title);
    if (desc) return { ...programme, desc };
  }

  if (type === 'unknown') {
    const tmdbDesc = await lookupTvDescription(programme.title, tmdbApiKey);
    if (tmdbDesc) return { ...programme, desc: tmdbDesc };
  }

  return { ...programme, desc: programme.title };
}

/**
 * Enrich all programmes in batches, respecting TMDB rate limit (40 req/10s).
 * @param {Array} programmes
 * @param {Map<string, string>} secondaryDescMap
 * @param {string} tmdbApiKey
 * @returns {Promise<Array>}
 */
export async function enrichAllProgrammes(programmes, secondaryDescMap, tmdbApiKey) {
  const BATCH = 20;
  const DELAY = 300; // ms between batches
  const results = [];

  for (let i = 0; i < programmes.length; i += BATCH) {
    const batch = programmes.slice(i, i + BATCH);
    const enriched = await Promise.all(
      batch.map(p => enrichProgramme(p, secondaryDescMap, tmdbApiKey))
    );
    results.push(...enriched);
    if (i + BATCH < programmes.length) {
      await new Promise(r => setTimeout(r, DELAY));
    }
    if (i % 500 === 0 && i > 0) {
      console.log(`[enrich] ${i}/${programmes.length} processed`);
    }
  }

  return results;
}
