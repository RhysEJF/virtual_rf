/**
 * The Cognitive Shift — Author Profile Page JS
 *
 * Reads ?slug= query param, fetches author profile and their articles
 * from PocketBase, and renders the full author page.
 */

// ---------------------------------------------------------------------------
// Helpers (reused from article.js pattern)
// ---------------------------------------------------------------------------

/**
 * Format an ISO date string into a readable form (e.g. "16 Feb 2026").
 * Only defined if not already available (article.js may not be loaded).
 */
if (typeof formatDate === "undefined") {
  function formatDate(dateStr) {
    if (!dateStr) return "";
    var d = new Date(dateStr);
    var months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }
}

if (typeof pbFileUrl === "undefined") {
  function pbFileUrl(record, field) {
    if (!record || !record[field]) return null;
    return CONFIG.POCKETBASE_URL +
      "/api/files/" + record.collectionId + "/" + record.id + "/" + record[field];
  }
}

if (typeof escapeHtml === "undefined") {
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render the author avatar — image or gold-bordered initial placeholder.
 * @param {Object} author - Author record
 * @returns {string} HTML string
 */
function renderAuthorAvatar(author) {
  if (author.avatar) {
    var avatarUrl = pbFileUrl(author, "avatar");
    return '<img class="author-profile-avatar" src="' + avatarUrl +
      '" alt="' + escapeHtml(author.display_name || "") + '">';
  }

  var initial = (author.display_name || "?").charAt(0).toUpperCase();
  return '<div class="author-profile-avatar-placeholder">' +
    '<span>' + escapeHtml(initial) + '</span>' +
  '</div>';
}

/**
 * Render a single article card in the author's article list.
 * @param {Object} article - Article record with expanded publication
 * @returns {string} HTML string
 */
function renderAuthorArticleItem(article) {
  var pub = article.expand && article.expand.publication;
  var dateStr = formatDate(article.published_at);

  var pubBadge = "";
  if (pub) {
    pubBadge = '<a class="author-article-pub" href="/publications/?slug=' +
      encodeURIComponent(pub.slug) + '">' +
      escapeHtml(pub.name) + '</a>';
  }

  var articleUrl = pub
    ? '/publications/?slug=' + encodeURIComponent(pub.slug) + '&article=' + encodeURIComponent(article.slug)
    : '#';

  var excerptHtml = article.excerpt
    ? '<p class="author-article-excerpt">' + escapeHtml(article.excerpt) + '</p>'
    : '';

  return '<div class="author-article-item">' +
    '<div class="author-article-content">' +
      '<h3><a href="' + articleUrl + '">' + escapeHtml(article.title) + '</a></h3>' +
      excerptHtml +
      '<div class="author-article-meta">' +
        pubBadge +
        (pubBadge && dateStr ? '<span class="author-article-sep">&middot;</span>' : '') +
        (dateStr ? '<span class="author-article-date">' + dateStr + '</span>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}

/**
 * Render the "not found" state.
 * @returns {string} HTML string
 */
function renderAuthorNotFound() {
  return '<div class="author-not-found">' +
    '<div class="section-label">Author</div>' +
    '<h1 class="page-title">Author not found</h1>' +
    '<p class="page-subtitle">The author you\'re looking for doesn\'t exist or may have been removed.</p>' +
  '</div>';
}

// ---------------------------------------------------------------------------
// Page initialization
// ---------------------------------------------------------------------------

/**
 * Initialize author profile page: read ?slug=, fetch author + articles, render.
 */
async function initAuthorPage() {
  var params = new URLSearchParams(window.location.search);
  var slug = params.get("slug");

  var headerEl = document.getElementById("author-header");
  var articlesEl = document.getElementById("author-articles");

  if (!slug) {
    if (headerEl) {
      headerEl.innerHTML = renderAuthorNotFound();
    }
    if (articlesEl) articlesEl.style.display = "none";
    return;
  }

  // Fetch author
  var author = await getAuthor(slug);

  if (!author) {
    if (headerEl) {
      headerEl.innerHTML = renderAuthorNotFound();
    }
    if (articlesEl) articlesEl.style.display = "none";
    return;
  }

  // Update page title
  document.title = (author.display_name || "Author") + " — The Cognitive Shift";

  // Render author header
  if (headerEl) {
    var bioHtml = author.bio
      ? '<p class="author-profile-bio">' + escapeHtml(author.bio) + '</p>'
      : '';

    headerEl.innerHTML =
      '<div class="section-label">Author</div>' +
      renderAuthorAvatar(author) +
      '<h1 class="page-title">' + escapeHtml(author.display_name || "Unknown") + '</h1>' +
      bioHtml;
  }

  // Fetch articles by this author
  var result = await getAuthorArticles(author.id);
  var articles = result && result.items ? result.items : [];

  if (articlesEl) {
    if (articles.length === 0) {
      articlesEl.innerHTML =
        '<div class="section-label">Articles by ' + escapeHtml(author.display_name || "this author") + '</div>' +
        '<p class="author-no-articles">No published articles yet.</p>';
    } else {
      var html = '<div class="section-label">Articles by ' +
        escapeHtml(author.display_name || "this author") + '</div>' +
        '<div class="author-articles-list">';
      for (var i = 0; i < articles.length; i++) {
        html += renderAuthorArticleItem(articles[i]);
      }
      html += '</div>';
      articlesEl.innerHTML = html;
    }
  }
}

document.addEventListener("DOMContentLoaded", initAuthorPage);
