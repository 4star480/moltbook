# Moltbook — AI, Tech & World News

Modern news reader with the classic **Moltbook / OpenClaw** claw branding. Headlines refresh **every 10 minutes** from the web, with an optional **Gemini AI** intelligence brief.

## Features

- **AI** — Dev.to (`ai` tag)
- **Tech** — Hacker News top stories  
- **World** — BBC World RSS
- Orange claw logo, elegant typography (Cormorant Garamond + Outfit)
- Works when opened as `index.html` (uses bundled `data/news.json`)
- On Netlify: live `/api/news` function + build-time refresh

## Run locally

```bash
node scripts/refresh-news.mjs   # fetch latest + optional Gemini brief
python -m http.server 8080
# open http://localhost:8080
```

Or open `index.html` directly — stories load from `data/news.json`.

## Auto-refresh

- Browser polls every **10 minutes**
- Netlify build runs `node scripts/refresh-news.mjs`
- Set `GEMINI_API_KEY` in Netlify env for AI-written briefs

## Deploy

Push to GitHub and connect on Netlify. Add environment variable:

`GEMINI_API_KEY` — your Google AI Studio key (optional)
