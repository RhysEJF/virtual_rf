# Ralph Wiggum Implementation Files
## Ready-to-Copy Files for Your Project

This companion document contains all the files you need to set up Ralph Wiggum in your project. Copy each file to the indicated location.

---

## File 1: plans/ralph.sh

Location: `plans/ralph.sh`

```bash
#!/bin/bash

# =============================================================================
# Ralph Wiggum Loop Implementation
# Based on Geoffrey Huntley's technique + Matt Pocock's PRD approach
# =============================================================================

set -e  # Exit on error

# Configuration
MAX_ITERATIONS=${1:-10}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
COMPLETION_SIGNAL="PROMISE_COMPLETE_HERE"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
log_success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${NC} $1"; }
log_error() { echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC} $1"; }
log_step() { echo -e "${CYAN}[$(date '+%H:%M:%S')] →${NC} $1"; }

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check for Claude CLI
    if ! command -v claude &> /dev/null; then
        log_error "Claude Code CLI not found"
        echo "  Install from: https://code.claude.com"
        exit 1
    fi
    
    # Check for PRD file
    if [ ! -f "$PRD_FILE" ]; then
        log_error "PRD file not found at $PRD_FILE"
        echo "  Create your product requirements document first"
        exit 1
    fi
    
    # Initialize progress file if needed
    if [ ! -f "$PROGRESS_FILE" ]; then
        cat > "$PROGRESS_FILE" << 'EOF'
# Progress Log

## Instructions
- APPEND to this file, never overwrite previous entries
- Include: date/time, feature completed, observations, next steps
- Keep entries concise but informative

---

## Session History

EOF
        log_info "Created progress.txt"
    fi
    
    # Check for CLAUDE.md
    if [ ! -f "$PROJECT_ROOT/CLAUDE.md" ]; then
        log_warning "CLAUDE.md not found - creating minimal version"
        cat > "$PROJECT_ROOT/CLAUDE.md" << 'EOF'
# Project Instructions

## Commands
- `npm run typecheck` - Type checking
- `npm run test` - Run tests
- `npm run lint` - Linting

## Rules
- All code must pass type checks
- All code must pass tests
- Commit after each feature
EOF
    fi
    
    log_success "Prerequisites OK"
}

# Print usage
print_usage() {
    echo ""
    echo "Usage: $0 <max_iterations> [options]"
    echo ""
    echo "Arguments:"
    echo "  max_iterations    Maximum number of iterations (required)"
    echo ""
    echo "Options:"
    echo "  --help           Show this help message"
    echo "  --dry-run        Show what would be done without executing"
    echo ""
    echo "Examples:"
    echo "  $0 20            Run up to 20 iterations"
    echo "  $0 100           Run overnight with 100 max iterations"
    echo ""
}

# Validate arguments
if [ -z "$1" ] || [ "$1" == "--help" ]; then
    print_usage
    exit 0
fi

if ! [[ "$1" =~ ^[0-9]+$ ]]; then
    log_error "Invalid argument: $1"
    print_usage
    exit 1
fi

# Count completed features
count_completed() {
    if command -v jq &> /dev/null; then
        jq '[.features[] | select(.passes == true)] | length' "$PRD_FILE" 2>/dev/null || echo "?"
    else
        grep -c '"passes": true' "$PRD_FILE" 2>/dev/null || echo "0"
    fi
}

count_total() {
    if command -v jq &> /dev/null; then
        jq '.features | length' "$PRD_FILE" 2>/dev/null || echo "?"
    else
        grep -c '"id":' "$PRD_FILE" 2>/dev/null || echo "?"
    fi
}

# Main prompt for Claude
RALPH_PROMPT='You are working through a Product Requirements Document (PRD) in autonomous mode.

## Your Task This Iteration

1. **Review Context**: 
   - Read the PRD to understand all features
   - Check progress.txt for previous work and notes
   - Check git log for recent commits

2. **Select ONE Feature**: 
   - Find the highest PRIORITY feature with `passes: false`
   - Consider dependencies - some features may require others first
   - Choose strategically based on what makes sense to implement next
   - Do NOT just pick the first item in the list

3. **Implement the Feature**:
   - Write clean, well-documented code
   - Follow the coding standards in CLAUDE.md
   - Keep changes focused and minimal

4. **Verify Your Work** (CRITICAL):
   - Run type checks: `npm run typecheck` - MUST PASS
   - Run tests: `npm run test` - MUST PASS  
   - Run linter: `npm run lint` - MUST PASS
   - If any check fails, fix it before proceeding

5. **Update PRD**: 
   - Set `passes: true` for the completed feature
   - Add any notes about the implementation

6. **Update progress.txt**: 
   - APPEND a new entry (never overwrite previous entries)
   - Include: timestamp, feature ID, what was done, notes for next iteration
   - Suggest what should be worked on next

7. **Git Commit**: 
   - Stage all changes: `git add -A`
   - Commit with format: `feat(category): description [ID]`

8. **Check Completion**:
   - If ALL features now have `passes: true`, output exactly: PROMISE_COMPLETE_HERE
   - Otherwise, summarize what you did and stop

## Critical Rules
- Work on ONLY ONE feature per iteration
- ALL checks (typecheck, test, lint) MUST pass before marking complete
- Small, focused changes are better than large ones
- Never skip the verification step
- If stuck after 3 attempts, document blocker and move to different feature

## When Stuck
If you encounter an error you cannot resolve:
1. Document the error in progress.txt
2. Add notes to the PRD feature explaining the blocker
3. Move on to a different feature
4. Do NOT mark a blocked feature as passes: true'

# Main loop
main() {
    check_prerequisites
    
    cd "$PROJECT_ROOT"
    
    COMPLETED_START=$(count_completed)
    TOTAL=$(count_total)
    
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║             Ralph Wiggum Autonomous Loop                      ║"
    echo "╠═══════════════════════════════════════════════════════════════╣"
    printf "║  Max Iterations: %-44s ║\n" "$MAX_ITERATIONS"
    printf "║  PRD Progress:   %-44s ║\n" "$COMPLETED_START/$TOTAL features complete"
    printf "║  Started:        %-44s ║\n" "$(date '+%Y-%m-%d %H:%M:%S')"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    
    for ((i=1; i<=MAX_ITERATIONS; i++)); do
        COMPLETED=$(count_completed)
        
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        log_step "Iteration $i/$MAX_ITERATIONS (Progress: $COMPLETED/$TOTAL)"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        
        # Run Claude with context
        OUTPUT=$(claude --print "$PRD_FILE" "$PROGRESS_FILE" <<< "$RALPH_PROMPT" 2>&1) || true
        
        echo "$OUTPUT"
        
        # Check for completion signal
        if echo "$OUTPUT" | grep -q "$COMPLETION_SIGNAL"; then
            COMPLETED_END=$(count_completed)
            echo ""
            echo "╔═══════════════════════════════════════════════════════════════╗"
            echo "║                    🎉 PRD COMPLETE! 🎉                        ║"
            echo "╠═══════════════════════════════════════════════════════════════╣"
            printf "║  Iterations:      %-43s ║\n" "$i"
            printf "║  Features:        %-43s ║\n" "$COMPLETED_END/$TOTAL"
            printf "║  Session Start:   %-43s ║\n" "$COMPLETED_START → $COMPLETED_END"
            printf "║  Completed:       %-43s ║\n" "$(date '+%Y-%m-%d %H:%M:%S')"
            echo "╚═══════════════════════════════════════════════════════════════╝"
            
            # Optional: notification
            if command -v osascript &> /dev/null; then
                osascript -e 'display notification "All features complete!" with title "Ralph Wiggum" sound name "Glass"' 2>/dev/null || true
            elif command -v notify-send &> /dev/null; then
                notify-send "Ralph Wiggum" "All features complete!" 2>/dev/null || true
            fi
            
            exit 0
        fi
        
        log_info "Iteration $i complete. Pausing before next..."
        sleep 3
    done
    
    # Max iterations reached
    COMPLETED_END=$(count_completed)
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║               Max Iterations Reached                          ║"
    echo "╠═══════════════════════════════════════════════════════════════╣"
    printf "║  Progress:        %-43s ║\n" "$COMPLETED_END/$TOTAL features"
    printf "║  This Session:    %-43s ║\n" "+$((COMPLETED_END - COMPLETED_START)) features"
    echo "║                                                               ║"
    echo "║  Review progress.txt and prd.json for status.                 ║"
    echo "║  Run again to continue: ./plans/ralph.sh $MAX_ITERATIONS      ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    
    exit 1
}

# Run
main
```

