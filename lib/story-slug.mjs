/** Stable URL slug for on-site post pages. */
export function deriveSlug(story) {
  if (story.slug) return story.slug;
  const id = story.id || "";
  if (id.startsWith("ai-") || id.startsWith("hn-")) return id;
  const fromUrl = story.url?.match(/bbc\.com\/news\/(?:articles|videos)\/([^/?&#]+)/i)?.[1];
  if (fromUrl) return `bbc-${fromUrl}`;
  if (id.startsWith("bbc-")) {
    const tail = id.slice(4).replace(/^https?[^/]*\/news\/(?:articles|videos)\//i, "").split(/[?&#]/)[0];
    if (tail && tail !== id.slice(4)) return `bbc-${tail}`;
  }
  return id.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64) || "post";
}

export function attachSlug(story) {
  return { ...story, slug: deriveSlug(story) };
}
