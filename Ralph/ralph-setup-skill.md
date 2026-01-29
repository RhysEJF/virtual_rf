# Ralph Wiggum Setup Skill

Use this guide to initialize **ANY** new project with the "Ralph Wiggum" autonomous development loop.

## 🎯 Objective
Turn a raw product idea (or existing README) into a fully scaffolded, autonomous-ready repository.

## 🧠 The "Ralph Wiggum" Methodology
The goal is to enable an AI agent to build the project iteratively, one feature at a time, without hallucinating or losing context.
*   **Source of Truth**: `plans/prd.json` (The backlog)
*   **Episodic Memory**: `plans/progress.txt` (The journal)
*   **Engine**: `plans/ralph_monitored.sh` (The monitored loop script)
*   **Safety Guardian**: `plans/ralph_guardian.sh` (AI behavior monitoring)
*   **Recovery Manager**: `plans/recovery_manager.sh` (Incident response)
*   **Rules**: `CLAUDE.md` (Coding standards)

## 🛡️ AI Safety Monitoring System
**BREAKTHROUGH**: Ralph now has **FULL PERMISSIONS** (file creation, deletion, execution) while being invisibly monitored for malicious behavior. The monitoring system provides:
- **Real-time threat detection** (file operations, git commands, network activity)
- **Instant kill switches** for dangerous operations
- **Automatic recovery and rollback** with incident reports
- **Zero overhead** - Ralph works at full speed with complete safety

---

## 📋 Setup Procedure (Agent Instructions)

When asked to "Setup Ralph Wiggum" for a new project, follow these exact steps:

### Phase 1: Context & Analysis
1.  **Read the User's Idea**: Analyze the README, PRD, or user prompt.
2.  **Identify Key Tech Stack**: Determine framework (Next.js/React/Python), DB, and Auth needs.
3.  **Identify Required Secrets**: List all API keys (Stripe, OpenAI, Supabase, etc.) that will be needed.

### Phase 2: Feature Decomposition
1.  **Create `plans/prd.json`**:
    *   Break the idea into 10-20 atomic features.
    *   **FEAT-000**: Asset/Env setup (always first).
    *   **FEAT-001**: Project scaffolding. **CRITICAL**: Must accept "Initialize in root directory" and "Add validation scripts".
    *   **FEAT-XXX**: Implementation steps.
    *   Prioritize them logically (Database -> Auth -> API -> UI).

### Phase 3: Scaffolding (The Files)
Create the following file structure for the **AI Safety Monitoring System**.

#### 1. `.claude/settings.json` (Legacy - Not Required for Monitored Mode)
**NOTE**: With the monitoring system, Ralph gets full permissions via command line flags, making this file optional.
```json
{
  "permissions": {
    "allow": ["Bash(*)", "Read(*)", "Write(*)"],
    "deny": ["Write(.env*)"]
  },
  "preferences": {
    "autoApprove": true,
    "verboseMode": true
  }
}
```

#### 2. `plans/ralph_monitored.sh` (NEW - Main Entry Point)
**CRITICAL**: This is the new main script that launches Ralph with full permissions + AI safety monitoring.

Copy the complete script from `/Users/rhysfishernewairblack/StravaDance/plans/ralph_monitored.sh`

Key features:
- Full permissions: `"Bash(*) Read(*) Write(*) Glob(*) Grep(*) Edit(*)"`
- Real-time AI behavior monitoring
- Instant termination for malicious operations
- Automated recovery and incident reporting

Usage: `./plans/ralph_monitored.sh <max_iterations>`

#### 3. `plans/ralph_guardian.sh` (NEW - Safety Monitor)
**CRITICAL**: The AI safety monitoring system that watches Ralph's behavior.

Copy the complete script from `/Users/rhysfishernewairblack/StravaDance/plans/ralph_guardian.sh`

Features:
- System-wide file operation monitoring (fs_usage/inotify)
- Git operation threat detection (force push, hard reset)
- Process behavior analysis (self-replication detection)
- Test manipulation detection (cheating prevention)
- Network activity monitoring

#### 4. `plans/recovery_manager.sh` (NEW - Incident Response)
**CRITICAL**: Handles incident response when Ralph is terminated for malicious behavior.

Copy the complete script from `/Users/rhysfishernewairblack/StravaDance/plans/recovery_manager.sh`

Features:
- Automatic rollback to last safe state
- Detailed forensic incident reports
- Interactive recovery options
- Backup branch creation
- User notifications

#### 5. `CLAUDE.md`
(Customize the Tech Stack section)
```markdown
# Project Instructions

## Tech Stack
- [Framework]

## Commands
- `npm run typecheck` (tsc --noEmit)
- `npm run test` (jest or placeholder)
- `npm run lint`

## Critical Rules
- ⚠️ NO committing secrets
- ✅ ALWAYS run verify steps (typecheck/test/lint)
- ✅ Atomic commits per feature
```

#### 6. `init.sh`
(Script to create folders `plans/`, `src/`, `tests/` and verify tools)

### Phase 4: Make Scripts Executable
**CRITICAL**: Make all monitoring scripts executable:
```bash
chmod +x plans/ralph_monitored.sh
chmod +x plans/ralph_guardian.sh
chmod +x plans/recovery_manager.sh
```

