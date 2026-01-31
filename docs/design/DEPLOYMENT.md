# Deployment - Design

> Infrastructure setup for always-on operation with remote access.

---

## Architecture

### Target Setup

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INTERNET                                     │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │   Telegram   │  │   Browser    │  │     CLI      │               │
│  │   (phone)    │  │  (anywhere)  │  │  (terminal)  │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                 │                        │
│         └─────────────────┼─────────────────┘                        │
│                           │                                          │
│                           ▼                                          │
│              ┌────────────────────────┐                              │
│              │   Cloudflare Tunnel    │                              │
│              │   your-domain.com      │                              │
│              └───────────┬────────────┘                              │
│                          │                                           │
└──────────────────────────┼───────────────────────────────────────────┘
                           │
                           │ Encrypted tunnel
                           │
┌──────────────────────────┼───────────────────────────────────────────┐
│                          ▼                     YOUR HOME NETWORK     │
│              ┌────────────────────────┐                              │
│              │   Mac Mini             │                              │
│              │   ─────────            │                              │
│              │                        │                              │
│              │   Next.js (port 3000)  │                              │
│              │   SQLite (data/)       │                              │
│              │   Claude CLI           │                              │
│              │   Workers (processes)  │                              │
│              │                        │                              │
│              │   Always on            │                              │
│              │   Low power (~10W)     │                              │
│              └────────────────────────┘                              │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Components

### Mac Mini Setup

**Hardware Requirements:**
- Mac Mini (M1/M2/M3) - Any recent model
- 16GB+ RAM recommended for multiple workers
- 256GB+ SSD for workspace and outputs
- Wired ethernet for reliability

**Software Requirements:**
```bash
# Node.js (via nvm)
nvm install 20
nvm use 20

# Claude CLI
npm install -g @anthropic-ai/claude-cli
claude auth login

# Project
git clone git@github.com:you/virtual_rf.git
cd virtual_rf
npm install

# Auto-start on boot (launchd)
# See: Mac Mini Service Configuration below
```

**Environment Setup:**
```bash
# .env.local
NODE_ENV=production
DATABASE_PATH=./data/twin.db

# Optional API keys for skills
SERPER_API_KEY=xxx
FIRECRAWL_API_KEY=xxx
```

### Cloudflare Tunnel

**Why Cloudflare Tunnel:**
- No port forwarding needed
- Works behind CGNAT, strict firewalls
- Free HTTPS with your domain
- Built-in DDoS protection
- Zero Trust access controls (optional)

**Setup:**

```bash
# Install cloudflared
brew install cloudflared

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create digital-twin

# Configure tunnel
cat > ~/.cloudflared/config.yml << EOF
tunnel: <TUNNEL_ID>
credentials-file: /Users/you/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: rf.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
EOF

# Route DNS
cloudflared tunnel route dns digital-twin rf.yourdomain.com

# Run tunnel
cloudflared tunnel run digital-twin
```

**As a Service:**
```bash
# Install as launchd service
sudo cloudflared service install

# Starts automatically on boot
```

### Telegram Bot Setup

**Create Bot:**
1. Message @BotFather on Telegram
2. `/newbot` → name it (e.g., "RF Assistant")
3. Save the bot token

**Webhook Configuration:**
```bash
# Set webhook URL (requires HTTPS - tunnel provides this)
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://rf.yourdomain.com/api/telegram/webhook"
```

**Bot Permissions:**
- Enable inline mode (optional)
- Set commands list:
```
outcomes - List active outcomes
status - Current worker status
switch - Switch outcome context
pause - Pause active workers
help - Show available commands
```

---

## Service Configuration

### Mac Mini Service (launchd)

Create `~/Library/LaunchAgents/com.digitaltwin.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.digitaltwin.server</string>

    <key>ProgramArguments</key>
    <array>
        <string>/Users/you/.nvm/versions/node/v20.x.x/bin/node</string>
        <string>/Users/you/virtual_rf/node_modules/.bin/next</string>
        <string>start</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/Users/you/virtual_rf</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>/Users/you/.nvm/versions/node/v20.x.x/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/Users/you/virtual_rf/logs/server.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/you/virtual_rf/logs/server.error.log</string>
</dict>
</plist>
```

**Load service:**
```bash
launchctl load ~/Library/LaunchAgents/com.digitaltwin.server.plist
```

### Process Management

**Monitor workers:**
```bash
# Check active Node processes
ps aux | grep -E "(next|claude)"

# Watch resource usage
top -pid $(pgrep -f "next start")
```

**Graceful restart:**
```bash
# Reload after code changes
launchctl unload ~/Library/LaunchAgents/com.digitaltwin.server.plist
cd ~/virtual_rf && git pull && npm install && npm run build
launchctl load ~/Library/LaunchAgents/com.digitaltwin.server.plist
```

---

## Security

### Telegram Authentication

```typescript
// Verify webhook requests are from Telegram
function verifyTelegramWebhook(req: Request): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secretToken = req.headers.get('X-Telegram-Bot-Api-Secret-Token');

  // Set secret token when configuring webhook:
  // ?secret_token=your-secret
  return secretToken === process.env.TELEGRAM_WEBHOOK_SECRET;
}
```

### Cloudflare Access (Optional)

