# PocketBase Collection Schema — The Cognitive Shift

Reference document for all PocketBase collections used by The Cognitive Shift platform. This schema must be created manually in the PocketBase admin UI.

---

## Content Collections

### `users` (auth collection)

PocketBase provides a built-in `users` auth collection with `email`, `password`, `username`, etc. Extend it with these additional fields:

| Field | Type | Required | Options | Description |
|-------|------|----------|---------|-------------|
| `display_name` | text | yes | — | Public display name |
| `slug` | text | yes | unique | URL-friendly identifier (e.g. `john-doe`) |
| `bio` | text | no | — | Short author bio |
| `avatar` | file | no | — | Profile photo |
| `role` | select | no | `admin`, `editor`, `author` | Permission level |

**API Rules:**

| Action | Rule |
|--------|------|
| List / View | Public (empty string `""`) |
| Create | Admin only (`@request.auth.role = "admin"`) |
| Update | Admin only |
| Delete | Admin only |

---

### `publications`

| Field | Type | Required | Options | Description |
|-------|------|----------|---------|-------------|
| `name` | text | yes | — | Publication title |
| `slug` | text | yes | unique | URL-friendly identifier (e.g. `ai-security`) |
| `description` | editor | no | — | Rich text description |
| `cover_image` | file | no | — | Hero image for publication page |
| `owner` | relation → `users` | yes | single | Primary owner |
| `editors` | relation → `users` | no | multiple | Additional editors |
| `is_active` | bool | no | default `true` | Whether accepting new articles |

**API Rules:**

| Action | Rule |
|--------|------|
| List / View | Public (`""`) |
| Create | Admin only |
| Update | Admin only |
| Delete | Admin only |

---

### `articles`

| Field | Type | Required | Options | Description |
|-------|------|----------|---------|-------------|
| `title` | text | yes | — | Article title |
| `slug` | text | yes | unique | URL-friendly identifier |
| `excerpt` | text | yes | — | Short description for cards/previews (plain text, 1-3 sentences) |
| `content` | editor | yes | — | Full article body (rich text) |
| `author` | relation → `users` | yes | single | Who wrote it |
| `publication` | relation → `publications` | yes | single | Which publication it belongs to |
| `featured_image` | file | no | — | Header image |
| `is_published` | bool | no | default `false` | Draft vs published |
| `published_at` | date | no | — | When it went live |
| `tags` | JSON | no | — | Array of tag strings (e.g. `["ai", "security"]`) |

**API Rules:**

| Action | Rule |
|--------|------|
| List / View | Public WHERE published (`is_published = true`) — use filter: `@request.auth.id != "" \|\| is_published = true` |
| Create | Admin only |
| Update | Admin only |
| Delete | Admin only |

> **Note:** The list/view rule ensures only published articles are visible to unauthenticated users, while admins can see drafts.

---

## Form Collections

These collections accept unauthenticated `POST` requests directly from the browser. **The create rule must be set to allow public access.**

### `newsletter_subscribers`

| Field | Type | Required | Options | Description |
|-------|------|----------|---------|-------------|
| `email` | email | yes | unique | Subscriber email |
| `source` | text | no | — | Where they signed up from (`"landing"`, `"article_modal"`) |
| `subscribed_at` | date | no | — | When they subscribed |

**API Rules:**

| Action | Rule |
|--------|------|
| List / View | Admin only |
| **Create** | **Public** (empty string `""` — allows unauthenticated POST) |
| Update | Admin only |
| Delete | Admin only |

> **Important:** The create rule must be an empty string `""` (not `null`). An empty string means "allow everyone". A `null` or missing rule means "deny everyone".

---

### `community_applications`

| Field | Type | Required | Options | Description |
|-------|------|----------|---------|-------------|
| `email` | email | yes | unique | Applicant email |
| `role` | text | yes | — | Job title and company |
| `linkedin_url` | url | yes | — | LinkedIn profile |
| `twitter_url` | url | no | — | X/Twitter profile |
| `github_url` | url | no | — | GitHub profile |
| `motivation` | text | yes | — | What they want from the community |
| `status` | select | no | `pending`, `approved`, `rejected` (default `pending`) | Application status |
| `sent_invite` | bool | no | default `false` | Whether invite email has been sent |
| `applied_at` | date | no | — | When they applied |

