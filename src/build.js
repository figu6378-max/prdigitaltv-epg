import { XMLBuilder } from 'fast-xml-parser';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  processEntities: true,
});

/**
 * Build a valid XMLTV XML string from filtered and enriched EPG data.
 * @param {{ channels: Array, programmes: Array }} epgData
 * @returns {string}
 */
export function buildXmltvString(epgData) {
  const obj = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    tv: {
      '@_generator-info-name': 'PRDigitalTV EPG',
      channel: epgData.channels.map(ch => {
        const node = {
          '@_id': ch.id,
          'display-name': { '@_lang': 'es', '#text': ch.displayName },
        };
        if (ch.icon) node.icon = { '@_src': ch.icon };
        return node;
      }),
      programme: epgData.programmes.map(prog => {
        const node = {
          '@_start': prog.start,
          '@_stop': prog.stop,
          '@_channel': prog.channel,
          title: { '@_lang': 'es', '#text': prog.title },
        };
        if (prog.desc) node.desc = { '@_lang': 'es', '#text': prog.desc };
        if (prog.category) node.category = { '@_lang': 'es', '#text': prog.category };
        if (prog.icon) node.icon = { '@_src': prog.icon };
        return node;
      }),
    },
  };

  let raw = xmlBuilder.build(obj);
  // Normalize XML declaration — fast-xml-parser may format it differently
  raw = raw.replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>');

  // Handle empty data: convert self-closing tv tag to opening/closing pair
  if (epgData.channels.length === 0 && epgData.programmes.length === 0) {
    raw = raw.replace(/<tv[^>]*\/>/, '<tv generator-info-name="PRDigitalTV EPG"></tv>');
  }

  return raw;
}

/**
 * Write EPG data to output/epg.xml with basic validation.
 * Returns true on success, false on failure (caller keeps previous version).
 * @param {{ channels: Array, programmes: Array }} epgData
 * @returns {boolean}
 */
export function writeEpgFile(epgData, filename = 'epg.xml') {
  if (!existsSync('output')) mkdirSync('output');

  try {
    const xml = buildXmltvString(epgData);
    if (!xml.includes('<tv') || !xml.includes('</tv>')) {
      throw new Error('XML validation failed: missing <tv> root element');
    }
    writeFileSync(`output/${filename}`, xml, 'utf8');
    console.log(`[build] output/${filename} written — ${epgData.channels.length} channels, ${epgData.programmes.length} programmes`);
    return true;
  } catch (err) {
    console.error(`[build] Write failed: ${err.message}`);
    return false;
  }
}
