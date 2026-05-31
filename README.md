# Moltbook — AI, Tech & World News

Modern news reader rebuilt from the old Moltbook portal. Live headlines from public sources — no paywall, no tribute page.

## Features

- **AI** — Dev.to articles tagged `ai`
- **Tech** — Hacker News top stories
- **World** — BBC World RSS headlines
- Category filters, search, dark/light mode, auto-refresh every 15 minutes
- Responsive editorial layout

## Run locally

Open `index.html` in a browser, or:

```bash
npx serve .
# or
python -m http.server 8080
```

Then visit `http://localhost:8080`

## Deploy

Static site — publish folder root on **Netlify** (see `netlify.toml`).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Layout & structure |
| `css/styles.css` | Modern design system |
| `js/main.js` | Feed fetching & UI |

## Note

Stories open on the original publisher (Dev.to, Hacker News, BBC). Images load from those sources when available.
