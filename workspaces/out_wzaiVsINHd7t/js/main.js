/**
 * The Cognitive Shift — Main JS
 *
 * Landing page form handling.
 * Newsletter modal logic lives in newsletter-modal.js.
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
// Page initialization
// ---------------------------------------------------------------------------

function initPage() {
  // Wire up landing page signup forms
  var signupForms = document.querySelectorAll("#hero-signup-form, #bottom-signup-form");
  signupForms.forEach(function (form) {
    form.addEventListener("submit", handleLandingSignup);
  });
}

document.addEventListener("DOMContentLoaded", initPage);