---

## File 2: plans/prd.json

Location: `plans/prd.json`

```json
{
  "project": "YOUR_PROJECT_NAME",
  "version": "1.0.0",
  "description": "Brief description of your project",
  "updated_at": "2026-01-08",
  "features": [
    {
      "id": "FEAT-001",
      "category": "setup",
      "priority": "critical",
      "description": "Project initialization and configuration",
      "acceptance_criteria": [
        "Package.json configured with all dependencies",
        "TypeScript configured with strict mode",
        "ESLint and Prettier configured",
        "Basic directory structure created"
      ],
      "passes": false,
      "notes": "",
      "blocked_by": []
    },
    {
      "id": "FEAT-002",
      "category": "core",
      "priority": "high",
      "description": "Implement core data models",
      "acceptance_criteria": [
        "TypeScript interfaces defined",
        "Validation schemas created",
        "Unit tests for validation"
      ],
      "passes": false,
      "notes": "",
      "blocked_by": ["FEAT-001"]
    },
    {
      "id": "FEAT-003",
      "category": "api",
      "priority": "high",
      "description": "Create REST API endpoints",
      "acceptance_criteria": [
        "GET endpoint returns data",
        "POST endpoint creates records",
        "Error handling implemented",
        "Integration tests pass"
      ],
      "passes": false,
      "notes": "",
      "blocked_by": ["FEAT-002"]
    },
    {
      "id": "FEAT-004",
      "category": "ui",
      "priority": "medium",
      "description": "Build user interface components",
      "acceptance_criteria": [
        "Components render correctly",
        "Responsive design works",
        "Accessibility requirements met"
      ],
      "passes": false,
      "notes": "",
      "blocked_by": ["FEAT-002"]
    },
    {
      "id": "FEAT-005",
      "category": "testing",
      "priority": "medium",
      "description": "Comprehensive test coverage",
      "acceptance_criteria": [
        "Unit test coverage > 80%",
        "Integration tests for API",
        "E2E tests for critical paths"
      ],
      "passes": false,
      "notes": "",
      "blocked_by": ["FEAT-003", "FEAT-004"]
    }
  ],
  "metadata": {
    "total_features": 5,
    "completed_features": 0,
    "priority_order": ["critical", "high", "medium", "low"]
  }
}
```

