#!/bin/bash
# Flow — First-Time Setup
# Creates the data directory structure and installs the CLI.

set -e

FLOW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$HOME/flow-data"

echo ""
echo "  ✦ F L O W  — Setup"
echo "  ─────────────────────"
echo ""

# 1. Create data directories
echo "  Creating data directories..."
mkdir -p "$DATA_DIR"/{data,workspaces,skills,integrations}
echo "  ✓ $DATA_DIR/"

# 2. Bootstrap flow-cli integration
if [ ! -d "$DATA_DIR/integrations/flow-cli" ]; then
  echo "  Creating default flow-cli integration..."
  mkdir -p "$DATA_DIR/integrations/flow-cli"

  # Create skill.md
  if [ -f "$DATA_DIR/skills/flow-cli.md" ]; then
    # Existing skill found — add frontmatter and copy
    echo '---' > "$DATA_DIR/integrations/flow-cli/skill.md"
    echo 'name: Flow CLI' >> "$DATA_DIR/integrations/flow-cli/skill.md"
    echo 'description: Manage AI workforce through the Flow CLI' >> "$DATA_DIR/integrations/flow-cli/skill.md"
    echo '---' >> "$DATA_DIR/integrations/flow-cli/skill.md"
    echo '' >> "$DATA_DIR/integrations/flow-cli/skill.md"
    cat "$DATA_DIR/skills/flow-cli.md" >> "$DATA_DIR/integrations/flow-cli/skill.md"
  else
    cat > "$DATA_DIR/integrations/flow-cli/skill.md" << 'SKILL'
---
name: Flow CLI
description: Manage AI workforce through the Flow CLI
---

# Flow CLI Skill

Use `flow` commands to manage outcomes, tasks, and workers.
Run `flow --help` for available commands.
SKILL
  fi

  # Create permissions.json
  cat > "$DATA_DIR/integrations/flow-cli/permissions.json" << 'PERMS'
[
  "Bash(flow *)",
  "Bash(curl -s http://localhost*)",
  "Bash(curl http://localhost*)",
  "Bash(cat *)",
  "Bash(ls *)",
  "Bash(head *)",
  "Bash(tail *)",
  "Bash(wc *)",
  "Bash(npm run dev*)",
  "Bash(npm run build*)",
  "Read",
  "Grep",
  "Glob"
]
PERMS

  echo "  ✓ flow-cli integration"
fi

# 3. Install app dependencies
echo ""
echo "  Installing dependencies..."
cd "$FLOW_DIR"
npm install --silent 2>/dev/null
echo "  ✓ App dependencies"

# 4. Install and link CLI
echo "  Setting up CLI..."
cd "$FLOW_DIR/cli"
npm install --silent 2>/dev/null
npm run build --silent 2>/dev/null
npm link --silent 2>/dev/null
echo "  ✓ flow command linked"

# 5. Check Claude CLI
echo ""
if command -v claude &> /dev/null; then
  echo "  ✓ Claude CLI found"
else
  echo "  ⚠ Claude CLI not found"
  echo "    Install it: https://docs.anthropic.com/en/docs/claude-code"
  echo "    Flow's chat mode requires Claude CLI to be installed."
fi

# 6. Done
echo ""
echo "  ─────────────────────"
echo "  ✓ Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Start the server:  npm run dev"
echo "    2. Launch Flow:       flow"
echo ""
echo "  Just type 'flow' to start chatting."
echo ""
