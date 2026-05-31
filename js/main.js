/**
 * Moltbook News — live feeds from public APIs (no API keys required).
 */

const RSS_SOURCES = [
  (url) => "https://corsproxy.io/?" + encodeURIComponent(url),
  (url) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
];
const BBC_WORLD_RSS = "https://feeds.bbci.co.uk/news/world/rss.xml";

/** @type {Array<{id:string,title:string,url:string,excerpt:string,source:string,category:'ai'|'tech'|'world',time:number,image?:string}>} */
let allStories = [];
let activeFilter = "all";
let searchQuery = "";

const els = {
  hero: document.getElementById("hero"),
  feed: document.getElementById("feed"),
  feedEmpty: document.getElementById("feed-empty"),
  ticker: document.getElementById("ticker"),
  status: document.getElementById("status-text"),
  updated: document.getElementById("updated-at"),
  search: document.getElementById("search"),
  refresh: document.getElementById("refresh-btn"),
  theme: document.getElementById("theme-toggle"),
  year: document.getElementById("year"),
};

els.year.textContent = String(new Date().getFullYear());

function stripHtml(html) {
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return (d.textContent || "").replace(/\s+/g, " ").trim();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function badgeClass(cat) {
  if (cat === "ai") return "badge badge-ai";
  if (cat === "world") return "badge badge-world";
  return "badge badge-tech";
}

function badgeLabel(cat) {
  if (cat === "ai") return "AI";
  if (cat === "world") return "World";
  return "Tech";
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
    image: a.cover_image || a.social_image,
  }));
}

async function fetchTechStories() {
  const ids = await fetchJson("https://hacker-news.firebaseio.com/v0/topstories.json");
  const top = ids.slice(0, 18);
  const items = await Promise.all(
    top.map((id) =>
      fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
    )
  );
  return items
    .filter(Boolean)
    .map((item) => ({
      id: `hn-${item.id}`,
      title: item.title,
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      excerpt: `Hacker News discussion · ${item.score ?? 0} points · ${item.descendants ?? 0} comments`,
      source: "Hacker News",
      category: "tech",
      time: (item.time || 0) * 1000,
      image: undefined,
    }));
}

async function fetchWorldStories() {
  let xmlText = null;
  for (const proxy of RSS_SOURCES) {
    try {
      const res = await fetch(proxy(BBC_WORLD_RSS));
      if (!res.ok) continue;
      xmlText = await res.text();
      if (xmlText && xmlText.includes("<item")) break;
    } catch {
      /* try next proxy */
    }
  }
  if (!xmlText) throw new Error("RSS fetch failed");

  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const items = [...doc.querySelectorAll("item")].slice(0, 15);
  return items.map((item, i) => {
    const title = item.querySelector("title")?.textContent?.trim() || "Untitled";
    const link = item.querySelector("link")?.textContent?.trim() || "#";
    const desc = stripHtml(item.querySelector("description")?.textContent || "").slice(0, 220);
    const pub = item.querySelector("pubDate")?.textContent;
    const media = item.querySelector("media\\:thumbnail, thumbnail");
    const image = media?.getAttribute("url") || undefined;
    return {
      id: `bbc-${i}-${link}`,
      title,
      url: link,
      excerpt: desc || "BBC World Service headline.",
      source: "BBC World",
      category: "world",
      time: pub ? new Date(pub).getTime() : Date.now() - i * 3600000,
      image,
    };
  });
}

function renderSkeletons() {
  els.hero.innerHTML = '<div class="hero-skeleton skeleton-block"></div>';
  els.feed.innerHTML = Array.from({ length: 9 }, () =>
    '<article class="skeleton-card skeleton-block"></article>'
  ).join("");
}

