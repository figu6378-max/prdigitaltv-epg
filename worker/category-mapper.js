// Ordered rules: first match wins. More specific patterns before generic.
const RULES = [
  [/WNBA/i,                                                        'WNBA'],
  [/\bNBA\b|BASKETBALL/i,                                          'NBA'],
  [/\bMLB\b|\bMILB\b|BASEBALL/i,                                   'MLB'],
  [/MOVIE|CINEMA|PEL[IÍ]CULAS|PELICULAS|FILM|\bM\.?PELICULAS\b/i, 'Movies'],
  [/\bNFL\b|FOOTBALL/i,                                            'Sports'],
  [/\bNHL\b|HOCKEY/i,                                              'Sports'],
  [/\bMLS\b|\bSOCCER\b|F[ÚU]TBOL/i,                               'Sports'],
  [/SPORT|DEPORT/i,                                                'Sports'],
  [/\bNEWS\b|NOTICIAS/i,                                           'News'],
  [/\bKIDS\b|NI[ÑN]OS|INFANT/i,                                   'Kids'],
  [/ADULT/i,                                                       'Adults'],
  [/DOCUMENTARY|DOCUMENTAL/i,                                      'Documentary'],
  [/MUSIC|M[ÚU]SICA/i,                                             'Music'],
  [/\bSERIES\b|TELENOVELA/i,                                       'Series'],
  [/\bPPV\b|\bEVENTS?\b/i,                                         'PPV'],
  // Region prefixes with content type keywords
  [/\|UK\|.*ENTERTAINMENT/i,                                       'UK'],
  [/\|IE\||IRELAND/i,                                              'UK'],
  // España must come before generic GENERAL (España can override GENERAL)
  [/TIVIFY|ESPA[ÑN]A|SPAIN|\|ES\|/i,                              'España'],
  [/GENERAL|ENTERTAINMENT|ENTRETENIMIENTO/i,                       'Entertainment'],
  // Generic regions at end
  [/CANADA/i,                                                      'Canada'],
  [/LATINO|CARIBBEAN|CARRIBEAN|LATIN/i,                            'Latino'],
];

/**
 * Map a raw provider category string to a canonical vocabulary label.
 * Strips |XX| prefix first, then matches rules in order (first wins).
 * Falls back to 'Entertainment'.
 * @param {string|null|undefined} rawCat
 * @returns {string}
 */
export function categoryMapper(rawCat) {
  if (!rawCat) return 'Entertainment';
  // Strip |XX| prefix e.g. "|NA| USA MOVIES" → "USA MOVIES"
  const stripped = rawCat.replace(/^\|[^|]+\|\s*/, '').trim();
  const src = stripped || rawCat;
  // Test against original too for patterns like |ES| GENERAL → España
  for (const [re, label] of RULES) {
    if (re.test(src) || re.test(rawCat)) return label;
  }
  return 'Entertainment';
}