---

## File 3: plans/progress.txt

Location: `plans/progress.txt`

```markdown
# Progress Log

## Instructions for Agent
- APPEND to this file after each iteration (never overwrite)
- Format: [TIMESTAMP] [FEATURE_ID] - Description
- Include: what was done, any blockers, suggested next steps
- Keep entries concise but informative

---

## Session History

[Agent entries will appear below this line]

```

---

## File 4: CLAUDE.md

Location: `CLAUDE.md` (project root)

```markdown
# Project: YOUR_PROJECT_NAME

## Overview
[Describe your project in 2-3 sentences]

## Tech Stack
- **Language**: TypeScript 5.x
- **Runtime**: Node.js 20+
- **Framework**: [Your framework]
- **Testing**: [Jest/Vitest/etc.]
- **Database**: [If applicable]

## Quick Reference

### Development Commands
```bash
# Install dependencies
npm install

# Type checking (MUST PASS)
npm run typecheck

# Run tests (MUST PASS)
npm run test

# Linting (MUST PASS)
npm run lint

# Format code
npm run format

# Development server
npm run dev

# Production build
npm run build
```

### Project Structure
```
src/
├── components/     # UI components
├── lib/           # Utility functions  
├── api/           # API routes/handlers
├── types/         # TypeScript types
└── __tests__/     # Test files
```

## Coding Standards

### TypeScript
- Strict mode enabled (`strict: true`)
- No `any` types - use proper typing or `unknown`
- All functions must have explicit return types
- Use interfaces for object shapes

### Code Style
- Use const by default, let when needed, never var
- Prefer arrow functions for callbacks
- Use async/await over .then() chains
- Maximum function length: 50 lines

### Documentation
- All public functions need JSDoc comments
- Complex logic needs inline comments
- README updates for new features

### Testing
- Every feature needs unit tests
- Test file naming: `*.test.ts` or `*.spec.ts`
- Use descriptive test names: `it('should...')`
- Mock external dependencies

## Git Workflow

### Commit Messages
Format: `type(scope): description`

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `test`: Adding tests
- `docs`: Documentation
- `chore`: Maintenance

Examples:
- `feat(auth): add login form validation`
- `fix(api): handle null response`
- `test(utils): add unit tests for formatDate`

### Before Committing
1. Run `npm run typecheck`
2. Run `npm run test`
3. Run `npm run lint`
4. All must pass!

## Critical Rules

⚠️ **DO NOT**:
- Modify package.json dependencies without explicit approval
- Skip the verification step (typecheck, test, lint)
- Mark features as complete without working tests
- Force push to any branch
- Commit secrets or API keys

✅ **ALWAYS**:
- Run all checks before committing
- Update progress.txt after work
- Make atomic, focused commits
- Handle errors gracefully
- Write tests for new code

## Verification Checklist

Before marking any feature as `passes: true`:

- [ ] Code compiles: `npm run typecheck` passes
- [ ] Tests pass: `npm run test` passes
- [ ] Linting passes: `npm run lint` passes
- [ ] Feature works as described in acceptance criteria
- [ ] Edge cases handled
- [ ] Error handling in place

## Environment

### Required Environment Variables
```bash
# Copy .env.example to .env.local
NODE_ENV=development
# Add other required variables
```

### Local Development
```bash
# Start development
npm run dev

