/**
 * The Cognitive Shift — Main JS
 *
 * Landing page interactivity and form handling.
 * Handles email signup forms and page-specific initialization.
 */

/**
 * Handle email signup form submission.
 * @param {Event} event - Form submit event
 */
async function handleSignup(event) {
  event.preventDefault();
  const form = event.target;
  const emailInput = form.querySelector('input[type="email"]');
  const button = form.querySelector('button');
  const email = emailInput.value.trim();

  if (!email) return;

  const originalText = button.textContent;
  button.textContent = 'Joining...';
  button.disabled = true;

  try {
    await PocketBaseClient.create('subscribers', { email: email });
    button.textContent = 'Welcome';
    emailInput.value = '';
    // Redirect to post-signup questions after a brief pause
    setTimeout(function () {
      window.location.href = '/signup/';
    }, 1200);
  } catch (err) {
    console.error('Signup error:', err);
    button.textContent = 'Try again';
    setTimeout(function () {
      button.textContent = originalText;
      button.disabled = false;
    }, 2000);
  }
}

/**
 * Initialize page — bind event handlers.
 */
function initPage() {
  // Bind all signup forms on the page
  var forms = document.querySelectorAll('#hero-signup-form, #bottom-signup-form');
  forms.forEach(function (form) {
    form.addEventListener('submit', handleSignup);
  });

  // Route based on query params for publications pages
  var params = new URLSearchParams(window.location.search);
  var slug = params.get('slug');
  var article = params.get('article');

  if (slug && document.getElementById('publications-list')) {
    // On publications page with a slug — show publication detail
    loadPublication(slug, article);
  }

  if (params.get('slug') && document.getElementById('author-name')) {
    // On authors page with a slug — show author profile
    loadAuthor(params.get('slug'));
  }
}

/**
 * Load a publication by slug (placeholder — will be implemented).
 * @param {string} slug - Publication slug
 * @param {string|null} article - Optional article slug within publication
 */
function loadPublication(slug, article) {
  // Placeholder: will fetch from PocketBase and render
  console.log('Loading publication:', slug, article ? '/ article: ' + article : '');
}

/**
 * Load an author profile by slug (placeholder — will be implemented).
 * @param {string} slug - Author slug
 */
function loadAuthor(slug) {
  // Placeholder: will fetch from PocketBase and render
  console.log('Loading author:', slug);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initPage);
