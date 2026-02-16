/**
 * The Cognitive Shift — Publications Page JS
 *
 * Handles two views based on query params:
 * 1. Publications Index (no params) — grid of all publications
 * 2. Single Publication (?slug=X) — publication hero + article feed
 *
 * The article detail view (?slug=X&article=Y) is handled by article.js.
 */

// ---------------------------------------------------------------------------
// Rendering — Publications Index (View 1)
// ---------------------------------------------------------------------------

/**
 * Render a single publication card for the index grid.
 * @param {Object} pub - Publication record with expanded owner
 * @returns {string} HTML string
 */
function renderPublicationCard(pub) {
  var owner = pub.expand && pub.expand.owner;
  var ownerName = owner ? escapeHtml(owner.display_name || "Unknown") : "";

  var descriptionHtml = "";
  if (pub.description) {
    // Strip HTML tags from rich text description for the card preview
    var tmp = document.createElement("div");
    tmp.innerHTML = pub.description;
    var plainText = tmp.textContent || tmp.innerText || "";
    if (plainText.length > 160) {
      plainText = plainText.substring(0, 160).trim() + "\u2026";
    }
    descriptionHtml = '<p class="pub-card-description">' + escapeHtml(plainText) + '</p>';
  }

  var ownerHtml = ownerName
    ? '<span class="pub-card-owner">' + ownerName + '</span>'
    : '';

  return '<a class="pub-card" href="/publications/?slug=' + encodeURIComponent(pub.slug) + '">' +
    '<h3 class="pub-card-name">' + escapeHtml(pub.name) + '</h3>' +
    descriptionHtml +
    '<div class="pub-card-meta">' +
      ownerHtml +
    '</div>' +
  '</a>';
}

/**
 * Render the full publications index into the target element.
 * @param {HTMLElement} listEl - Container element
 * @param {Array} publications - Array of publication records
 */