# The app runs at http://localhost:3000
```

## Troubleshooting

### Common Issues

**TypeScript errors after changes:**
```bash
# Clear cache and rebuild
rm -rf node_modules/.cache
npm run typecheck
```

**Tests failing unexpectedly:**
```bash
# Run tests with verbose output
npm run test -- --verbose
```

**Lint errors:**
```bash
# Auto-fix what's possible
npm run lint -- --fix
```

## Notes for AI Agent

When working on this project:

1. **Start each iteration** by reading:
   - This file (CLAUDE.md)
   - plans/prd.json (current state)
   - plans/progress.txt (recent work)
   - git log (last few commits)

2. **Pick ONE feature** from the PRD with `passes: false`

3. **Implement carefully**:
   - Small, focused changes
   - Run checks frequently
   - Test as you go

4. **Verify before completing**:
   - All three checks must pass
   - Feature actually works
   - Tests cover the feature

5. **Document your work**:
   - Update PRD
   - Append to progress.txt
   - Make descriptive commit
```

---

## File 5: .claude/settings.json

Location: `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npx *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git status)",
      "Bash(git log *)",
      "Bash(git diff *)",
      "Bash(cat *)",
      "Bash(ls *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Bash(grep *)",
      "Bash(mkdir *)",
      "Bash(echo *)",
      "Read(*)",
      "Write(src/**)",
      "Write(tests/**)",
      "Write(__tests__/**)",
      "Write(plans/**)",
      "Write(docs/**)",
      "Write(*.md)",
      "Write(*.json)",
      "Write(*.ts)",
      "Write(*.tsx)",
      "Write(*.js)",
      "Write(*.jsx)",
      "Write(*.css)",
      "Write(*.html)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(sudo *)",
      "Bash(npm publish *)",
      "Bash(git push --force*)",
      "Bash(git reset --hard*)",
      "Write(.env)",
      "Write(.env.*)",
      "Write(*secret*)",
      "Write(*password*)",
      "Write(package-lock.json)",
      "Write(node_modules/**)"
    ]
  },
  "model": "claude-sonnet-4-20250514",
  "preferences": {
    "autoApprove": false,
    "verboseMode": true
  }
}
```

