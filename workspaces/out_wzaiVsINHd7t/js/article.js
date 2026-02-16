/**
 * The Cognitive Shift — Article Page JS
 *
 * Reads query params (slug + article) and fetches/renders
 * a single article from PocketBase.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO date string into a readable form (e.g. "16 Feb 2026").
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return "";
  var d = new Date(dateStr);
  var months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
}

/**
 * Build PocketBase file URL for an attachment.
 * PocketBase serves files at: /api/files/{collectionId}/{recordId}/{filename}
 * @param {Object} record - PocketBase record
 * @param {string} field - Field name containing the filename
 * @returns {string|null}
 */
function pbFileUrl(record, field) {
  if (!record || !record[field]) return null;
  return CONFIG.POCKETBASE_URL +
    "/api/files/" + record.collectionId + "/" + record.id + "/" + record[field];
}

// ---------------------------------------------------------------------------
// Article rendering
// ---------------------------------------------------------------------------

/**
 * Render the article header section.
 * @param {Object} article - Article record with expanded author & publication
 * @returns {string} HTML string
 */
function renderArticleHeader(article) {
  var pub = article.expand && article.expand.publication;
  var author = article.expand && article.expand.author;

  var pubLink = "";
  if (pub) {
    pubLink = '<a class="article-publication-link" href="/publications/?slug=' +
      encodeURIComponent(pub.slug) + '">' +
      escapeHtml(pub.name) + '</a>';
  }

  var avatarHtml = "";
  if (author && author.avatar) {
    var avatarUrl = pbFileUrl(author, "avatar");
    avatarHtml = '<img class="article-meta-avatar" src="' + avatarUrl +
      '" alt="' + escapeHtml(author.display_name || "") + '">';
  }

  var authorName = author ? escapeHtml(author.display_name || "Unknown") : "Unknown";
  var dateStr = formatDate(article.published_at);

  return '<div class="article-header">' +
    pubLink +
    '<h1>' + escapeHtml(article.title) + '</h1>' +
    '<div class="article-meta">' +
      avatarHtml +
      '<span class="article-meta-name">' + authorName + '</span>' +
      (dateStr ? '<span class="article-meta-sep">&middot;</span>' +
        '<span class="article-meta-date">' + dateStr + '</span>' : '') +
    '</div>' +
  '</div>';
}

/**
 * Render the article body content.
 * @param {Object} article - Article record
 * @returns {string} HTML string
 */
function renderArticleBody(article) {
  return '<div class="gold-rule"></div>' +
    '<div class="article-content">' +
      article.content +
    '</div>';
}

/**
 * Render the author bio card at the bottom.
 * @param {Object} article - Article record with expanded author
 * @returns {string} HTML string
 */
function renderAuthorBio(article) {
  var author = article.expand && article.expand.author;
  if (!author) return "";

  var avatarHtml = "";
  if (author.avatar) {
    var avatarUrl = pbFileUrl(author, "avatar");
    avatarHtml = '<img class="author-bio-avatar" src="' + avatarUrl +
      '" alt="' + escapeHtml(author.display_name || "") + '">';
  }

  var authorLink = author.slug
    ? '<a href="/authors/?slug=' + encodeURIComponent(author.slug) + '">' +
        escapeHtml(author.display_name || "Unknown") + '</a>'
    : escapeHtml(author.display_name || "Unknown");

  var bioText = author.bio ? escapeHtml(author.bio) : "";

  return '<div class="author-bio-card">' +
    avatarHtml +
    '<div class="author-bio-info">' +
      '<div class="author-bio-name">' + authorLink + '</div>' +
      (bioText ? '<div class="author-bio-text">' + bioText + '</div>' : '') +
    '</div>' +
  '</div>';
}

/**
 * Escape HTML special characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  var div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Page initialization
// ---------------------------------------------------------------------------

/**
 * Initialize article page: read query params, fetch article, render.
 */
async function initArticlePage() {
  var params = new URLSearchParams(window.location.search);
  var slug = params.get("slug");
  var articleSlug = params.get("article");

  // Only handle article view — if no article param, this is publication listing
  if (!slug || !articleSlug) return;

  var mainEl = document.getElementById("article-main");
  if (!mainEl) return;

  // Show loading state
  mainEl.innerHTML = '<div class="article-loading">Loading\u2026</div>';

  // Hide publication-specific sections
  var pubHeader = document.querySelector(".page-header");
  var pubList = document.getElementById("publications-list");
  if (pubHeader) pubHeader.style.display = "none";
  if (pubList) pubList.style.display = "none";

  // Fetch article
  var article = await getArticle(articleSlug);

  if (!article) {
    mainEl.innerHTML = '<div class="article-error">Article not found</div>';
    return;
  }

  // Update page title
  document.title = article.title + " — The Cognitive Shift";

  // Render article
  mainEl.innerHTML =
    renderArticleHeader(article) +
    renderArticleBody(article) +
    renderAuthorBio(article);
}

document.addEventListener("DOMContentLoaded", initArticlePage);