function renderPublicationsIndex(listEl, publications) {
  if (publications.length === 0) {
    listEl.innerHTML =
      '<p class="pub-empty">No publications yet.</p>';
    return;
  }

  var html = '<div class="pub-grid">';
  for (var i = 0; i < publications.length; i++) {
    html += renderPublicationCard(publications[i]);
  }
  html += '</div>';
  listEl.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Rendering — Single Publication (View 2)
// ---------------------------------------------------------------------------

/**
 * Render the publication hero header.
 * @param {Object} pub - Publication record
 * @param {Object|null} owner - Expanded owner record
 * @returns {string} HTML string
 */
function renderPublicationHero(pub, owner) {
  var ownerHtml = "";
  if (owner) {
    var avatarHtml = "";
    if (owner.avatar) {
      var avatarUrl = pbFileUrl(owner, "avatar");
      avatarHtml = '<img class="pub-hero-avatar" src="' + avatarUrl +
        '" alt="' + escapeHtml(owner.display_name || "") + '">';
    }
    var ownerLink = owner.slug
      ? '<a href="/authors/?slug=' + encodeURIComponent(owner.slug) + '">' +
          escapeHtml(owner.display_name || "Unknown") + '</a>'
      : escapeHtml(owner.display_name || "Unknown");

    ownerHtml = '<div class="pub-hero-owner">' +
      avatarHtml +
      '<span class="pub-hero-owner-name">' + ownerLink + '</span>' +
    '</div>';
  }

  var descriptionHtml = "";
  if (pub.description) {
    descriptionHtml = '<div class="pub-hero-description">' + pub.description + '</div>';
  }

  return '<div class="section-label">Publication</div>' +
    '<h1 class="page-title">' + escapeHtml(pub.name) + '</h1>' +
    descriptionHtml +
    ownerHtml;
}

/**
 * Render a single article card in the publication's article feed.
 * Uses the reading-item pattern from the landing page.
 * @param {Object} article - Article record with expanded author
 * @param {string} pubSlug - Publication slug for building article URLs
 * @returns {string} HTML string
 */
function renderPubArticleItem(article, pubSlug) {
  var author = article.expand && article.expand.author;
  var authorName = author ? escapeHtml(author.display_name || "Unknown") : "";
  var dateStr = formatDate(article.published_at);
  var articleUrl = '/publications/?slug=' + encodeURIComponent(pubSlug) +
    '&article=' + encodeURIComponent(article.slug);

  var excerptHtml = article.excerpt
    ? '<p class="pub-article-excerpt">' + escapeHtml(article.excerpt) + '</p>'
    : '';

  var metaParts = [];
  if (authorName) {
    metaParts.push('<span class="pub-article-author">' + authorName + '</span>');
  }
  if (dateStr) {
    metaParts.push('<span class="pub-article-date">' + dateStr + '</span>');
  }
  var metaHtml = metaParts.length > 0
    ? '<div class="pub-article-meta">' + metaParts.join('<span class="pub-article-sep">&middot;</span>') + '</div>'
    : '';

  return '<div class="pub-article-item">' +
    '<h3><a href="' + articleUrl + '">' + escapeHtml(article.title) + '</a></h3>' +
    excerptHtml +
    metaHtml +
  '</div>';
}

/**
 * Render the article feed for a single publication.
 * @param {HTMLElement} listEl - Container element
 * @param {Array} articles - Array of article records
 * @param {string} pubSlug - Publication slug
 */
function renderPublicationArticles(listEl, articles, pubSlug) {
  var html = '<div class="section-label">Articles</div>';

  if (articles.length === 0) {
    html += '<p class="pub-empty">No articles yet.</p>';
    listEl.innerHTML = html;
    return;
  }

  html += '<div class="pub-article-list">';
  for (var i = 0; i < articles.length; i++) {
    html += renderPubArticleItem(articles[i], pubSlug);
  }
  html += '</div>';
  listEl.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Page initialization
// ---------------------------------------------------------------------------

/**
 * Initialize publications page: check query params and render the appropriate view.
 */
async function initPublicationsPage() {
  var params = new URLSearchParams(window.location.search);
  var slug = params.get("slug");
  var articleSlug = params.get("article");

  // If article param is present, article.js handles it — bail out
  if (slug && articleSlug) return;

  var headerEl = document.querySelector(".page-header");
  var listEl = document.getElementById("publications-list");

  if (slug) {
    // --- View 2: Single Publication ---
    initSinglePublication(slug, headerEl, listEl);
  } else {
    // --- View 1: Publications Index ---
    initPublicationsIndex(listEl);
  }
}

/**
 * View 1: Fetch and render all publications.
 * @param {HTMLElement} listEl
 */
async function initPublicationsIndex(listEl) {
  if (listEl) {
    listEl.innerHTML = '<p class="pub-loading">Loading publications\u2026</p>';
  }

  var result = await getPublications();
  var publications = result && result.items ? result.items : [];

  if (listEl) {
    renderPublicationsIndex(listEl, publications);
  }
}

/**
 * View 2: Fetch publication + articles and render the single publication view.
 * @param {string} slug
 * @param {HTMLElement} headerEl
 * @param {HTMLElement} listEl
 */
async function initSinglePublication(slug, headerEl, listEl) {
  // Show loading state
  if (headerEl) {
    headerEl.innerHTML =
      '<div class="section-label">Publication</div>' +
      '<h1 class="page-title">Loading\u2026</h1>';
  }
  if (listEl) {
    listEl.innerHTML = '<p class="pub-loading">Loading articles\u2026</p>';
  }

  // Fetch publication and articles in parallel
  var pubPromise = getPublication(slug);
  var articlesPromise = getArticles(slug);
  var pub = await pubPromise;
  var articlesResult = await articlesPromise;

  if (!pub) {
    // Publication not found
    if (headerEl) {
      headerEl.innerHTML =
        '<div class="section-label">Publication</div>' +
        '<h1 class="page-title">Publication not found</h1>' +
        '<p class="page-subtitle">The publication you\u2019re looking for doesn\u2019t exist or may have been removed.</p>';
    }
    if (listEl) listEl.innerHTML = '';
    return;
  }

  // Update page title
  document.title = pub.name + " \u2014 The Cognitive Shift";

  // Owner is expanded by getPublication
  var owner = pub.expand && pub.expand.owner ? pub.expand.owner : null;

  // Render publication hero
  if (headerEl) {
    headerEl.innerHTML = renderPublicationHero(pub, owner);
  }

  // Render article feed
  var articles = articlesResult && articlesResult.items ? articlesResult.items : [];
  if (listEl) {
    renderPublicationArticles(listEl, articles, slug);
  }
}

document.addEventListener("DOMContentLoaded", initPublicationsPage);
