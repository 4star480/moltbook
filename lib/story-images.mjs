/**
 * High-quality contextual images for news stories.
 * Gemini when available; Pollinations Flux fallback at editorial resolution.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

/** Editorial 16:9 — sharp on retina lead + card layouts */
export const IMAGE_WIDTH = 1600;
export const IMAGE_HEIGHT = 900;

const CATEGORY_STYLE = {
  ai: "futuristic AI research lab, holographic displays, cool blue tones, National Geographic quality",
  tech: "cutting-edge technology, sleek hardware, modern office, Wired magazine cover quality",
  world: "international photojournalism, Reuters/AP documentary style, natural light, global news",
};

export function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 80);
}

export function seedFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function buildImagePrompt(story, { enhance = false } = {}) {
  const style = CATEGORY_STYLE[story.category] || CATEGORY_STYLE.tech;
  const ctx = (story.excerpt || "").replace(/Hacker News ·.*$/i, "").trim().slice(0, 180);
  const quality = enhance
    ? "Ultra high resolution, 8K clarity, tack sharp focus, professional color grading, HDR, magazine cover quality."
    : "High resolution, sharp focus, professional color grading, photorealistic.";
  return [
    "Award-winning editorial news photograph.",
    `Subject: ${story.title}.`,
    ctx ? `Context: ${ctx}.` : "",
    `Visual style: ${style}.`,
    quality,
    "Cinematic 16:9 composition, natural lighting, depth of field.",
    "No text, no logos, no watermarks, no overlaid graphics, no identifiable celebrity faces.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Pollinations Flux — higher fidelity than default turbo at large sizes */
export function buildContextImageUrl(story, opts = {}) {
  const w = opts.width ?? IMAGE_WIDTH;
  const h = opts.height ?? IMAGE_HEIGHT;
  const prompt = buildImagePrompt(story, { enhance: opts.enhance ?? true }).slice(0, 500);
  const seed = seedFromId(story.id);
  const params = new URLSearchParams({
    width: String(w),
    height: String(h),
    nologo: "true",
    seed: String(seed),
    model: "flux",
    enhance: "true",
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
}

/** BBC RSS only ships 240px thumbs — same asset exists at 1280 on iChef */
const BBC_ICHEF_MAX = 1280;
const MIN_PUBLISHER_WIDTH = 900;

export function getBbcImageWidth(url) {
  if (!url?.includes("ichef.bbci.co.uk")) return null;
  const m = url.match(/\/(?:standard|wide|branded_news)\/(\d+)\//i);
  return m ? parseInt(m[1], 10) : null;
}

/** Bump publisher CDN resize params when possible */
export function upgradePublisherImageUrl(url) {
  if (!url || url.startsWith("assets/")) return url;

  if (url.includes("ichef.bbci.co.uk")) {
    return url
      .replace(/\/standard\/\d+\//i, `/standard/${BBC_ICHEF_MAX}/`)
      .replace(/\/wide\/\d+\//i, `/wide/${BBC_ICHEF_MAX}/`)
      .replace(/\/branded_news\/\d+\//i, `/branded_news/${BBC_ICHEF_MAX}/`);
  }

  if (url.includes("dev.to/dynamic/image")) {
    return url
      .replace(/width=\d+/g, `width=${IMAGE_WIDTH}`)
      .replace(/height=\d+/g, `height=${Math.round(IMAGE_WIDTH * 9 / 16)}`);
  }
  if (url.includes("width=800") || url.includes("height=450")) {
    return url.replace(/width=800/g, `width=${IMAGE_WIDTH}`).replace(/height=450/g, `height=${IMAGE_HEIGHT}`);
  }
  return url;
}

export function isLowQualityImage(story) {
  if (!story.image) return true;
  if (story.imageGenerated && story.imageQuality === "hq") return false;

  const u = story.image.toLowerCase();

  const bbcW = getBbcImageWidth(story.image);
  if (bbcW !== null && bbcW < MIN_PUBLISHER_WIDTH) return true;

  if (u.includes("pollinations.ai") && (u.includes("width=800") || u.includes("800&height"))) return true;
  if (u.includes("height=420") || u.includes("width=320")) return true;
  if (u.includes("thumbnail") || u.includes("_thumb")) return true;
  if (u.includes("/240/") && !u.includes("ichef.bbci.co.uk")) return true;
  if (story.imageGenerated && !story.imageQuality) return true;

  return false;
}

export function shouldGenerateImage(story) {
  return !story.image || isLowQualityImage(story);
}

const IMAGE_MODELS = [
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.5-flash-preview-image-generation",
];

export async function generateGeminiImageBuffer(prompt, apiKey) {
  const hqPrompt = `${prompt}\n\nOutput: maximum quality, sharp, photorealistic, suitable for a full-width news hero at 1600px wide.`;
  for (const model of IMAGE_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: hqPrompt }] }],
            generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
          }),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const img = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
      if (img?.inlineData?.data) {
        return Buffer.from(img.inlineData.data, "base64");
      }
    } catch {
      /* try next model */
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cacheNeedsRefresh(entry) {
  if (!entry) return true;
  if (entry.quality === "hq" && !entry.url?.includes("/standard/240/")) return false;
  const url = entry.url || "";
  if (url.includes("ichef.bbci.co.uk") && url.includes("/standard/240/")) return true;
  if (url.includes("width=800") || url.includes("800&height")) return true;
  return !entry.file && !entry.url;
}

/**
 * @param {Array} stories
 * @param {{ apiKey?: string, root?: string, maxGenerate?: number, persist?: boolean }} opts
 */
export async function enrichStoryImages(stories, opts = {}) {
  const { apiKey, root, maxGenerate = 12, persist = false } = opts;
  const cachePath = root ? join(root, "data", "image-cache.json") : null;
  const genDir = root ? join(root, "assets", "generated") : null;

  let cache = {};
  if (cachePath && existsSync(cachePath)) {
    try {
      cache = JSON.parse(readFileSync(cachePath, "utf8"));
    } catch {
      cache = {};
    }
  }
  if (genDir) mkdirSync(genDir, { recursive: true });

  let geminiCount = 0;
  let upgraded = 0;
  let regenerated = 0;

  for (const story of stories) {
    if (story.image) {
      story.image = upgradePublisherImageUrl(story.image);
    }

    const needsGen = shouldGenerateImage(story);
    const entry = cache[story.id];

    if (!needsGen && story.image) {
      const better = upgradePublisherImageUrl(story.image);
      if (better !== story.image) {
        story.image = better;
        upgraded++;
      }
      continue;
    }

    if (persist && entry?.file && entry.quality === "hq" && root) {
      const full = join(root, entry.file);
      if (existsSync(full)) {
        story.image = entry.file.replace(/\\/g, "/");
        story.imageGenerated = true;
        story.imageQuality = "hq";
        continue;
      }
    }

    if (entry?.url && entry.quality === "hq" && !cacheNeedsRefresh(entry)) {
      story.image = entry.url;
      story.imageGenerated = true;
      story.imageQuality = "hq";
      continue;
    }

    if (apiKey && geminiCount < maxGenerate) {
      const prompt = buildImagePrompt(story, { enhance: true });
      const buf = await generateGeminiImageBuffer(prompt, apiKey);
      if (buf && persist && genDir && root) {
        const file = `assets/generated/${safeId(story.id)}.png`;
        writeFileSync(join(root, file), buf);
        story.image = file;
        story.imageGenerated = true;
        story.imageQuality = "hq";
        cache[story.id] = { file, quality: "hq", at: Date.now() };
        geminiCount++;
        regenerated++;
        await sleep(2500);
        continue;
      }
    }

    story.image = buildContextImageUrl(story, { enhance: true });
    story.imageGenerated = true;
    story.imageQuality = "hq";
    cache[story.id] = { url: story.image, quality: "hq", at: Date.now() };
    regenerated++;
  }

  if (cachePath && root) {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  }

  return { geminiCount, upgraded, regenerated, total: stories.filter((s) => s.image).length };
}

export function resolveStoryImage(story) {
  if (story.image && !isLowQualityImage(story)) {
    return upgradePublisherImageUrl(story.image);
  }
  return buildContextImageUrl(story, { enhance: true });
}
