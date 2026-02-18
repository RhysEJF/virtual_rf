# MoveShake

> Turns completed Strava activities into short, playful dance videos.

## 🤖 The "Ralph Wiggum" Method

This project is built using an **autonomous development loop** known as the "Ralph Wiggum" method. This allows an AI agent (Claude Code) to iteratively build the application feature-by-feature while maintaining context and high quality standards.

### How It Works

1.  **The Plan (`plans/prd.json`)**: The "brain" of the operation. This file breaks the entire application down into atomic, testable features. Each feature has a status (`passes: true/false`) and acceptance criteria.
2.  **The Memory (`plans/progress.txt`)**: The "journal". The agent records what it did, what blocked it, and what it learned after every iteration. This prevents it from repeating mistakes.
3.  **The Loop (`plans/ralph.sh`)**: The "engine". A script that runs the agent in a controlled loop. In each iteration, the agent:
    *   Reads the PRD and Progress Log.
    *   Selects the next highest-priority feature.
    *   Implements the code.
    *   **Verifies** the work (Typecheck -> Test -> Lint).
    *   Commits the changes.
    *   Updates the PRD and Progress Log.

### 📚 Documentation Structure

*   **`moveshake.md`**: The original high-level Product Requirements Document (human-readable source of truth).
*   **`plans/prd.json`**: Machine-readable task list derived from `moveshake.md`.
*   **`plans/progress.txt`**: Chronological log of all work done by the agent.
*   **`CLAUDE.md`**: Technical instructions, tech stack details, and coding standards for the agent.
*   **`research_findings.md`**: Background on the Ralph Wiggum methodology itself.
*   **`questions.md`**: Open questions and clarifications needed from the product owner.

---

## 🚀 Getting Started

### Prerequisites

*   Node.js 20+
*   `npm`
*   `claude` CLI (for running the loop)
*   `git`

### Running the Autonomous Loop

To start or resume the autonomous building process:

```bash
# Run the next 10 iterations
./plans/ralph.sh 10
```

The agent will automatically pick up where it left off by reading `plans/progress.txt` and `plans/prd.json`.

### Manual Development

If you are a human developer jumping in:

1.  **Read `CLAUDE.md`** for coding standards and commands.
2.  **Check `plans/prd.json`** to see which feature is currently being worked on or is next up.
3.  **Run Checks** before committing:
    ```bash
    npm run typecheck
    npm run test
    npm run lint
    ```

---

## 🛠 Tech Stack

*   **Framework**: Next.js 14 (App Router)
*   **Language**: TypeScript
*   **Styling**: Tailwind CSS
*   **Database**: Supabase (Postgres)
*   **Queue**: Upstash
*   **External APIs**: Strava, AI Video Generation

## 📄 License

[Add License Here]
