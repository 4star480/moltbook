/**
 * Moltbook News — loads cached headlines (works on file://) and refreshes every 10 min.
 */

const REFRESH_MS = 10 * 60 * 1000;
const CACHE_URL = "data/news.json";
const IS_FILE = location.protocol === "file:";

/** @type {Array<{id:string,title:string,url:string,excerpt:string,source:string,category:string,time:number,image?:string|null}>} */
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
  briefSection: document.getElementById("ai-brief"),
  briefText: document.getElementById("brief-text"),
};

els.year.textContent = String(new Date().getFullYear());

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
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

function fallbackBrief(stories) {
  const ai = stories.find((s) => s.category === "ai");
  const tech = stories.find((s) => s.category === "tech");
  const world = stories.find((s) => s.category === "world");
  const parts = [ai, tech, world].filter(Boolean).map((s) => s.title);
  if (!parts.length) return "";
  return `The wires are busy: ${parts.join(" · ")}. This brief refreshes every ten minutes with live AI, technology, and world reporting.`;
}

function applyPayload(payload) {
  if (!payload?.stories?.length) return false;
  allStories = payload.stories;
  const brief = payload.brief || fallbackBrief(allStories);
  if (brief && els.briefSection && els.briefText) {
    els.briefText.textContent = brief;
    els.briefSection.hidden = false;
  }
  if (payload.updatedAt) {
    els.updated.textContent = `Updated ${new Date(payload.updatedAt).toLocaleString()} · auto-refresh 10m`;
  }
  render();
  return true;
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
    : `<div class="card-thumb card-thumb-fallback"></div>`;
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
  els.ticker.innerHTML = [...headlines, ...headlines].join("");
}

function render() {
  const list = filteredStories();
  renderHero(list[0]);
  els.feed.innerHTML = list.slice(1).map(renderCard).join("");
  els.feedEmpty.classList.toggle("hidden", list.length > 0);
  renderTicker(list);

  const counts = {
    ai: allStories.filter((s) => s.category === "ai").length,
    tech: allStories.filter((s) => s.category === "tech").length,
    world: allStories.filter((s) => s.category === "world").length,
  };
  els.status.textContent = `${list.length} stories · ${counts.ai} AI · ${counts.tech} tech · ${counts.world} world`;
}

async function fetchNewsPayload() {
  const bust = `t=${Date.now()}`;
  const urls = [`${CACHE_URL}?${bust}`];
  if (!IS_FILE) {
    urls.unshift(`/api/news?${bust}`, `/.netlify/functions/news?${bust}`);
  }

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.stories?.length) return data;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function loadNews() {
  renderSkeletons();
  els.status.textContent = "Scanning sources…";
  els.refresh.disabled = true;

  const payload = await fetchNewsPayload();

  if (!payload) {
    els.status.textContent = IS_FILE
      ? "Open via a local server, or run: node scripts/refresh-news.mjs"
      : "Could not load news. Check connection and try Refresh.";
    els.hero.innerHTML = '<p class="muted">No headlines available.</p>';
    els.feed.innerHTML = "";
    els.refresh.disabled = false;
    return;
  }

  applyPayload(payload);
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

document.querySelectorAll(".nav-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeFilter = btn.dataset.filter || "all";
    render();
  });
});

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
setInterval(loadNews, REFRESH_MS);
