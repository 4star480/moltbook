/** Shared helpers for Moltbook home + article pages. */
window.Moltbook = {
  displaySource(source) {
    const map = {
      "BBC World": "Global Desk",
      "Hacker News": "Tech Wire",
      "Dev.to": "AI Pulse",
    };
    return map[source] || source;
  },

  tagClass(cat) {
    if (cat === "ai") return "tag tag-ai";
    if (cat === "world") return "tag tag-world";
    return "tag tag-tech";
  },

  tagLabel(cat) {
    if (cat === "ai") return "AI";
    if (cat === "world") return "World";
    return "Tech";
  },

  timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  },

  storySlug(story) {
    if (story.slug) return story.slug;
    const id = story.id || "";
    if (id.startsWith("ai-") || id.startsWith("hn-")) return id;
    const fromUrl = story.url?.match(/bbc\.com\/news\/(?:articles|videos)\/([^/?&#]+)/i)?.[1];
    if (fromUrl) return `bbc-${fromUrl}`;
    return id.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64) || "post";
  },

  postUrl(story) {
    const slug = window.Moltbook.storySlug(story);
    if (location.protocol === "file:") {
      return `story.html?slug=${encodeURIComponent(slug)}`;
    }
    return `/story/${encodeURIComponent(slug)}`;
  },

  postLink(story, title) {
    const href = window.Moltbook.postUrl(story);
    const text = title ?? story.title;
    return `<a class="story-title-link" href="${href}">${text}</a>`;
  },
};
