#!/usr/bin/env node

/**
 * Send community invite emails to approved applicants via Resend.
 *
 * Fetches community_applications with status="approved" and sent_invite=false
 * from PocketBase, sends an invite email, then marks sent_invite=true.
 *
 * Environment variables:
 *   RESEND_API_KEY  - Resend API key (re_xxx)
 *   POCKETBASE_URL  - PocketBase base URL (https://...)
 *   POCKETBASE_ADMIN_EMAIL    - Admin email for auth (needed for PATCH)
 *   POCKETBASE_ADMIN_PASSWORD - Admin password for auth
 *
 * Usage:
 *   RESEND_API_KEY=re_xxx POCKETBASE_URL=https://... \
 *     POCKETBASE_ADMIN_EMAIL=admin@example.com POCKETBASE_ADMIN_PASSWORD=secret \
 *     node scripts/send-community-invite.js
 *
 *   node scripts/send-community-invite.js --dry-run
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const POCKETBASE_URL = process.env.POCKETBASE_URL;
const POCKETBASE_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL;
const POCKETBASE_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD;
const SITE_URL = "https://thecognitiveshift.com";
const FROM_EMAIL = "The Cognitive Shift <community@thecognitiveshift.com>";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

if (!dryRun && !RESEND_API_KEY) {
  console.error("ERROR: RESEND_API_KEY environment variable is required");
  process.exit(1);
}

if (!POCKETBASE_URL) {
  console.error("ERROR: POCKETBASE_URL environment variable is required");
  process.exit(1);
}

if (!dryRun && (!POCKETBASE_ADMIN_EMAIL || !POCKETBASE_ADMIN_PASSWORD)) {
  console.error("ERROR: POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD are required to update records");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// PocketBase helpers
// ---------------------------------------------------------------------------

let adminToken = null;

async function authenticateAdmin() {
  const res = await fetch(`${POCKETBASE_URL}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: POCKETBASE_ADMIN_EMAIL,
      password: POCKETBASE_ADMIN_PASSWORD,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Admin auth failed: ${res.status} — ${body}`);
  }

  const data = await res.json();
  adminToken = data.token;
  console.log("Authenticated as admin");
}

async function pbFetch(path) {
  const url = `${POCKETBASE_URL}${path}`;
  const headers = {};
  if (adminToken) headers.Authorization = adminToken;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`PocketBase request failed: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json();
}

async function pbPatch(path, body) {
  const url = `${POCKETBASE_URL}${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: adminToken,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PocketBase PATCH failed: ${res.status} — ${text}`);
  }
  return res.json();
}

async function fetchAllPages(path) {
  let page = 1;
  const perPage = 200;
  const items = [];

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const data = await pbFetch(`${path}${separator}page=${page}&perPage=${perPage}`);
    items.push(...data.items);
    if (page >= data.totalPages) break;
    page++;
  }

  return items;
}

// ---------------------------------------------------------------------------
// Fetch approved applications that haven't been invited
// ---------------------------------------------------------------------------

async function getPendingInvites() {
  const filter = `status='approved' && sent_invite=false`;
  const path = `/api/collections/community_applications/records?filter=${encodeURIComponent(filter)}`;
  const applications = await fetchAllPages(path);
  console.log(`Found ${applications.length} approved application(s) needing invite`);
  return applications;
}

// ---------------------------------------------------------------------------
// Email building
// ---------------------------------------------------------------------------

function buildInviteHtml(application) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background-color: #f5f0eb; font-family: Georgia, 'Times New Roman', serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f0eb; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; padding: 40px;">
          <tr>
            <td>
              <h1 style="margin: 0 0 8px; font-size: 28px; color: #2d2d2d;">Welcome to The Cognitive Shift</h1>
              <p style="margin: 0 0 24px; font-size: 16px; color: #888;">Your community application has been approved</p>
            </td>
          </tr>
          <tr>
            <td style="font-size: 16px; color: #444; line-height: 1.6;">
              <p>Hi there,</p>
              <p>
                Great news — your application to join The Cognitive Shift community has been approved.
                We're building a space for leaders navigating the intersection of technology, AI, and human potential.
              </p>
              <p>
                Here's what happens next:
              </p>
              <ul style="padding-left: 20px;">
                <li>You'll receive a separate invite to our community platform shortly</li>
                <li>Introduce yourself — we'd love to hear what you're working on</li>
                <li>Explore ongoing discussions and connect with other members</li>
              </ul>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px;">
              <a href="${SITE_URL}" style="display: inline-block; background-color: #5a7a5a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px;">
                Visit The Cognitive Shift
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 32px; font-size: 12px; color: #999; line-height: 1.5;">
              You received this because you applied to join The Cognitive Shift community.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildInviteText() {
  return `Welcome to The Cognitive Shift

Your community application has been approved!

Great news — your application to join The Cognitive Shift community has been approved. We're building a space for leaders navigating the intersection of technology, AI, and human potential.

Here's what happens next:
- You'll receive a separate invite to our community platform shortly
- Introduce yourself — we'd love to hear what you're working on
- Explore ongoing discussions and connect with other members

Visit: ${SITE_URL}

---
You received this because you applied to join The Cognitive Shift community.`;
}

// ---------------------------------------------------------------------------
// Send via Resend
// ---------------------------------------------------------------------------

async function sendEmail(to, subject, html, text) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error: ${res.status} — ${body}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== SENDING COMMUNITY INVITES ===\n");

  if (!dryRun) {
    await authenticateAdmin();
  }

  const applications = await getPendingInvites();

  if (applications.length === 0) {
    console.log("\nNo pending invites to send. Exiting.");
    return;
  }

  const subject = "You're in — Welcome to The Cognitive Shift Community";
  const text = buildInviteText();

  let sent = 0;
  let failed = 0;

  for (const app of applications) {
    const html = buildInviteHtml(app);

    if (dryRun) {
      console.log(`[DRY RUN] Would send invite to: ${app.email} (application: ${app.id})`);
      sent++;
      continue;
    }

    try {
      const result = await sendEmail(app.email, subject, html, text);
      console.log(`Sent invite to ${app.email} (resend id: ${result.id})`);

      // Mark as sent in PocketBase
      await pbPatch(`/api/collections/community_applications/records/${app.id}`, {
        sent_invite: true,
      });
      console.log(`  → Marked sent_invite=true for ${app.id}`);

      sent++;
    } catch (err) {
      console.error(`Failed for ${app.email}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Sent: ${sent}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
