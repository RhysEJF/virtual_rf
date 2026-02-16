#!/usr/bin/env node

/**
 * Send newsletter emails to all subscribers via Resend.
 *
 * Fetches recently published articles from PocketBase, then sends
 * a digest email to every newsletter_subscribers record.
 *
 * Environment variables:
 *   RESEND_API_KEY  - Resend API key (re_xxx)
 *   POCKETBASE_URL  - PocketBase base URL (https://...)
 *
 * Usage:
 *   RESEND_API_KEY=re_xxx POCKETBASE_URL=https://... node scripts/send-newsletter.js
 *   node scripts/send-newsletter.js --dry-run
 *   node scripts/send-newsletter.js --since 2026-02-01
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const POCKETBASE_URL = process.env.POCKETBASE_URL;
const SITE_URL = "https://thecognitiveshift.com";
const FROM_EMAIL = "The Cognitive Shift <newsletter@thecognitiveshift.com>";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function getFlagValue(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

// Default: articles published in the last 7 days
const sinceFlag = getFlagValue("--since");
const sinceDate = sinceFlag
  ? new Date(sinceFlag)
  : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

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

// ---------------------------------------------------------------------------
// PocketBase helpers
// ---------------------------------------------------------------------------

async function pbFetch(path) {
  const url = `${POCKETBASE_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`PocketBase request failed: ${res.status} ${res.statusText} — ${url}`);
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
// Fetch data
// ---------------------------------------------------------------------------

async function getSubscribers() {
  const subscribers = await fetchAllPages("/api/collections/newsletter_subscribers/records");
  console.log(`Found ${subscribers.length} subscriber(s)`);
  return subscribers;
}

async function getRecentArticles() {
  const sinceISO = sinceDate.toISOString().replace("T", " ");
  const filter = `is_published=true && published_at>='${sinceISO}'`;
  const path = `/api/collections/articles/records?filter=${encodeURIComponent(filter)}&sort=-published_at&expand=author,publication`;
  const articles = await fetchAllPages(path);
  console.log(`Found ${articles.length} article(s) published since ${sinceDate.toISOString().slice(0, 10)}`);
  return articles;
}

// ---------------------------------------------------------------------------
// Email building
// ---------------------------------------------------------------------------

function buildArticleHtml(article) {
  const authorName = article.expand?.author?.display_name || "The Cognitive Shift";
  const pubName = article.expand?.publication?.name || "";
  const articleUrl = `${SITE_URL}/publications/${article.expand?.publication?.slug || ""}/${article.slug}`;
  const excerpt = article.excerpt || "";

  return `
    <tr>
      <td style="padding: 20px 0; border-bottom: 1px solid #e5e0d8;">
        <h2 style="margin: 0 0 8px; font-size: 20px; color: #2d2d2d;">
          <a href="${articleUrl}" style="color: #2d2d2d; text-decoration: none;">${article.title}</a>
        </h2>
        <p style="margin: 0 0 8px; font-size: 14px; color: #666;">
          By ${authorName}${pubName ? ` in ${pubName}` : ""}
        </p>
        <p style="margin: 0 0 12px; font-size: 16px; color: #444; line-height: 1.5;">
          ${excerpt}
        </p>
        <a href="${articleUrl}" style="color: #5a7a5a; text-decoration: underline; font-size: 14px;">
          Read more →
        </a>
      </td>
    </tr>`;
}

function buildEmailHtml(articles) {
  const articleRows = articles.map(buildArticleHtml).join("");

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
              <h1 style="margin: 0 0 8px; font-size: 28px; color: #2d2d2d;">The Cognitive Shift</h1>
              <p style="margin: 0 0 24px; font-size: 16px; color: #888;">New articles this week</p>
            </td>
          </tr>
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${articleRows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 32px;">
              <a href="${SITE_URL}" style="display: inline-block; background-color: #5a7a5a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px;">
                Visit The Cognitive Shift
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 32px; font-size: 12px; color: #999; line-height: 1.5;">
              You received this because you subscribed to The Cognitive Shift newsletter.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText(articles) {
  const lines = ["The Cognitive Shift — New articles this week\n"];

  for (const article of articles) {
    const authorName = article.expand?.author?.display_name || "The Cognitive Shift";
    const articleUrl = `${SITE_URL}/publications/${article.expand?.publication?.slug || ""}/${article.slug}`;
    lines.push(`${article.title}`);
    lines.push(`By ${authorName}`);
    if (article.excerpt) lines.push(article.excerpt);
    lines.push(`Read more: ${articleUrl}\n`);
  }

  lines.push(`---\nVisit: ${SITE_URL}`);
  lines.push("You received this because you subscribed to The Cognitive Shift newsletter.");
  return lines.join("\n");
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
  console.log(dryRun ? "=== DRY RUN ===" : "=== SENDING NEWSLETTER ===");
  console.log(`Since: ${sinceDate.toISOString().slice(0, 10)}\n`);

  const [subscribers, articles] = await Promise.all([
    getSubscribers(),
    getRecentArticles(),
  ]);

  if (articles.length === 0) {
    console.log("\nNo new articles to send. Exiting.");
    return;
  }

  const subject = articles.length === 1
    ? `New: ${articles[0].title}`
    : `${articles.length} new articles on The Cognitive Shift`;

  const html = buildEmailHtml(articles);
  const text = buildEmailText(articles);

  console.log(`\nSubject: ${subject}`);
  console.log(`Recipients: ${subscribers.length}`);
  console.log(`Articles: ${articles.map((a) => a.title).join(", ")}\n`);

  let sent = 0;
  let failed = 0;

  for (const sub of subscribers) {
    if (dryRun) {
      console.log(`[DRY RUN] Would send to: ${sub.email}`);
      sent++;
      continue;
    }

    try {
      const result = await sendEmail(sub.email, subject, html, text);
      console.log(`Sent to ${sub.email} (id: ${result.id})`);
      sent++;
    } catch (err) {
      console.error(`Failed to send to ${sub.email}: ${err.message}`);
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
