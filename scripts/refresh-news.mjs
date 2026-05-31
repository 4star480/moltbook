/**
 * Fetches AI / tech / world headlines and writes data/news.json.
 * Optional Gemini brief when GEMINI_API_KEY or ~/.cursor/secrets/google-gemini.json exists.
 *
 * Usage: node scripts/refresh-news.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { enrichStoryImages, shouldGenerateImage, upgradePublisherImageUrl } from "../lib/story-images.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const OUT = join(ROOT, "data", "news.json");

function loadDotEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadDotEnv();

const RSS_SOURCES = [
  (url) => "https://corsproxy.io/?" + encodeURIComponent(url),
  (url) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
];
const BBC_WORLD_RSS = "https://feeds.bbci.co.uk/news/world/rss.xml";

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function loadGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const p = join(homedir(), ".cursor", "secrets", "google-gemini.json");
    const j = JSON.parse(readFileSync(p, "utf8"));
    return j.api_key || j.API_KEY || null;
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchAiStories() {
  const data = await fetchJson("https://dev.to/api/articles?tag=ai&per_page=15");
  return data.map((a) => ({
    id: `ai-${a.id}`,
    title: a.title,
    url: a.url,
    excerpt: stripHtml(a.description || "").slice(0, 220),
    source: "Dev.to",
    category: "ai",
    time: new Date(a.published_at).getTime(),
    image: a.cover_image || a.social_image || null,
  }));
}

async function fetchTechStories() {
  const ids = await fetchJson("https://hacker-news.firebaseio.com/v0/topstories.json");
  const items = await Promise.all(
    ids.slice(0, 18).map((id) =>
      fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
    )
  );
  return items.filter(Boolean).map((item) => ({
    id: `hn-${item.id}`,
    title: item.title,
    url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
    excerpt: `Hacker News · ${item.score ?? 0} pts · ${item.descendants ?? 0} comments`,
    source: "Hacker News",
    category: "tech",
    time: (item.time || 0) * 1000,
    image: null,
  }));
}

async function fetchWorldStories() {
  let xmlText = null;

  // Node / serverless: direct RSS (no CORS)
  try {
    const res = await fetch(BBC_WORLD_RSS, {
      headers: { "User-Agent": "MoltbookNews/1.0" },
    });
    if (res.ok) xmlText = await res.text();
  } catch {
    /* fall through to proxies */
  }

  if (!xmlText?.includes("<item")) {
    for (const proxy of RSS_SOURCES) {
      try {
        const res = await fetch(proxy(BBC_WORLD_RSS));
        if (!res.ok) continue;
        xmlText = await res.text();
        if (xmlText?.includes("<item")) break;
      } catch {
        /* next */
      }
    }
  }
  if (!xmlText) throw new Error("BBC RSS unavailable");

  const items = [...xmlText.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 15);
  return items.map((m, i) => {
    const block = m[1];
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1] ||
      block.match(/<title>(.*?)<\/title>/)?.[1] || "Untitled";
    const link = block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || "#";
    const desc = stripHtml(
      block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/)?.[1] ||
        block.match(/<description>(.*?)<\/description>/)?.[1] || ""
    ).slice(0, 220);
    const pub = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1];
    const media = block.match(/url="(https:\/\/[^"]+)"/)?.[1];
    const rawImage = media || null;
    return {
      id: `bbc-${i}-${link}`,
      title: title.trim(),
      url: link,
      excerpt: desc || "BBC World headline.",
      source: "BBC World",
      category: "world",
      time: pub ? new Date(pub).getTime() : Date.now() - i * 3600000,
      image: rawImage ? upgradePublisherImageUrl(rawImage) : null,
    };
  });
}

async function generateBrief(stories, apiKey) {
  const top = stories
    .sort((a, b) => b.time - a.time)
    .slice(0, 12)
    .map((s) => `[${s.category.toUpperCase()}] ${s.title}`)
    .join("\n");

  const prompt = `You are Moltbook Intelligence Brief. In 2-3 elegant sentences, summarize today's most important themes from these headlines for a general tech-aware reader. Be concise and editorial — no bullet points, no hype.

Headlines:
${top}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 220 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function main() {
  const results = await Promise.allSettled([
    fetchAiStories(),
    fetchTechStories(),
    fetchWorldStories(),
  ]);

  const stories = [];
  const errors = [];
  results.forEach((r, i) => {
    const label = ["AI", "Tech", "World"][i];
    if (r.status === "fulfilled") stories.push(...r.value);
    else errors.push(label);
  });

  if (!stories.length) {
    console.error("No stories fetched.", errors);
    process.exit(1);
  }

  let brief = null;
  const key = loadGeminiKey();
  if (key) {
    try {
      brief = await generateBrief(stories, key);
      console.log("AI brief generated.");
    } catch (e) {
      console.warn("Gemini brief skipped:", e.message);
    }
  }
  if (!brief) {
    const ai = stories.find((s) => s.category === "ai");
    const tech = stories.find((s) => s.category === "tech");
    const world = stories.find((s) => s.category === "world");
    const picks = [ai, tech, world].filter(Boolean).map((s) => s.title);
    if (picks.length) {
      brief = `The wires are busy: ${picks.join(" · ")}. This brief refreshes every ten minutes with live AI, technology, and world reporting.`;
    }
  }

  const missingImages = stories.filter((s) => shouldGenerateImage(s)).length;
  if (missingImages || stories.some((s) => s.image)) {
    console.log(`Enhancing images (generate/replace low-res)…`);
    const imgResult = await enrichStoryImages(stories, {
      apiKey: key,
      root: ROOT,
      maxGenerate: 10,
      persist: true,
    });
    console.log(
      `Images: ${imgResult.geminiCount} Gemini · ${imgResult.regenerated} AI · ${imgResult.upgraded} upgraded CDN · ${imgResult.total} total.`
    );
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    refreshMinutes: 10,
    brief,
    errors,
    stories: stories.sort((a, b) => b.time - a.time),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${stories.length} stories → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