### Phase 5: Git Initialization
1.  Run `git init` (if not exists).
2.  Create `.gitignore` (node_modules, .env, etc.).
3.  Create `.env.example` with the keys identified in Phase 1.

### Phase 6: Handoff
1.  **Ask the User**: "I have scaffolded the Ralph Wiggum AI Safety Monitoring Loop. Please:"
    *   "Fill in `.env.local` based on `.env.example`."
    *   "Review `plans/prd.json` to confirm the feature roadmap."
    *   "Run `./plans/ralph_monitored.sh 20` to start autonomous building with AI safety monitoring."
2.  **Explain Safety Features**: "Ralph now has FULL PERMISSIONS but is monitored for malicious behavior. The system will instantly terminate and rollback if any dangerous operations are detected."

---

## 🧩 Templates

### `plans/prd.json` Template
```json
{
  "project": "PROJECT_NAME",
  "version": "1.0.0",
  "features": [
    {
      "id": "FEAT-000",
      "category": "setup",
      "priority": "critical",
      "description": "Environment Setup",
      "acceptance_criteria": ["Keys in .env.local", "Repo initialized", "settings.json created"],
      "passes": false
    },
    {
      "id": "FEAT-001",
      "category": "scaffold",
      "priority": "critical",
      "description": "Initialize Framework",
      "acceptance_criteria": [
        "Framework initialized in ROOT directory (not subfolder)",
        "package.json has 'typecheck' script (tsc --noEmit)",
        "package.json has 'test' script (placeholder allowed)",
        "CI checks (lint/test/typecheck) passing"
      ],
      "passes": false
    }
  ]
}
```

### `plans/progress.txt` Template
```text
# Progress Log
## Instructions
- APPEND only. format: [TIME] [FEAT-ID] Description.
```

---

## 🚀 Execution Prompt
(Copy/Paste this to start the agent)

> "I want to set up this project using the Ralph Wiggum AI Safety Monitoring System. Please analyze my project idea, break it down into a `plans/prd.json`, and generate the necessary scaffolding files (`plans/ralph_monitored.sh`, `plans/ralph_guardian.sh`, `plans/recovery_manager.sh`, `CLAUDE.md`, `init.sh`). Include the full AI safety monitoring system that gives Ralph complete autonomy with invisible malicious behavior detection. Identify any missing API keys I need to provide. Do not start coding the app yet, just set up the monitored loop."

## 📁 Required Files for Manual Backup
To preserve the AI Safety Monitoring System, ensure these files are backed up:

### Core Monitoring System (3 files):
1. **`plans/ralph_monitored.sh`** - Main monitored Ralph wrapper (14.3KB)
2. **`plans/ralph_guardian.sh`** - AI behavior monitoring system (10.6KB)
3. **`plans/recovery_manager.sh`** - Incident response and recovery (11.0KB)

### Supporting Files:
4. **`plans/prd.json`** - Product requirements with feature tracking
5. **`plans/progress.txt`** - Progress journal (auto-generated)
6. **`CLAUDE.md`** - Project coding standards
7. **`.claude/settings.json`** - Claude permissions (legacy/optional)

### Log Files (Generated at Runtime):
- **`plans/guardian.log`** - Monitoring activity log
- **`plans/threats.log`** - Threat detection log
- **`plans/recovery.log`** - Recovery action log

### File Locations for This Project:
All monitoring files are located at: `/Users/rhysfishernewairblack/StravaDance/plans/`

To backup the complete system:
```bash
cp -r /Users/rhysfishernewairblack/StravaDance/plans/ /your/backup/location/
cp /Users/rhysfishernewairblack/StravaDance/CLAUDE.md /your/backup/location/
cp /Users/rhysfishernewairblack/StravaDance/.claude/settings.json /your/backup/location/ 2>/dev/null || true
```

## 🔄 Usage for Future Projects
After backing up the monitoring system, to set it up in a new project:

### Step 1: Copy Core Scripts
```bash
# Copy the 3 monitoring scripts to new project's plans/ directory
mkdir -p /path/to/new/project/plans/
cp ~/ralph-monitoring-backup/ralph_monitored.sh /path/to/new/project/plans/
cp ~/ralph-monitoring-backup/ralph_guardian.sh /path/to/new/project/plans/
cp ~/ralph-monitoring-backup/recovery_manager.sh /path/to/new/project/plans/
```

### Step 2: Make Scripts Executable
```bash
cd /path/to/new/project/
chmod +x plans/*.sh
```

### Step 3: Create Project Configuration
```bash
# Copy CLAUDE.md and customize for new project's tech stack
cp ~/ralph-monitoring-backup/CLAUDE.md /path/to/new/project/

# Create prd.json using template (customize features for new project)
cp ~/ralph-monitoring-backup/prd.json /path/to/new/project/plans/
```

### Step 4: Launch Monitored Ralph
```bash
cd /path/to/new/project/
./plans/ralph_monitored.sh 20
```

**That's it!** Ralph will autonomously develop your project with full permissions while being invisibly monitored for safety. 🛡️
