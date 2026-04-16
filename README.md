# PRDigitalTV EPG

Electronic Program Guide for PRDigitalTV — auto-updated every 12 hours via GitHub Actions.

## Client EPG URL

```
https://figu6378-max.github.io/prdigitaltv-epg/epg.xml
```

Add in TiviMate: **Settings > EPG Sources > Add Source > URL**

## Channel Coverage

- **US Premium Sports:** ESPN, FS1, NFL Network, NBA TV, MLB Network, and more
- **US Premium Movies:** HBO, Showtime, Starz, Cinemax, AMC, FX, and more
- **US News:** CNN, Fox News, Telemundo, Univision
- **Puerto Rico:** WAPA, Telemundo PR, Univision PR, TeleOro, WIPR
- **Spain:** TVE, Antena 3, La Sexta, Cuatro, RTVE

## Adding or Removing Channels (Operator)

1. Run discovery to see all available channel IDs from provider:
   ```bash
   PROVIDER_EPG_URL="..." node src/index.js --discover
   ```
2. Review `config/channels-discovered.json`
3. Add or remove entries in `config/channels-allowlist.json`
4. Commit — next run picks up the change automatically

## Manual EPG Refresh

Go to **Actions** tab -> **Update EPG** -> **Run workflow**

## Local Development

```bash
npm install
PROVIDER_EPG_URL="http://..." TMDB_API_KEY="..." node src/index.js
npm test
```

## Tech Stack

Node.js 20 · fast-xml-parser · axios · GitHub Actions · GitHub Pages

**Description sources:** Provider EPG · epgshare01 · epg.pw · TMDB (Spanish) · TVMaze · TheSportsDB
