/**
 * Lazy-fetch full article body for on-site Moltbook posts.
 * GET /api/article?slug=hn-123
 */

import { fetchArticleContent } from "../../lib/article-content.mjs";
import { deriveSlug } from "../../lib/story-slug.mjs";

async function loadStoriesFromCache(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, "")}/data/news.json`;
  const res = await fetch(url, { headers: { "User-Agent": "MoltbookArticle/1.0" } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.stories || null;
}

export default async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (!slug) {
    return new Response(JSON.stringify({ error: "Missing slug" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");

  let story = null;
  if (base) {
    const stories = await loadStoriesFromCache(base);
    if (stories) {
      story = stories.find((s) => deriveSlug(s) === slug || s.slug === slug || s.id === slug);
      if (story?.bodyHtml) {
        return new Response(
          JSON.stringify({
            slug: deriveSlug(story),
            bodyHtml: story.bodyHtml,
            author: story.author,
            readMinutes: story.readMinutes,
            contentSource: story.contentSource || "cache",
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=600",
            },
          }
        );
      }
    }
  }

  if (!story) {
    return new Response(JSON.stringify({ error: "Story not found in cache" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const content = await fetchArticleContent(story);
    return new Response(JSON.stringify(content), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/api/article" };
