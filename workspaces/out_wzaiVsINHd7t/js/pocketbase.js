/**
 * The Cognitive Shift — PocketBase API Helpers
 *
 * Lightweight helpers for PocketBase REST API.
 * No SDK — uses fetch directly against CONFIG.POCKETBASE_URL.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the base API URL for a given collection.
 * @param {string} collection
 * @returns {string}
 */
function _pbUrl(collection) {
  return CONFIG.POCKETBASE_URL + "/api/collections/" + encodeURIComponent(collection) + "/records";
}

/**
 * Perform a GET request and return parsed JSON.
 * Returns null and logs a warning on network / server errors so callers
 * can degrade gracefully.
 * @param {string} url
 * @returns {Promise<Object|null>}
 */
async function _pbGet(url) {
  try {
    var response = await fetch(url);
    if (!response.ok) {
      console.warn("PocketBase request failed:", response.status, url);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.warn("PocketBase unreachable:", err.message);
    return null;
  }
}

/**
 * Perform a POST request and return parsed JSON.
 * Throws on failure so callers can show inline errors.
 * @param {string} url
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function _pbPost(url, data) {
  var response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    var body = await response.text();
    throw new Error("PocketBase error " + response.status + ": " + body);
  }
  return await response.json();
}

// ---------------------------------------------------------------------------
// Content fetching (read-only)
// ---------------------------------------------------------------------------

/**
 * Fetch published articles, optionally filtered by publication slug.
 * @param {string|null} publicationSlug - Filter by publication (optional)
 * @param {number} [page=1]
 * @param {number} [perPage=20]
 * @returns {Promise<Object|null>} Paginated result or null on error
 */
async function getArticles(publicationSlug, page, perPage) {
  page = page || 1;
  perPage = perPage || 20;
  var params = new URLSearchParams({
    page: String(page),
    perPage: String(perPage),
    sort: "-published_at",
    expand: "author,publication"
  });
  if (publicationSlug) {
    params.set("filter", "(publication.slug='" + publicationSlug + "' && is_published=true)");
  } else {
    params.set("filter", "(is_published=true)");
  }
  return _pbGet(_pbUrl("articles") + "?" + params.toString());
}

/**
 * Fetch a single article by slug with expanded author and publication.
 * @param {string} slug
 * @returns {Promise<Object|null>} First matching record or null
 */
async function getArticle(slug) {
  var params = new URLSearchParams({
    filter: "(slug='" + slug + "')",
    expand: "author,publication"
  });
  var result = await _pbGet(_pbUrl("articles") + "?" + params.toString());
  return result && result.items && result.items.length > 0 ? result.items[0] : null;
}

/**
 * Fetch all active publications with expanded owner.
 * @returns {Promise<Object|null>} Paginated result or null on error
 */
async function getPublications() {
  var params = new URLSearchParams({
    filter: "(is_active=true)",
    expand: "owner"
  });
  return _pbGet(_pbUrl("publications") + "?" + params.toString());
}

/**
 * Fetch a single publication by slug.
 * @param {string} slug
 * @returns {Promise<Object|null>} First matching record or null
 */
async function getPublication(slug) {
  var params = new URLSearchParams({
    filter: "(slug='" + slug + "')",
    expand: "owner"
  });
  var result = await _pbGet(_pbUrl("publications") + "?" + params.toString());
  return result && result.items && result.items.length > 0 ? result.items[0] : null;
}

/**
 * Fetch an author profile by slug.
 * @param {string} slug
 * @returns {Promise<Object|null>} First matching record or null
 */
async function getAuthor(slug) {
  var params = new URLSearchParams({
    filter: "(slug='" + slug + "')"
  });
  var result = await _pbGet(_pbUrl("users") + "?" + params.toString());
  return result && result.items && result.items.length > 0 ? result.items[0] : null;
}

/**
 * Fetch articles written by a specific author.
 * @param {string} authorId - PocketBase record ID of the author
 * @returns {Promise<Object|null>} Paginated result or null on error
 */
async function getAuthorArticles(authorId) {
  var params = new URLSearchParams({
    filter: "(author='" + authorId + "' && is_published=true)",
    sort: "-published_at",
    expand: "publication"
  });
  return _pbGet(_pbUrl("articles") + "?" + params.toString());
}

// ---------------------------------------------------------------------------
// Form submissions (write-only, public create)
// ---------------------------------------------------------------------------

/**
 * Create a newsletter subscriber record.
 * @param {string} email
 * @param {string} source - e.g. "landing" or "article_modal"
 * @returns {Promise<Object>} Created record
 */
async function createNewsletterSubscriber(email, source) {
  return _pbPost(_pbUrl("newsletter_subscribers"), {
    email: email,
    source: source,
    subscribed_at: new Date().toISOString()
  });
}

/**
 * Create a community application record.
 * @param {Object} data - { email, role, linkedin_url, twitter_url, github_url, motivation }
 * @returns {Promise<Object>} Created record
 */
async function createCommunityApplication(data) {
  return _pbPost(_pbUrl("community_applications"), {
    email: data.email,
    role: data.role,
    linkedin_url: data.linkedin_url,
    twitter_url: data.twitter_url || "",
    github_url: data.github_url || "",
    motivation: data.motivation,
    status: "pending",
    applied_at: new Date().toISOString()
  });
}
