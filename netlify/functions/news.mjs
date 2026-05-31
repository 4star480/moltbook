/**
 * Netlify function: fresh headlines + optional Gemini brief.
 * Set GEMINI_API_KEY in Netlify env for AI summaries.
 */

const RSS_SOURCES = [
  (url) => "https://corsproxy.io/?" + encodeURIComponent(url),
  (url) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
];
const BBC_WORLD_RSS = "https://feeds.bbci.co.uk/news/world/rss.xml";

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  try {
    const res = await fetch(BBC_WORLD_RSS, {
      headers: { "User-Agent": "MoltbookNews/1.0" },
    });
    if (res.ok) xmlText = await res.text();
  } catch {
    /* proxies below */
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
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
      block.match(/<title>(.*?)<\/title>/)?.[1] ||
      "Untitled";
    const link = block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || "#";
    const desc = stripHtml(
      block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] ||
        block.match(/<description>(.*?)<\/description>/)?.[1] ||
        ""
    ).slice(0, 220);
    const pub = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1];
    const media = block.match(/url="(https:\/\/[^"]+)"/)?.[1];
    return {
      id: `bbc-${i}-${link}`,
      title: title.trim(),
      url: link,
      excerpt: desc || "BBC World headline.",
      source: "BBC World",
      category: "world",
      time: pub ? new Date(pub).getTime() : Date.now() - i * 3600000,
      image: media || null,
    };
  });
}

async function generateBrief(stories, apiKey) {
  const top = stories
    .sort((a, b) => b.time - a.time)
    .slice(0, 12)
    .map((s) => `[${s.category.toUpperCase()}] ${s.title}`)
    .join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `Summarize these headlines in 2-3 elegant editorial sentences for a tech news brief. No bullets.\n\n${top}`,
        }],
      }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 220 },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

export default async () => {
  try {
    const results = await Promise.allSettled([
      fetchAiStories(),
      fetchTechStories(),
      fetchWorldStories(),
    ]);

    const stories = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") stories.push(...r.value);
      else errors.push(["AI", "Tech", "World"][i]);
    });

    let brief = null;
    if (process.env.GEMINI_API_KEY) {
      brief = await generateBrief(stories, process.env.GEMINI_API_KEY);
    }

    return new Response(
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        refreshMinutes: 10,
        brief,
        errors,
        stories: stories.sort((a, b) => b.time - a.time),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const config = { path: "/api/news" };