---

## File 6: init.sh

Location: `init.sh` (project root)

```bash
#!/bin/bash

# =============================================================================
# Ralph Wiggum Project Initializer
# Run this once to set up your project for autonomous development
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Ralph Wiggum Project Initializer                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check for required tools
echo -e "${BLUE}Checking required tools...${NC}"

check_tool() {
    if command -v $1 &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} $1 found"
        return 0
    else
        echo -e "  ${RED}✗${NC} $1 not found"
        return 1
    fi
}

MISSING=0
check_tool "node" || MISSING=1
check_tool "npm" || MISSING=1
check_tool "git" || MISSING=1
check_tool "claude" || { echo -e "    ${YELLOW}Install from: https://code.claude.com${NC}"; MISSING=1; }

if [ $MISSING -eq 1 ]; then
    echo ""
    echo -e "${RED}Please install missing tools before continuing.${NC}"
    exit 1
fi

echo ""

# Create directory structure
echo -e "${BLUE}Creating directory structure...${NC}"

mkdir -p plans
mkdir -p .claude/commands
mkdir -p src
mkdir -p tests

echo -e "  ${GREEN}✓${NC} Directories created"

# Check for existing files
echo ""
echo -e "${BLUE}Checking for required files...${NC}"

# PRD
if [ ! -f "plans/prd.json" ]; then
    echo -e "  ${YELLOW}!${NC} plans/prd.json not found"
    echo -e "    ${YELLOW}→ Create your PRD before running Ralph${NC}"
else
    echo -e "  ${GREEN}✓${NC} plans/prd.json exists"
fi

# progress.txt
if [ ! -f "plans/progress.txt" ]; then
    cat > plans/progress.txt << 'EOF'
# Progress Log

## Instructions for Agent
- APPEND to this file after each iteration (never overwrite)
- Format: [TIMESTAMP] [FEATURE_ID] - Description
- Include: what was done, any blockers, suggested next steps

---

## Session History

EOF
    echo -e "  ${GREEN}✓${NC} plans/progress.txt created"
else
    echo -e "  ${GREEN}✓${NC} plans/progress.txt exists"
fi

# CLAUDE.md
if [ ! -f "CLAUDE.md" ]; then
    echo -e "  ${YELLOW}!${NC} CLAUDE.md not found"
    echo -e "    ${YELLOW}→ Create CLAUDE.md with project instructions${NC}"
else
    echo -e "  ${GREEN}✓${NC} CLAUDE.md exists"
fi

# ralph.sh
if [ ! -f "plans/ralph.sh" ]; then
    echo -e "  ${YELLOW}!${NC} plans/ralph.sh not found"
    echo -e "    ${YELLOW}→ Copy ralph.sh from the implementation guide${NC}"
else
    chmod +x plans/ralph.sh
    echo -e "  ${GREEN}✓${NC} plans/ralph.sh exists and is executable"
fi

# Git initialization
echo ""
echo -e "${BLUE}Checking git setup...${NC}"

if [ ! -d ".git" ]; then
    git init
    echo -e "  ${GREEN}✓${NC} Git repository initialized"
else
    echo -e "  ${GREEN}✓${NC} Git repository exists"
fi

# Install dependencies if package.json exists
echo ""
if [ -f "package.json" ]; then
    echo -e "${BLUE}Installing dependencies...${NC}"
    npm install
    echo -e "  ${GREEN}✓${NC} Dependencies installed"
    
    # Run initial checks
    echo ""
    echo -e "${BLUE}Running initial verification...${NC}"
    
    if npm run typecheck 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Type checking passes"
    else
        echo -e "  ${YELLOW}!${NC} Type checking has issues (fix before running Ralph)"
    fi
    
    if npm run test 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Tests pass"
    else
        echo -e "  ${YELLOW}!${NC} Tests have issues (fix before running Ralph)"
    fi
    
    if npm run lint 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Linting passes"
    else
        echo -e "  ${YELLOW}!${NC} Linting has issues (fix before running Ralph)"
    fi
else
    echo -e "${YELLOW}No package.json found - skipping npm setup${NC}"
fi

# Summary
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Setup Summary                              ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Directory structure:"
echo "  plans/              - Ralph configuration files"
echo "  .claude/            - Claude Code settings"
echo "  src/                - Source code"
echo "  tests/              - Test files"
echo ""
echo "Required files:"
echo "  CLAUDE.md           - Project instructions for Claude"
echo "  plans/prd.json      - Product Requirements Document"
echo "  plans/progress.txt  - Session memory (auto-created)"
echo "  plans/ralph.sh      - Main loop script"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "  1. Create/update CLAUDE.md with your project details"
echo "  2. Create plans/prd.json with your features"
echo "  3. Ensure all npm checks pass (typecheck, test, lint)"
echo "  4. Run: ./plans/ralph.sh 10"
echo ""
echo -e "${BLUE}Happy autonomous coding! 🔄${NC}"
echo ""
```

