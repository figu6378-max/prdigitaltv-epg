import axios from 'axios';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['channel', 'programme', 'display-name', 'icon', 'category'].includes(name),
  allowBooleanAttributes: true,
  processEntities: false,
});

/**
 * Parse an XMLTV XML string into an EpgData object.
 * @param {string} xmlString
 * @returns {{ channels: Array, programmes: Array }}
 */
export function parseXmltvString(xmlString) {
  const parsed = xmlParser.parse(xmlString);
  const tv = parsed.tv || {};

  const rawChannels = tv.channel || [];
  const rawProgrammes = tv.programme || [];

  const channels = rawChannels.map(ch => ({
    id: ch['@_id'] || '',
    displayName: extractText(Array.isArray(ch['display-name']) ? ch['display-name'][0] : ch['display-name']),
    icon: Array.isArray(ch.icon) ? (ch.icon[0]?.['@_src'] || '') : (ch.icon?.['@_src'] || ''),
  }));

  const programmes = rawProgrammes.map(prog => ({
    channel: prog['@_channel'] || '',
    start: prog['@_start'] || '',
    stop: prog['@_stop'] || '',
    title: extractText(prog.title),
    desc: extractText(prog.desc),
    category: extractText(Array.isArray(prog.category) ? prog.category[0] : prog.category),
    icon: Array.isArray(prog.icon) ? (prog.icon[0]?.['@_src'] || '') : (prog.icon?.['@_src'] || ''),
  }));

  return { channels, programmes };
}

/**
 * Extract string text from an XMLTV node (may be plain string or { #text, @_lang }).
 * @param {any} node
 * @returns {string}
 */
function extractText(node) {
  if (Array.isArray(node)) return extractText(node[0]);
  if (!node && node !== 0) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node['#text'] !== undefined) return String(node['#text']);
  return '';
}

/**
 * Download a URL and return the response body as a UTF-8 string.
 * Handles optional gzip decompression.
 * @param {string} url
 * @param {boolean} gzip
 * @returns {Promise<string>}
 */
export async function downloadXmltvUrl(url, gzip = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await axios.get(url, {
      responseType: 'arraybuffer',
      signal: controller.signal,
      headers: { 'User-Agent': 'PRDigitalTV-EPG/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  if (gzip) {
    return decompressGzip(Buffer.from(response.data));
  }
  return Buffer.from(response.data).toString('utf8');
}

/**
 * Decompress a gzip Buffer to a UTF-8 string.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
function decompressGzip(buffer) {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const readable = Readable.from(buffer);
    const chunks = [];
    readable.pipe(gunzip);
    readable.on('error', reject);
    gunzip.on('data', chunk => chunks.push(chunk));
    gunzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    gunzip.on('error', reject);
  });
}

/**
 * Download and parse all enabled secondary EPG sources.
 * Returns a Map keyed by "channelId::titleLower" -> description string.
 * @param {Array<{name, url, enabled, gzip}>} sources
 * @returns {Promise<Map<string, string>>}
 */
export async function buildSecondaryDescMap(sources) {
  const descMap = new Map();
  const active = sources.filter(s => s.enabled);

  await Promise.allSettled(
    active.map(async (source) => {
      try {
        const xml = await downloadXmltvUrl(source.url, source.gzip);
        const { programmes } = parseXmltvString(xml);
        for (const prog of programmes) {
          if (!prog.desc || !prog.title) continue;
          const key = `${prog.channel}::${prog.title.toLowerCase().trim()}`;
          if (!descMap.has(key)) descMap.set(key, prog.desc);
        }
        console.log(`[fetch] ${source.name}: ${programmes.length} programmes loaded`);
      } catch (err) {
        console.warn(`[fetch] ${source.name} unavailable: ${err.message}`);
      }
    })
  );

  return descMap;
}
