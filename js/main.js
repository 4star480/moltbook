/**
 * Moltbook News — BBC-style layout, 10-minute auto-refresh from the web.
 */

const REFRESH_MS = 10 * 60 * 1000;
const CACHE_URL = "data/news.json";
const IS_FILE = location.protocol === "file:";

let allStories = [];
let activeFilter = "all";
let searchQuery = "";
let lastFetchAt = 0;
let nextRefreshAt = 0;
let countdownTimer = null;

const els = {
  leadMain: document.getElementById("lead-main"),
  leadSidebar: document.getElementById("lead-sidebar"),
  feedWorld: document.getElementById("feed-world"),
  feedTech: document.getElementById("feed-tech"),
  feedAi: document.getElementById("feed-ai"),
  feedFiltered: document.getElementById("feed-filtered"),
  homeLayout: document.getElementById("home-layout"),
  filterLayout: document.getElementById("filter-layout"),
  filterHeading: document.getElementById("filter-heading"),
  feedEmpty: document.getElementById("feed-empty"),
  ticker: document.getElementById("ticker"),
  status: document.getElementById("status-text"),
  updated: document.getElementById("updated-at"),
  nextRefresh: document.getElementById("next-refresh"),
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

function tagClass(cat) {
  if (cat === "ai") return "tag tag-ai";
  if (cat === "world") return "tag tag-world";
  return "tag tag-tech";
}

function tagLabel(cat) {
  if (cat === "ai") return "AI";
  if (cat === "world") return "World";
  return "Tech";
}

const IMG_W = 1600;
const IMG_H = 900;

const IMG_STYLE = {
  ai: "futuristic AI research lab, holographic displays, National Geographic quality",
  tech: "cutting-edge technology, sleek hardware, Wired magazine cover quality",
  world: "international photojournalism, Reuters documentary style, natural light",
};

function imageSeed(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function upgradePublisherUrl(url) {
  if (!url || url.startsWith("assets/")) return url;
  if (url.includes("ichef.bbci.co.uk")) {
    return url
      .replace(/\/standard\/\d+\//i, "/standard/1280/")
      .replace(/\/wide\/\d+\//i, "/wide/1280/")
      .replace(/\/branded_news\/\d+\//i, "/branded_news/1280/");
  }
  if (url.includes("dev.to/dynamic/image")) {
    return url
      .replace(/width=\d+/g, `width=${IMG_W}`)
      .replace(/height=\d+/g, `height=${Math.round(IMG_W * 9 / 16)}`);
  }
  if (url.includes("width=800") || url.includes("height=450")) {
    return url.replace(/width=800/g, `width=${IMG_W}`).replace(/height=450/g, `height=${IMG_H}`);
  }
  return url;
}

function bbcWidth(url) {
  if (!url?.includes("ichef.bbci.co.uk")) return null;
  const m = url.match(/\/(?:standard|wide|branded_news)\/(\d+)\//i);
  return m ? parseInt(m[1], 10) : null;
}

function isLowQuality(url, story) {
  if (!url) return true;
  if (story?.imageQuality === "hq" && story?.imageGenerated) return false;
  const w = bbcWidth(url);
  if (w !== null && w < 900) return true;
  const u = url.toLowerCase();
  if (u.includes("pollinations.ai") && u.includes("800")) return true;
  if (u.includes("height=420") || u.includes("width=320")) return true;
  if (story?.imageGenerated && story?.imageQuality !== "hq") return true;
  return false;
}

function buildAiImageUrl(story) {
  const style = IMG_STYLE[story.category] || IMG_STYLE.tech;
  const ctx = (story.excerpt || "").replace(/Hacker News ·.*$/i, "").trim().slice(0, 180);
  const prompt = [
    "Award-winning editorial news photograph.",
    `Subject: ${story.title}.`,
    ctx ? `Context: ${ctx}.` : "",
    `Style: ${style}.`,
    "Ultra high resolution, tack sharp, professional color grading, photorealistic 16:9.",
    "No text, no logos, no watermarks.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  const params = new URLSearchParams({
    width: String(IMG_W),
    height: String(IMG_H),
    nologo: "true",
    seed: String(imageSeed(story.id)),
    model: "flux",
    enhance: "true",
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
}

/** HQ image: upgrade publisher CDN or AI-generate when missing/low-res. */
function storyImageUrl(story) {
  const upgraded = story.image ? upgradePublisherUrl(story.image) : null;
  if (upgraded && !isLowQuality(upgraded, story)) return upgraded;
  return buildAiImageUrl(story);
}

function renderImageBlock(story, className, loading) {
  const src = storyImageUrl(story);
  const fallback = buildAiImageUrl(story);
  const fallbackAttr = fallback !== src ? ` data-fallback="${encodeURIComponent(fallback)}"` : "";
  return `<div class="${className}"><img class="story-img" src="${src}" alt="" loading="${loading}" decoding="async" referrerpolicy="no-referrer"${fallbackAttr} onerror="if(this.dataset.fallback&&!this.dataset.retried){this.dataset.retried=1;this.src=decodeURIComponent(this.dataset.fallback)}" /></div>`;
}

function fallbackBrief(stories) {
  const ai = stories.find((s) => s.category === "ai");
  const tech = stories.find((s) => s.category === "tech");
  const world = stories.find((s) => s.category === "world");
  const parts = [world, tech, ai].filter(Boolean).map((s) => s.title);
  if (!parts.length) return "";
  return `Today's lead stories span world affairs, technology, and artificial intelligence — including ${parts.slice(0, 2).join(" and ")}. Updated every ten minutes from live sources.`;
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

function renderLead(story) {
  if (!story) return '<p class="muted">No lead story.</p>';
  return `
    <article class="story-lead">
      ${renderImageBlock(story, "story-lead-image", "eager")}
      <div class="story-lead-body">
        <span class="${tagClass(story.category)}">${tagLabel(story.category)} · ${story.source}</span>
        <h1 class="story-lead-title"><a href="${story.url}" target="_blank" rel="noopener noreferrer">${story.title}</a></h1>
        <p class="story-lead-excerpt">${story.excerpt}</p>
        <p class="story-meta">${timeAgo(story.time)}</p>
      </div>
    </article>`;
}

function renderSideItem(story) {
  return `
    <article class="story-side">
      <span class="${tagClass(story.category)}">${tagLabel(story.category)}</span>
      <h3 class="story-side-title"><a href="${story.url}" target="_blank" rel="noopener noreferrer">${story.title}</a></h3>
      <p class="story-meta">${story.source} · ${timeAgo(story.time)}</p>
    </article>`;
}

function renderCard(story, showExcerpt) {
  const excerpt = showExcerpt ? `<p class="story-card-excerpt">${story.excerpt}</p>` : "";
  return `
    <article class="story-card">
      ${renderImageBlock(story, "story-card-image", "lazy")}
      <div class="story-card-body">
        <span class="${tagClass(story.category)}">${tagLabel(story.category)}</span>
        <h3 class="story-card-title"><a href="${story.url}" target="_blank" rel="noopener noreferrer">${story.title}</a></h3>
        ${excerpt}
        <p class="story-meta">${story.source} · ${timeAgo(story.time)}</p>
      </div>
    </article>`;
}

function renderTicker(stories) {
  const items = stories.slice(0, 14).map((s) => `<span>${s.title}</span>`);
  els.ticker.innerHTML = [...items, ...items].join("");
}

function updateCountdown() {
  if (!nextRefreshAt) {
    els.nextRefresh.textContent = "";
    return;
  }
  const left = Math.max(0, nextRefreshAt - Date.now());
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  els.nextRefresh.textContent = `Next check in ${mins}:${String(secs).padStart(2, "0")}`;
}

function scheduleCountdown() {
  nextRefreshAt = Date.now() + REFRESH_MS;
  clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

function renderSkeletons() {
  els.leadMain.innerHTML = '<div class="skeleton-block lead-skeleton"></div>';
  els.leadSidebar.innerHTML = Array.from({ length: 5 }, () =>
    '<div class="story-side"><div class="skeleton-block" style="height:4rem"></div></div>'
  ).join("");
  const sk = () => '<div class="story-card"><div class="skeleton-block" style="aspect-ratio:16/10"></div></div>';
  els.feedWorld.innerHTML = sk() + sk() + sk();
  els.feedTech.innerHTML = sk() + sk() + sk();
  els.feedAi.innerHTML = sk() + sk() + sk();
}

function renderHome(list) {
  els.homeLayout.classList.remove("hidden");
  els.filterLayout.classList.add("hidden");

  const lead = list[0];
  const sidebar = list.slice(1, 6);
  els.leadMain.innerHTML = renderLead(lead);
  els.leadSidebar.innerHTML = sidebar.map(renderSideItem).join("");

  const byCat = (cat, n) => list.filter((s) => s.category === cat).slice(0, n);
  els.feedWorld.innerHTML = byCat("world", 3).map((s) => renderCard(s, true)).join("") || '<p class="muted" style="padding:1rem">No world stories.</p>';
  els.feedTech.innerHTML = byCat("tech", 3).map((s) => renderCard(s, true)).join("") || '<p class="muted" style="padding:1rem">No tech stories.</p>';
  els.feedAi.innerHTML = byCat("ai", 3).map((s) => renderCard(s, true)).join("") || '<p class="muted" style="padding:1rem">No AI stories.</p>';
}

function renderFilterView(list) {
  els.homeLayout.classList.add("hidden");
  els.filterLayout.classList.remove("hidden");
  const labels = { world: "World", tech: "Technology", ai: "Artificial Intelligence", all: "All headlines" };
  els.filterHeading.textContent = searchQuery ? `Search: “${searchQuery}”` : labels[activeFilter] || "Headlines";
  els.feedFiltered.innerHTML = list.map((s) => renderCard(s, true)).join("");
}

function render() {
  const list = filteredStories();
  const showHome = activeFilter === "all" && !searchQuery.trim();

  if (showHome) renderHome(list);
  else renderFilterView(list);

  els.feedEmpty.classList.toggle("hidden", list.length > 0);
  renderTicker(list);

  const counts = {
    ai: allStories.filter((s) => s.category === "ai").length,
    tech: allStories.filter((s) => s.category === "tech").length,
    world: allStories.filter((s) => s.category === "world").length,
  };
  els.status.textContent = `${list.length} stories · ${counts.world} world · ${counts.tech} tech · ${counts.ai} AI`;
}

function applyPayload(payload) {
  if (!payload?.stories?.length) return false;
  allStories = payload.stories.map((s) => ({
    ...s,
    image: s.image ? upgradePublisherUrl(s.image) : null,
  }));
  lastFetchAt = Date.now();

  const brief = payload.brief || fallbackBrief(allStories);
  if (brief && els.briefSection && els.briefText) {
    els.briefText.textContent = brief;
    els.briefSection.hidden = false;
  }

  if (payload.updatedAt) {
    els.updated.textContent = `Last updated ${new Date(payload.updatedAt).toLocaleString()}`;
  } else {
    els.updated.textContent = `Last updated ${new Date().toLocaleString()}`;
  }

  render();
  scheduleCountdown();
  return true;
}

async function fetchNewsPayload() {
  const bust = `t=${Date.now()}`;
  const urls = [`${CACHE_URL}?${bust}`];
  if (!IS_FILE) {
    urls.unshift(`/api/news?${bust}`, `/.netlify/functions/news?${bust}`);
  }

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
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
  els.status.textContent = "Checking the internet for latest headlines…";
  els.refresh.disabled = true;

  const payload = await fetchNewsPayload();

  if (!payload) {
    els.status.textContent = IS_FILE
      ? "Run: node scripts/refresh-news.mjs — then reload"
      : "Could not reach news sources. Try Refresh.";
    els.leadMain.innerHTML = '<p class="muted" style="padding:1rem">No headlines available.</p>';
    els.leadSidebar.innerHTML = "";
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

function setActiveNav(filter) {
  document.querySelectorAll(".cat-link").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.filter === filter);
  });
}

document.querySelectorAll(".cat-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeFilter = btn.dataset.filter || "all";
    setActiveNav(activeFilter);
    render();
    if (activeFilter === "all") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      els.filterLayout.scrollIntoView({ behavior: "smooth" });
    }
  });
});

document.querySelectorAll(".section-more").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    activeFilter = link.dataset.filter || "all";
    setActiveNav(activeFilter);
    render();
    els.filterLayout.scrollIntoView({ behavior: "smooth" });
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
