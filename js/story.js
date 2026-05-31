/**
 * Moltbook article page — loads full post content on-site.
 */

const IS_FILE = location.protocol === "file:";
const { displaySource, tagClass, tagLabel, timeAgo, storySlug } = window.Moltbook;

const els = {
  root: document.getElementById("article-root"),
  loading: document.getElementById("article-loading"),
  breadcrumbCat: document.getElementById("breadcrumb-cat"),
  year: document.getElementById("year"),
  theme: document.getElementById("theme-toggle"),
};

els.year.textContent = String(new Date().getFullYear());

function parseSlug() {
  const path = location.pathname.replace(/\/story\.html$/i, "").replace(/\/$/, "");
  const fromPath = path.match(/\/story\/([^/]+)/)?.[1];
  if (fromPath) return decodeURIComponent(fromPath);
  const q = new URLSearchParams(location.search).get("slug");
  return q ? decodeURIComponent(q) : null;
}

function findStory(stories, slug) {
  return stories.find((s) => storySlug(s) === slug || s.id === slug || s.slug === slug);
}

async function loadNewsJson() {
  const bust = `t=${Date.now()}`;
  const urls = [`/data/news.json?${bust}`, `data/news.json?${bust}`];
  if (!IS_FILE) {
    urls.unshift(`/api/news?${bust}`);
  }
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.stories?.length) return data;
    } catch {
      /* next */
    }
  }
  return null;
}

async function fetchArticleBody(story) {
  const slug = storySlug(story);
  const urls = [
    `/api/article?slug=${encodeURIComponent(slug)}`,
    `/.netlify/functions/article?slug=${encodeURIComponent(slug)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.bodyHtml) return data;
    } catch {
      /* next */
    }
  }
  return null;
}

function upgradeImage(url) {
  if (!url || url.startsWith("assets/")) return url;
  if (url.includes("ichef.bbci.co.uk")) {
    return url.replace(/\/standard\/\d+\//i, "/standard/1280/");
  }
  return url;
}

function renderArticle(story, bodyHtml) {
  const catLabel = tagLabel(story.category);
  els.breadcrumbCat.textContent = catLabel;
  document.title = `${story.title} — Moltbook`;

  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = story.excerpt?.slice(0, 160) || story.title;

  const img = story.image ? upgradeImage(story.image) : null;
  const imgBlock = img
    ? `<figure class="article-hero"><img src="${img}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" /></figure>`
    : "";

  const authorLine = story.author ? `<span>${story.author}</span>` : "";
  const readLine = story.readMinutes ? `<span>${story.readMinutes} min read</span>` : "";

  els.root.innerHTML = `
    <header class="article-header">
      <span class="${tagClass(story.category)}">${catLabel} · ${displaySource(story.source)}</span>
      <h1 class="article-title">${story.title}</h1>
      <p class="article-deck">${story.excerpt || ""}</p>
      <div class="article-meta-row">
        ${authorLine}
        <span>${timeAgo(story.time)}</span>
        ${readLine}
      </div>
    </header>
    ${imgBlock}
    <div class="article-body">${bodyHtml}</div>
    <footer class="article-footer">
      <p class="article-attribution">
        Reporting sourced from public feeds. Original article:
        <a href="${story.url}" target="_blank" rel="noopener noreferrer">${displaySource(story.source)} ↗</a>
      </p>
      <a class="btn-refresh" href="/">← Back to all headlines</a>
    </footer>`;
}

function renderError(message) {
  els.root.innerHTML = `
    <div class="article-error">
      <h1 class="article-title">Story not found</h1>
      <p class="muted">${message}</p>
      <a class="btn-refresh" href="/">Return home</a>
    </div>`;
}

async function init() {
  const slug = parseSlug();
  if (!slug) {
    renderError("No story specified.");
    return;
  }

  const payload = await loadNewsJson();
  if (!payload) {
    renderError("Could not load headlines. Try again later.");
    return;
  }

  const story = findStory(payload.stories, slug);
  if (!story) {
    renderError(`No post matches “${slug}”.`);
    return;
  }

  let bodyHtml = story.bodyHtml;
  if (!bodyHtml) {
    const fetched = await fetchArticleBody(story);
    bodyHtml = fetched?.bodyHtml;
  }

  if (!bodyHtml) {
    bodyHtml = `<p>${story.excerpt || story.title}</p>`;
  }

  renderArticle(story, bodyHtml);
}

const savedTheme = localStorage.getItem("moltbook-theme");
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

els.theme.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("moltbook-theme", next);
});

init();
