# Scripts — The Cognitive Shift

Server-side scripts for sending emails via [Resend](https://resend.com). These are designed to run on Railway (where PocketBase is hosted), not in the browser.

Both scripts use `fetch()` (Node 18+ built-in) and require **no npm dependencies**.

---

## Scripts

### `send-newsletter.js`

Sends a digest email to all newsletter subscribers with recently published articles.

**What it does:**
1. Fetches all `newsletter_subscribers` records from PocketBase
2. Fetches articles published within the last 7 days (or since a custom date)
3. Builds an HTML email listing new articles with titles, excerpts, and links
4. Sends one email per subscriber via the Resend API

**Usage:**

```bash
# Send newsletter with articles from the last 7 days
RESEND_API_KEY=re_xxx POCKETBASE_URL=https://your-pb.railway.app \
  node scripts/send-newsletter.js

# Preview what would be sent (no emails sent)
RESEND_API_KEY=re_xxx POCKETBASE_URL=https://your-pb.railway.app \
  node scripts/send-newsletter.js --dry-run

# Send newsletter with articles since a specific date
RESEND_API_KEY=re_xxx POCKETBASE_URL=https://your-pb.railway.app \
  node scripts/send-newsletter.js --since 2026-02-01
```

---

### `send-community-invite.js`

Sends invite emails to approved community applicants who haven't received one yet.

**What it does:**
1. Authenticates as PocketBase admin (needed to update records)
2. Fetches `community_applications` where `status="approved"` and `sent_invite=false`
3. Sends a welcome/invite email to each applicant via the Resend API
4. Updates the PocketBase record to set `sent_invite=true`

**Usage:**

```bash
# Send invites to all approved applicants
RESEND_API_KEY=re_xxx POCKETBASE_URL=https://your-pb.railway.app \
  POCKETBASE_ADMIN_EMAIL=admin@example.com POCKETBASE_ADMIN_PASSWORD=secret \
  node scripts/send-community-invite.js

# Preview what would be sent (no emails sent, no records updated)
POCKETBASE_URL=https://your-pb.railway.app \
  node scripts/send-community-invite.js --dry-run
```

---

## Environment Variables

| Variable | Required | Used by | Description |
|----------|----------|---------|-------------|
| `RESEND_API_KEY` | Yes (unless `--dry-run`) | Both | Resend API key (`re_xxx`) |
| `POCKETBASE_URL` | Yes | Both | PocketBase base URL (e.g. `https://your-pb.railway.app`) |
| `POCKETBASE_ADMIN_EMAIL` | Yes (unless `--dry-run`) | `send-community-invite.js` | Admin email for PocketBase auth |
| `POCKETBASE_ADMIN_PASSWORD` | Yes (unless `--dry-run`) | `send-community-invite.js` | Admin password for PocketBase auth |

---

## PocketBase Schema Note

The `send-community-invite.js` script expects a `sent_invite` boolean field on the `community_applications` collection. Add this field in the PocketBase admin UI:

- **Field name:** `sent_invite`
- **Type:** bool
- **Default:** `false`

See `POCKETBASE-SCHEMA.md` for the full schema reference.

---

## Automation

These scripts are designed to be run manually for now. To automate later:

- **Newsletter:** Set up a weekly cron job on Railway or wherever Node.js is available
  ```
  0 9 * * 1  RESEND_API_KEY=... POCKETBASE_URL=... node /path/to/scripts/send-newsletter.js
  ```
- **Community invites:** Run after approving applications, or set up a cron that checks every hour
  ```
  0 * * * *  RESEND_API_KEY=... POCKETBASE_URL=... POCKETBASE_ADMIN_EMAIL=... POCKETBASE_ADMIN_PASSWORD=... node /path/to/scripts/send-community-invite.js
  ```
- **PocketBase hooks:** Both could eventually be triggered by PocketBase event hooks (on article publish, on application approval).
