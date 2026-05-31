import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import { deriveSlug } from "./story-slug.mjs";

marked.setOptions({ gfm: true, breaks: true });

const UA = "Mozilla/5.0 (compatible; MoltbookBot/1.0; +https://github.com/4star480/moltbook)";

function escapeHtml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphsFromText(text) {
  const chunks = (text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!chunks.length) return "";
  return chunks.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
}

function sanitizeArticleHtml(html) {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

async function fetchText(url, timeoutMs = 14000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchDevToArticle(story) {
  const devId = story.id.replace(/^ai-/, "");
  const res = await fetch(`https://dev.to/api/articles/${devId}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Dev.to API ${res.status}`);
  const art = await res.json();
  const md = art.body_markdown || "";
  const html = md ? sanitizeArticleHtml(marked.parse(md)) : paragraphsFromText(story.excerpt);
  return {
    bodyHtml: html,
    author: art.user?.name || null,
    readMinutes: art.reading_time_minutes || null,
  };
}

async function fetchReadableArticle(story) {
  const html = await fetchText(story.url);
  const dom = new JSDOM(html, { url: story.url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (article?.content && article.content.replace(/<[^>]+>/g, "").trim().length > 120) {
    return {
      bodyHtml: sanitizeArticleHtml(article.content),
      author: article.byline || null,
      readMinutes: null,
    };
  }
  throw new Error("Readability empty");
}

async function fetchBbcFromRssDescription(story) {
  if (story.rssDescription && story.rssDescription.length > 80) {
    return {
      bodyHtml: paragraphsFromText(story.rssDescription),
      author: null,
      readMinutes: null,
    };
  }
  throw new Error("No BBC RSS body");
}

function hnDiscussionBody(story) {
  return {
    bodyHtml: [
      paragraphsFromText(story.excerpt),
      `<p class="article-note">This headline is trending on Hacker News. Moltbook has prepared a summary from the discussion and linked reporting.</p>`,
    ].join("\n"),
    author: null,
    readMinutes: 2,
  };
}

/** Fetch full article body for one story. */
export async function fetchArticleContent(story) {
  const slug = deriveSlug(story);

  if (story.id.startsWith("ai-")) {
    try {
      return { slug, ...(await fetchDevToArticle(story)), contentSource: "devto-api" };
    } catch {
      /* fall through */
    }
  }

  if (story.url?.includes("news.ycombinator.com/item")) {
    return { slug, ...hnDiscussionBody(story), contentSource: "hn-discussion" };
  }

  if (story.category === "world" || story.source === "BBC World") {
    try {
      return { slug, ...(await fetchReadableArticle(story)), contentSource: "readability" };
    } catch {
      try {
        return { slug, ...(await fetchBbcFromRssDescription(story)), contentSource: "rss-excerpt" };
      } catch {
        /* fall through */
      }
    }
  }

  try {
    return { slug, ...(await fetchReadableArticle(story)), contentSource: "readability" };
  } catch {
    const fallback = story.excerpt?.replace(/^Hacker News ·.*$/i, "").trim() || story.excerpt;
    return {
      slug,
      bodyHtml: paragraphsFromText(fallback || story.title),
      author: null,
      readMinutes: null,
      contentSource: "excerpt",
    };
  }
}

async function mapPool(items, fn, concurrency) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = { error: e.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

/** Attach bodyHtml to stories during build refresh. */
export async function enrichStoryContent(stories, { concurrency = 4, maxStories = 48 } = {}) {
  const targets = stories.slice(0, maxStories);
  let fetched = 0;
  let failed = 0;

  const results = await mapPool(
    targets,
    async (story) => {
      if (story.bodyHtml && story.contentFetchedAt) return story;
      try {
        const content = await fetchArticleContent(story);
        fetched++;
        return {
          ...story,
          slug: content.slug,
          bodyHtml: content.bodyHtml,
          author: content.author || story.author || null,
          readMinutes: content.readMinutes ?? story.readMinutes ?? null,
          contentSource: content.contentSource,
          contentFetchedAt: new Date().toISOString(),
        };
      } catch (e) {
        failed++;
        return {
          ...story,
          slug: deriveSlug(story),
          bodyHtml: paragraphsFromText(story.excerpt || story.title),
          contentSource: "excerpt-fallback",
          contentFetchedAt: new Date().toISOString(),
        };
      }
    },
    concurrency
  );

  const byId = new Map(results.filter(Boolean).map((s) => [s.id, s]));
  const merged = stories.map((s) => byId.get(s.id) || { ...s, slug: deriveSlug(s) });
  return { stories: merged, fetched, failed };
}
