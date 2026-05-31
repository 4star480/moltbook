/**
 * Context-based images for stories without publisher art.
 * Gemini when available; Pollinations AI URL fallback (deterministic per story id).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const CATEGORY_STYLE = {
  ai: "futuristic AI research environment, screens and neural imagery, cool tones",
  tech: "modern technology and innovation, clean editorial photo, Silicon Valley aesthetic",
  world: "international news photojournalism, documentary realism, global current affairs",
};

export function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 80);
}

export function seedFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function buildImagePrompt(story) {
  const style = CATEGORY_STYLE[story.category] || CATEGORY_STYLE.tech;
  const ctx = (story.excerpt || "").replace(/Hacker News ·.*$/i, "").trim().slice(0, 160);
  return [
    "Realistic editorial news photograph for a major news website.",
    `Subject: ${story.title}.`,
    ctx ? `Context: ${ctx}.` : "",
    `Visual style: ${style}.`,
    "Natural lighting, photojournalistic, cinematic 16:9, no text, no logos, no watermarks, no faces of real identifiable people.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildContextImageUrl(story) {
  const prompt = buildImagePrompt(story).slice(0, 480);
  const seed = seedFromId(story.id);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=450&nologo=true&seed=${seed}`;
}

export function resolveStoryImage(story) {
  if (story.image) return story.image;
  return buildContextImageUrl(story);
}

const IMAGE_MODELS = [
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.5-flash-preview-image-generation",
];

export async function generateGeminiImageBuffer(prompt, apiKey) {
  for (const model of IMAGE_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
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

/**
 * @param {Array} stories
 * @param {{ apiKey?: string, root?: string, maxGenerate?: number, persist?: boolean }} opts
 */
export async function enrichStoryImages(stories, opts = {}) {
  const { apiKey, root, maxGenerate = 10, persist = false } = opts;
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

  for (const story of stories) {
    if (story.image && !story.imageGenerated) continue;

    const entry = cache[story.id];

    if (persist && entry?.file && root) {
      const full = join(root, entry.file);
      if (existsSync(full)) {
        story.image = entry.file.replace(/\\/g, "/");
        story.imageGenerated = true;
        continue;
      }
    }

    if (entry?.url && !story.image) {
      story.image = entry.url;
      story.imageGenerated = true;
      continue;
    }

    if (apiKey && geminiCount < maxGenerate) {
      const prompt = buildImagePrompt(story);
      const buf = await generateGeminiImageBuffer(prompt, apiKey);
      if (buf && persist && genDir && root) {
        const file = `assets/generated/${safeId(story.id)}.png`;
        writeFileSync(join(root, file), buf);
        story.image = file;
        story.imageGenerated = true;
        cache[story.id] = { file, at: Date.now() };
        geminiCount++;
        await sleep(2000);
        continue;
      }
    }

    if (!story.image) {
      story.image = buildContextImageUrl(story);
      story.imageGenerated = true;
      cache[story.id] = { url: story.image, at: Date.now() };
    }
  }

  if (cachePath) {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  }

  return { geminiCount, contextual: stories.filter((s) => s.imageGenerated).length };
}