**API Rules:**

| Action | Rule |
|--------|------|
| List / View | Admin only |
| **Create** | **Public** (empty string `""` — allows unauthenticated POST) |
| Update | Admin only |
| Delete | Admin only |

> **Important:** Same as newsletter — browser writes directly. The create rule must be an empty string to allow unauthenticated requests.

---

## Resend Integration

Resend is used **only for sending emails**, never for form collection. All form data lives in PocketBase.

### Newsletter emails (new content notification)

| Property | Value |
|----------|-------|
| **Trigger** | A new article is published (`is_published` flipped to `true`) |
| **Action** | Query all `newsletter_subscribers` from PocketBase, send email via Resend API |
| **Resend contact label** | `newsletter` |
| **Implementation** | Server-side script on Railway (where PocketBase is hosted), or manual initially. Can be automated later with PocketBase hooks or a cron job. |

### Community invite emails

| Property | Value |
|----------|-------|
| **Trigger** | Admin changes a `community_applications` record `status` to `approved` |
| **Action** | Send community invite email to that applicant via Resend API |
| **Resend contact label** | `community_member` |
| **Implementation** | Server-side script or PocketBase hook. |

---

## API Filter Examples

### Reading data

```
# List published articles (newest first, with author and publication expanded)
GET /api/collections/articles/records?filter=(is_published=true)&sort=-published_at&expand=author,publication

# Articles by publication slug
GET /api/collections/articles/records?filter=(publication.slug='ai-security' %26%26 is_published=true)

# Single article by slug
GET /api/collections/articles/records?filter=(slug='my-article')&expand=author,publication

# All active publications
GET /api/collections/publications/records?filter=(is_active=true)&expand=owner

# Author profile by slug
GET /api/collections/users/records?filter=(slug='john-doe')
```

### Writing data (unauthenticated)

```bash
# Subscribe to newsletter
curl -X POST https://YOUR-PB-URL/api/collections/newsletter_subscribers/records \
  -H "Content-Type: application/json" \
  -d '{"email": "reader@example.com", "source": "landing", "subscribed_at": "2026-02-16"}'

# Submit community application
curl -X POST https://YOUR-PB-URL/api/collections/community_applications/records \
  -H "Content-Type: application/json" \
  -d '{
    "email": "applicant@example.com",
    "role": "Engineering Lead at Acme Corp",
    "linkedin_url": "https://linkedin.com/in/applicant",
    "twitter_url": "https://x.com/applicant",
    "motivation": "I want to connect with other leaders navigating AI adoption.",
    "applied_at": "2026-02-16"
  }'
```

---

## Setup Instructions

This schema must be created in the PocketBase admin UI (`/_/`).

### For each collection:

1. **Create the collection** with the name and type specified above
   - `users` is the built-in auth collection — just add the extra fields
   - All others are "base" collections
2. **Add fields** with the types, required flags, and options listed
3. **Set API rules** as documented — pay special attention to:
   - `newsletter_subscribers` and `community_applications` need **public create** (empty string `""`)
   - `articles` list/view rule should filter by `is_published`
4. **Test unauthenticated creates** with curl:
   ```bash
   curl -X POST http://localhost:8090/api/collections/newsletter_subscribers/records \
     -H "Content-Type: application/json" \
     -d '{"email": "test@test.com", "source": "test"}'
   ```
   A `200` response confirms the public create rule is working.

### After schema setup:

Verify that `js/pocketbase.js` helper functions use these exact collection names:
- `newsletter_subscribers`
- `community_applications`
- `articles`
- `publications`
- `users`

The existing `PocketBaseClient` in `js/pocketbase.js` is a generic `create`/`list`/`get` wrapper — collection names are passed as arguments, so no code changes are needed as long as callers use the correct names.
