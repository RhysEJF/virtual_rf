/**
 * The Cognitive Shift — Main JS
 *
 * Landing page form handling and newsletter modal logic for article pages.
 */

// ---------------------------------------------------------------------------
// Landing page signup forms
// ---------------------------------------------------------------------------

/**
 * Show an inline error message below a form.
 * @param {HTMLFormElement} form
 * @param {string} message
 */
function showFormError(form, message) {
  // Remove any existing error
  var existing = form.parentElement.querySelector(".signup-error");
  if (existing) existing.remove();

  var el = document.createElement("div");
  el.className = "signup-error";
  el.textContent = message;
  el.style.color = "#c0392b";
  el.style.fontSize = "0.85rem";
  el.style.marginTop = "0.5rem";
  form.insertAdjacentElement("afterend", el);

  setTimeout(function () {
    if (el.parentElement) el.remove();
  }, 5000);
}

/**
 * Handle landing page signup form submission.
 * Calls createNewsletterSubscriber, stores email in localStorage, redirects.
 * @param {Event} event
 */
async function handleLandingSignup(event) {
  event.preventDefault();
  var form = event.target;
  var emailInput = form.querySelector('input[type="email"]');
  var button = form.querySelector("button");
  var email = emailInput.value.trim();

  if (!email) return;

  var originalText = button.textContent;
  button.textContent = "Joining...";
  button.disabled = true;

  try {
    await createNewsletterSubscriber(email, "landing");
    localStorage.setItem("tcs_signup_email", email);
    button.textContent = "Welcome";
    emailInput.value = "";
    setTimeout(function () {
      window.location.href = "/signup/?source=landing";
    }, 800);
  } catch (err) {
    console.error("Signup error:", err);
    button.textContent = originalText;
    button.disabled = false;
    showFormError(form, "Something went wrong — please try again.");
  }
}

// ---------------------------------------------------------------------------
// Newsletter modal (used on article pages)
// ---------------------------------------------------------------------------

var _modalTriggered = false;

/**
 * Attach a scroll listener that triggers the newsletter modal once the reader
 * has scrolled past 30% of .article-content.
 */
function scrollTrigger() {
  var content = document.querySelector(".article-content");
  if (!content) return;

  function onScroll() {
    if (_modalTriggered) return;

    var rect = content.getBoundingClientRect();
    var contentHeight = content.offsetHeight;
    var scrolledIntoContent = -rect.top + window.innerHeight;
    var threshold = contentHeight * 0.3;

    if (scrolledIntoContent >= threshold) {
      _modalTriggered = true;
      window.removeEventListener("scroll", onScroll);
      showModal();
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
}

/**
 * Show the newsletter signup modal.
 * Skips if the user has already subscribed or dismissed via localStorage.
 */
function showModal() {
  if (localStorage.getItem("tcs_newsletter")) return;

  // Build overlay
  var overlay = document.createElement("div");
  overlay.id = "tcs-modal-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;" +
    "display:flex;align-items:center;justify-content:center;padding:1rem;";

  // Build modal card
  var modal = document.createElement("div");
  modal.style.cssText =
    "background:#1a1a1a;color:#e8e0d4;border:1px solid rgba(200,164,92,0.25);" +
    "border-radius:8px;max-width:420px;width:100%;padding:2rem;position:relative;" +
    "font-family:'Libre Franklin',sans-serif;";

  // Close button
  var closeBtn = document.createElement("button");
  closeBtn.textContent = "\u00d7";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.style.cssText =
    "position:absolute;top:0.75rem;right:1rem;background:none;border:none;" +
    "color:#e8e0d4;font-size:1.5rem;cursor:pointer;opacity:0.6;";
  closeBtn.addEventListener("click", function () {
    overlay.remove();
  });

  // Heading
  var heading = document.createElement("h3");
  heading.textContent = "Enjoying this piece?";
  heading.style.cssText =
    "font-family:'Playfair Display',serif;font-size:1.4rem;margin:0 0 0.5rem;";

  // Subtext
  var sub = document.createElement("p");
  sub.textContent = "Get the next dispatch delivered free. No spam, unsubscribe anytime.";
  sub.style.cssText = "font-size:0.9rem;opacity:0.8;margin:0 0 1.25rem;line-height:1.5;";

  // Form
  var form = document.createElement("form");
  form.style.cssText = "display:flex;gap:0.5rem;margin-bottom:0.75rem;";

  var input = document.createElement("input");
  input.type = "email";
  input.placeholder = "your@email.com";
  input.required = true;
  input.style.cssText =
    "flex:1;padding:0.6rem 0.75rem;border:1px solid rgba(200,164,92,0.3);" +
    "border-radius:4px;background:#111;color:#e8e0d4;font-size:0.9rem;" +
    "font-family:'Libre Franklin',sans-serif;outline:none;";

  var submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.textContent = "Subscribe";
  submitBtn.style.cssText =
    "padding:0.6rem 1.2rem;background:#c8a45c;color:#1a1a1a;border:none;" +
    "border-radius:4px;font-weight:500;cursor:pointer;font-size:0.9rem;" +
    "font-family:'Libre Franklin',sans-serif;";

  form.appendChild(input);
  form.appendChild(submitBtn);

  // Subscribe handler
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = input.value.trim();
    if (!email) return;

    submitBtn.textContent = "Joining...";
    submitBtn.disabled = true;

    try {
      await createNewsletterSubscriber(email, "article_modal");
      localStorage.setItem("tcs_newsletter", "subscribed");
      // Show confirmation
      modal.innerHTML = "";
      var thanks = document.createElement("p");
      thanks.textContent = "You're in. Watch your inbox.";
      thanks.style.cssText =
        "font-family:'Playfair Display',serif;font-size:1.2rem;text-align:center;" +
        "padding:1rem 0;margin:0;";
      modal.appendChild(thanks);
      setTimeout(function () {
        overlay.remove();
      }, 2000);
    } catch (err) {
      console.error("Modal signup error:", err);
      submitBtn.textContent = "Try again";
      submitBtn.disabled = false;
    }
  });

  // "Already subscribed" link
  var alreadyLink = document.createElement("button");
  alreadyLink.textContent = "Already subscribed";
  alreadyLink.style.cssText =
    "background:none;border:none;color:#c8a45c;font-size:0.8rem;cursor:pointer;" +
    "opacity:0.7;padding:0;font-family:'Libre Franklin',sans-serif;";
  alreadyLink.addEventListener("click", function () {
    localStorage.setItem("tcs_newsletter", "existing");
    overlay.remove();
  });

  // Assemble
  modal.appendChild(closeBtn);
  modal.appendChild(heading);
  modal.appendChild(sub);
  modal.appendChild(form);
  modal.appendChild(alreadyLink);
  overlay.appendChild(modal);

  // Close on overlay click (not modal click)
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Page initialization
// ---------------------------------------------------------------------------

function initPage() {
  // Wire up landing page signup forms
  var signupForms = document.querySelectorAll("#hero-signup-form, #bottom-signup-form");
  signupForms.forEach(function (form) {
    form.addEventListener("submit", handleLandingSignup);
  });

  // Activate newsletter modal scroll trigger on article pages
  if (document.querySelector(".article-content")) {
    scrollTrigger();
  }
}

document.addEventListener("DOMContentLoaded", initPage);