---

## File 7: .claude/commands/ralph-interactive.md

Location: `.claude/commands/ralph-interactive.md`

```markdown
# Ralph Interactive Mode

Use this for supervised, human-in-the-loop Ralph sessions.

## Usage
```
/project:ralph-interactive
```

## What it does
- Loads PRD and progress context
- Asks for confirmation before major actions
- Allows steering between features
- Good for learning how Ralph works

---

## Prompt

Please load and work with the following context:

**PRD File**: @plans/prd.json
**Progress Log**: @plans/progress.txt

You are in INTERACTIVE mode. For each step:

1. **Show current status**:
   - How many features are complete vs pending
   - What was done in the last session

2. **Propose next feature**:
   - Analyze the PRD
   - Suggest the highest priority incomplete feature
   - Explain your reasoning
   - Wait for my approval before proceeding

3. **After approval**:
   - Implement the feature
   - Show me the changes
   - Run verification (typecheck, test, lint)
   - Ask if I want to see test output

4. **Before committing**:
   - Show me the git diff
   - Ask for commit message approval
   - Update PRD and progress.txt

5. **After completion**:
   - Ask if I want to continue with another feature

Be conversational and pause for feedback at key decision points.
```

---

## Quick Setup Script

Save as `setup-ralph.sh` and run to create all files:

```bash
#!/bin/bash

# Quick setup script for Ralph Wiggum
# Run: curl -sSL <url> | bash
# Or: bash setup-ralph.sh

echo "Setting up Ralph Wiggum..."

mkdir -p plans .claude/commands

# Create empty PRD template
cat > plans/prd.json << 'EOF'
{
  "project": "YOUR_PROJECT",
  "features": [
    {
      "id": "FEAT-001",
      "category": "setup",
      "priority": "high",
      "description": "TODO: Add your first feature",
      "acceptance_criteria": ["TODO"],
      "passes": false,
      "notes": ""
    }
  ]
}
EOF

# Create progress.txt
cat > plans/progress.txt << 'EOF'
# Progress Log
## Session History
EOF

# Create minimal CLAUDE.md
cat > CLAUDE.md << 'EOF'
# Project Instructions

## Commands
- npm run typecheck
- npm run test  
- npm run lint

## Rules
- All checks must pass before committing
- Update progress.txt after each feature
EOF

echo "✅ Setup complete!"
echo ""
echo "Next:"
echo "1. Edit plans/prd.json with your features"
echo "2. Edit CLAUDE.md with your project details"
echo "3. Copy plans/ralph.sh from the implementation guide"
echo "4. Run: ./plans/ralph.sh 10"
```

---

## Usage Summary

```bash
# 1. Set up your project
./init.sh

# 2. Customize your files
#    - Edit CLAUDE.md with project details
#    - Edit plans/prd.json with your features

# 3. Run autonomous mode
./plans/ralph.sh 20

# 4. Or run interactive mode
claude
# Then type: /project:ralph-interactive

# 5. Monitor progress
cat plans/progress.txt
git log --oneline

# 6. Check PRD status
cat plans/prd.json | jq '.features[] | {id, passes}'
```

---

This companion document provides all the ready-to-use files. Copy them to your project, customize the CLAUDE.md and prd.json for your specific needs, and start autonomous development!


