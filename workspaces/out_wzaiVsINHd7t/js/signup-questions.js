/**
 * The Cognitive Shift — Signup Questions Page JS
 *
 * Handles the post-signup questions form:
 * - Checks localStorage for email
 * - Submits community application to PocketBase
 * - Shows success/error states
 */

(function () {
  var formState = document.getElementById("form-state");
  var noEmailState = document.getElementById("no-email-state");
  var successState = document.getElementById("success-state");
  var form = document.getElementById("signup-questions-form");
  var errorEl = document.getElementById("signup-q-error");

  var email = localStorage.getItem("tcs_signup_email");

  // If no email in localStorage, show fallback
  if (!email) {
    formState.style.display = "none";
    noEmailState.style.display = "";
    return;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    // Hide any previous error
    errorEl.style.display = "none";

    var role = form.querySelector("#q-role").value.trim();
    var linkedinUrl = form.querySelector("#q-linkedin").value.trim();
    var twitterUrl = form.querySelector("#q-twitter").value.trim();
    var githubUrl = form.querySelector("#q-github").value.trim();
    var motivation = form.querySelector("#q-motivation").value.trim();

    if (!role || !linkedinUrl || !motivation) {
      showError("Please fill in all required fields.");
      return;
    }

    var button = form.querySelector(".signup-q-submit");
    var originalText = button.textContent;
    button.textContent = "Submitting...";
    button.disabled = true;

    try {
      await createCommunityApplication({
        email: email,
        role: role,
        linkedin_url: linkedinUrl,
        twitter_url: twitterUrl,
        github_url: githubUrl,
        motivation: motivation
      });

      // Success — clear email and show confirmation
      localStorage.removeItem("tcs_signup_email");
      formState.style.display = "none";
      successState.style.display = "";
    } catch (err) {
      console.error("Application submission error:", err);
      button.textContent = originalText;
      button.disabled = false;
      showError("Something went wrong — please try again.");
    }
  });

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = "";
  }
})();