function renderHero(story) {
  if (!story) {
    els.hero.innerHTML = '<p class="muted">No featured story available.</p>';
    return;
  }
  const img = story.image
    ? `<img src="${story.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : "";
  els.hero.innerHTML = `
    <article class="hero-card">
      <div class="hero-media">${img}</div>
      <div class="hero-body">
        <div class="hero-kicker">
          <span class="${badgeClass(story.category)}">${badgeLabel(story.category)}</span>
          <span>${story.source}</span>
        </div>
        <h1 class="hero-title"><a href="${story.url}" target="_blank" rel="noopener noreferrer">${story.title}</a></h1>
        <p class="hero-excerpt">${story.excerpt}</p>
        <div class="hero-meta">
          <span>${timeAgo(story.time)}</span>
          <a class="card-link" href="${story.url}" target="_blank" rel="noopener noreferrer">Read full story →</a>
        </div>
      </div>
    </article>`;
}

function renderCard(story) {
  const thumb = story.image
    ? `<div class="card-thumb"><img src="${story.image}" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>`
    : `<div class="card-thumb" style="background:linear-gradient(135deg,var(--bg-soft),var(--accent-soft))"></div>`;
  return `
    <article class="card" data-category="${story.category}">
      ${thumb}
      <div class="card-body">
        <div class="card-top">
          <span class="${badgeClass(story.category)}">${badgeLabel(story.category)}</span>
          <span>${story.source}</span>
        </div>
        <h3 class="card-title"><a href="${story.url}" target="_blank" rel="noopener noreferrer">${story.title}</a></h3>
        <p class="card-excerpt">${story.excerpt}</p>
        <div class="card-foot">
          <span>${timeAgo(story.time)}</span>
          <a class="card-link" href="${story.url}" target="_blank" rel="noopener noreferrer">Open</a>
        </div>
      </div>
    </article>`;
}

function filteredStories() {
  let list = [...allStories];
  if (activeFilter !== "all") list = list.filter((s) => s.category === activeFilter);
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.excerpt.toLowerCase().includes(q) ||
        s.source.toLowerCase().includes(q)
    );
  }
  return list.sort((a, b) => b.time - a.time);
}

function renderTicker(stories) {
  const headlines = stories.slice(0, 12).map((s) => `<span>${s.title}</span>`);
  const doubled = [...headlines, ...headlines].join("");
  els.ticker.innerHTML = doubled;
}

function render() {
  const list = filteredStories();
  const heroStory = list[0];
  const rest = list.slice(1);

  renderHero(heroStory);
  els.feed.innerHTML = rest.map(renderCard).join("");
  els.feedEmpty.classList.toggle("hidden", list.length > 0);
  renderTicker(list);

  const counts = {
    ai: allStories.filter((s) => s.category === "ai").length,
    tech: allStories.filter((s) => s.category === "tech").length,
    world: allStories.filter((s) => s.category === "world").length,
  };
  els.status.textContent = `${list.length} stories shown · ${counts.ai} AI · ${counts.tech} tech · ${counts.world} world`;
}

async function loadNews() {
  renderSkeletons();
  els.status.textContent = "Fetching latest headlines…";
  els.refresh.disabled = true;

  const results = await Promise.allSettled([
    fetchAiStories(),
    fetchTechStories(),
    fetchWorldStories(),
  ]);

  allStories = [];
  const errors = [];
  results.forEach((r, i) => {
    const label = ["AI", "Tech", "World"][i];
    if (r.status === "fulfilled") allStories.push(...r.value);
    else errors.push(label);
  });

  if (!allStories.length) {
    els.status.textContent = "Could not load feeds. Check your connection and try Refresh.";
    els.hero.innerHTML = '<p class="muted">Unable to reach news sources right now.</p>';
    els.feed.innerHTML = "";
    els.refresh.disabled = false;
    return;
  }

  if (errors.length) {
    els.status.textContent += ` (partial: ${errors.join(", ")} unavailable)`;
  }

  els.updated.textContent = `Updated ${new Date().toLocaleString()}`;
  render();
  els.refresh.disabled = false;
}

// Theme
const savedTheme = localStorage.getItem("moltbook-theme");
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

els.theme.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("moltbook-theme", next);
});

// Tabs
document.querySelectorAll(".nav-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeFilter = btn.dataset.filter || "all";
    render();
  });
});

// Search
let searchTimer;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = els.search.value;
    render();
  }, 200);
});

els.refresh.addEventListener("click", loadNews);

loadNews();
setInterval(loadNews, 15 * 60 * 1000);