For additional security, enable Cloudflare Access:

1. Create Access Application in Cloudflare dashboard
2. Set authentication policy (email, SSO, etc.)
3. Users must authenticate before reaching your tunnel

This adds a login layer without changing your code.

### API Rate Limiting

```typescript
// Simple rate limiting for chat interfaces
const rateLimits = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 20;

  const timestamps = rateLimits.get(userId) || [];
  const recent = timestamps.filter(t => t > now - windowMs);

  if (recent.length >= maxRequests) {
    return false;
  }

  recent.push(now);
  rateLimits.set(userId, recent);
  return true;
}
```

---

## Backup Strategy

### SQLite Backup

```bash
# Daily backup script
#!/bin/bash
BACKUP_DIR="/Users/you/backups/digital-twin"
DB_PATH="/Users/you/virtual_rf/data/twin.db"
DATE=$(date +%Y-%m-%d)

mkdir -p $BACKUP_DIR
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/twin-$DATE.db'"

# Keep last 30 days
find $BACKUP_DIR -name "twin-*.db" -mtime +30 -delete

# Optional: sync to cloud
# rclone sync $BACKUP_DIR remote:digital-twin-backups
```

**Schedule via cron:**
```bash
# crontab -e
0 3 * * * /Users/you/scripts/backup-digital-twin.sh
```

### Workspace Backup

Workspaces contain generated code and outputs:

```bash
# Selective backup of completed outcomes
rsync -av --include='*/outputs/' --exclude='*/node_modules/' \
  ~/virtual_rf/workspaces/ ~/backups/workspaces/
```

---

## Monitoring

### Health Check Endpoint

```typescript
// app/api/health/route.ts
export async function GET() {
  const checks = {
    server: true,
    database: await checkDatabase(),
    claude: await checkClaudeCli(),
    workers: await getActiveWorkerCount(),
  };

  const healthy = Object.values(checks).every(v => v !== false);

  return Response.json({
    status: healthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString()
  }, { status: healthy ? 200 : 503 });
}
```

### Uptime Monitoring

Use external service (UptimeRobot, Better Uptime) to ping:
```
https://rf.yourdomain.com/api/health
```

Alert via Telegram if down:
```bash
# UptimeRobot can send alerts to Telegram directly
# Or use webhook → your bot → notification
```

---

## Resource Limits

### Worker Constraints

```typescript
// lib/config/limits.ts
export const LIMITS = {
  // Maximum concurrent workers per outcome
  maxWorkersPerOutcome: 3,

  // Maximum total workers across all outcomes
  maxTotalWorkers: 5,

  // Worker timeout (prevents runaway processes)
  workerTimeoutMs: 30 * 60 * 1000, // 30 minutes

  // Maximum pending tasks to prevent queue explosion
  maxPendingTasks: 100,
};
```

### Memory Management

Mac Mini with 16GB RAM:
- Next.js server: ~500MB
- Each Claude CLI worker: ~200-500MB
- SQLite: Minimal
- **Comfortable limit: 5 concurrent workers**

For M1/M2/M3 with unified memory, the GPU isn't used by Claude CLI, so full RAM is available for workers.

---

## Deployment Checklist

### Initial Setup

- [ ] Mac Mini connected to power and ethernet
- [ ] macOS user account created (non-admin for security)
- [ ] Node.js installed via nvm
- [ ] Claude CLI installed and authenticated
- [ ] Project cloned and dependencies installed
- [ ] `.env.local` configured
- [ ] Production build created (`npm run build`)
- [ ] Cloudflare account created
- [ ] Domain pointed to Cloudflare
- [ ] Tunnel created and configured
- [ ] Telegram bot created with @BotFather
- [ ] Webhook URL set

### Verification

- [ ] `curl https://rf.yourdomain.com/api/health` returns healthy
- [ ] Telegram bot responds to `/status`
- [ ] Can create outcome via Telegram
- [ ] Workers spawn and complete tasks
- [ ] Notifications arrive for completions

### Hardening

- [ ] Launchd services configured for auto-start
- [ ] Backup script scheduled
- [ ] Rate limiting enabled
- [ ] Cloudflare Access enabled (optional)
- [ ] Uptime monitoring configured
- [ ] Log rotation configured

---

## Dependencies

**Infrastructure:**
- Mac Mini (or similar always-on machine)
- Cloudflare account (free tier works)
- Domain name
- Telegram account

**Software:**
- Node.js 20+
- Claude CLI
- cloudflared
- SQLite (built-in)

---

## Troubleshooting

### Tunnel Not Connecting

```bash
# Check tunnel status
cloudflared tunnel info digital-twin

# View tunnel logs
journalctl -u cloudflared -f  # Linux
log show --predicate 'subsystem == "com.cloudflare.cloudflared"' --last 1h  # macOS
```

### Workers Not Starting

```bash
# Check Claude CLI auth
claude auth status

# Test Claude CLI directly
echo "Hello" | claude -p "Say hello back"

# Check process limits
ulimit -u  # Max user processes
```

### Database Locked

```bash
# Find processes using database
fuser data/twin.db

# If stuck, ensure only one Next.js instance
pkill -f "next start"
launchctl load ~/Library/LaunchAgents/com.digitaltwin.server.plist
```
