# CLI - Design

> Implementation details for the RF CLI tool.

---

## Architecture

### Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Node.js 18+ | JavaScript execution |
| Module System | ESM (NodeNext) | Modern imports |
| CLI Framework | Commander.js | Command parsing and help |
| Styling | Chalk | Terminal colors and formatting |
| Prompts | @inquirer/prompts | Interactive user input |
| Language | TypeScript (strict) | Type safety |

### Directory Structure

```
cli/
├── package.json           # ESM package, bin entry for 'flow'
├── tsconfig.json          # TypeScript strict ES2022
├── README.md              # User documentation
├── src/
│   ├── index.ts           # Entry point, Commander setup (35 commands)
│   ├── api.ts             # Typed API client (~800 lines)
│   ├── utils/
│   │   ├── index.ts       # Re-exports
│   │   └── flags.ts       # Shared output flags (--json, --quiet)
│   └── commands/
│       ├── index.ts       # Command barrel export
│       ├── status.ts      # flow status
│       ├── list.ts        # flow list
│       ├── show.ts        # flow show
│       ├── new.ts         # flow new (with matched outcome support)
│       ├── start.ts       # flow start
│       ├── stop.ts        # flow stop
│       ├── update.ts      # flow update
│       ├── archive.ts     # flow archive
│       ├── tasks.ts       # flow tasks
│       ├── task.ts        # flow task (add/update)
│       ├── workers.ts     # flow workers
│       ├── worker.ts      # flow worker
│       ├── intervene.ts   # flow intervene
│       ├── flow-pause.ts  # flow pause
│       ├── flow-resume.ts # flow resume
│       ├── flow-logs.ts   # flow logs
│       ├── homr.ts        # flow homr (--supervise, --yolo)
│       ├── escalations.ts # flow escalations
│       ├── answer.ts      # flow answer
│       ├── dismiss.ts     # flow dismiss
│       ├── chat.ts        # flow chat
│       ├── skills.ts      # flow skills
│       ├── skill.ts       # flow skill (show, new subcommands)
│       ├── tools.ts       # flow tools
│       ├── tool.ts        # flow tool (show, new subcommands)
│       ├── capability.ts  # flow capability (detect, create, list)
│       ├── outputs.ts     # flow outputs
│       ├── files.ts       # flow files
│       ├── config.ts      # flow config
│       ├── sync.ts        # flow sync
│       ├── retro.ts       # flow retro
│       ├── converse.ts    # flow converse/talk (markdown rendering)
│       └── server.ts      # flow server (start dev server)
│   └── types/
│       └── marked-terminal.d.ts  # Type declarations for marked-terminal
└── dist/                  # Compiled JavaScript
```

---

## API Client

The CLI includes a fully-typed API client (`src/api.ts`) that wraps all Digital Twin endpoints.

### Response Types

```typescript
interface Outcome {
  id: string;
  name: string;
  status: 'active' | 'dormant' | 'achieved' | 'archived';
  is_ongoing: boolean;
  brief: string | null;
  intent: string | null;
  // ... full type in api.ts
}

interface Task {
  id: string;
  outcome_id: string;
  title: string;
  status: 'pending' | 'claimed' | 'running' | 'completed' | 'failed';
  // ...
}

interface Worker {
  id: string;
  outcome_id: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  pid: number | null;
  // ...
}
```

### API Methods

```typescript
// Outcomes
api.outcomes.list(params?)     // GET /api/outcomes
api.outcomes.get(id)           // GET /api/outcomes/{id}
api.outcomes.create(input)     // POST /api/outcomes
api.outcomes.update(id, input) // PATCH /api/outcomes/{id}
api.outcomes.tasks(id)         // GET /api/outcomes/{id}/tasks
api.outcomes.progress(id)      // GET /api/outcomes/{id}/progress
api.outcomes.start(id, opts?)  // POST /api/outcomes/{id}/workers

// Workers
api.workers.get(id)            // GET /api/workers/{id}
api.workers.update(id, input)  // PATCH /api/workers/{id}

// Other
api.supervisor.status()        // GET /api/supervisor/status
api.skills.list()              // GET /api/skills

// Raw methods
api.get<T>(path)
api.post<T>(path, body?)
api.patch<T>(path, body?)
api.delete<T>(path)
```

### Error Handling

```typescript
class ApiError extends Error {
  status: number;
  body: unknown;
}

class NetworkError extends Error {
  // Connection failed
}
```

---

## Command Implementation

### Command Structure

Each command file follows this pattern:

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';

export const exampleCommand = new Command('example')
  .description('What this command does')
  .option('-f, --flag', 'Flag description')
  .argument('[arg]', 'Argument description')
  .action(async (arg, options) => {
    try {
      // Implementation
    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        console.error(chalk.red('API Error:'), error.message);
        process.exit(1);
      }
      throw error;
    }
  });
```

### Registration

Commands are registered in `src/index.ts`:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { statusCommand, listCommand, showCommand, newCommand, startCommand, stopCommand } from './commands/index.js';

const program = new Command();

program
  .name('rf')
  .description('CLI for Digital Twin API')
  .version('0.1.0');

program.addCommand(statusCommand);
program.addCommand(listCommand);
// ... etc

program.parse(process.argv);
```

---

## Output Formatting

### Color Conventions

| Color | Usage |
|-------|-------|
| `chalk.bold.white()` | Headers, titles |
| `chalk.white()` | Important values |
| `chalk.gray()` | Secondary info, dividers |
| `chalk.green()` | Success, active, completed |
| `chalk.yellow()` | Pending, warnings |
| `chalk.red()` | Errors, failed |
| `chalk.cyan()` | Running, in-progress |

### Status Indicators

```typescript
chalk.green('● Running')    // Active
chalk.gray('○ Stopped')     // Inactive
chalk.yellow('◐ Paused')    // Paused
chalk.red('✗ Failed')       // Error
chalk.green('✓')            // Success checkmark
chalk.green(' ⟳')           // Converging
```

### Progress Indicators (Supervise Mode)

```typescript
// Progress bar
const bar = chalk.green('█'.repeat(filledWidth)) + chalk.gray('░'.repeat(barWidth - filledWidth));
console.log(`  ${bar} ${percent}% (${completed}/${total})`);

// Task completion celebration
chalk.bold.green(`🎉 Just Completed:`)
chalk.green('✓') + ` ${taskTitle}`

// YOLO mode results
chalk.bold.yellow('🎲 YOLO Auto-Resolve:')
```

### Layout Patterns

```typescript
// Header
console.log(chalk.bold('Title'));
console.log(chalk.gray('─'.repeat(50)));

// Key-value
console.log(`  Label: ${chalk.white(value)}`);

// List item
console.log(`  ${chalk.gray('•')} ${chalk.white(name)} ${status}`);

// Summary
console.log(chalk.gray(`${count} items`));
```

---

## Build & Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Link globally (makes 'rf' available)
npm link

# Development (watch mode)
npm run dev

# Type check only
npm run typecheck
```

---

## Configuration

Currently hardcoded in `src/api.ts`:

```typescript
let baseUrl = 'http://localhost:3000/api';

export function setBaseUrl(url: string): void {
  baseUrl = url;
}
```

Future: Could read from environment variable or config file.

---

## Dependencies

**Runtime:**
- `commander` ^12.1.0 - CLI framework
- `chalk` ^5.3.0 - Terminal styling
- `@inquirer/prompts` ^8.2.0 - Interactive prompts
- `marked` ^15.x - Markdown parser
- `marked-terminal` ^7.x - Terminal markdown renderer

**Development:**
- `typescript` ^5.x - Type checking
- `@types/node` - Node.js types

**External:**
- Digital Twin server must be running on localhost:3000

---

## Special Command Modes

### HOMЯ Supervise Mode

The `flow homr` command supports two special flags:

```bash
flow homr <outcome-id> --supervise    # Live watch mode
flow homr <outcome-id> --yolo         # Auto-resolve + live watch
```

**Supervise Mode (`--supervise`):**
- Clears screen and refreshes every 5 seconds
- Shows task progress with visual progress bar
- Displays active workers and their current tasks
- Celebrates newly completed tasks with "🎉 Just Completed"
- Shows pending escalations prominently
- Exit with Ctrl+C

**YOLO Mode (`--yolo`):**
- Implies `--supervise` (live watch automatically enabled)
- Automatically resolves escalations using AI confidence scoring
- Shows "🎲 YOLO Auto-Resolve" status with resolved/deferred counts
- Displays last decision made with confidence percentage

### Flow New with Matched Outcomes

When `flow new` finds matching outcomes, it offers choices:
- Add to existing outcome → calls iterate API to create tasks
- Create new outcome instead
- Cancel

### Flow Server

Start the Next.js dev server from anywhere without `cd`:

```bash
flow server           # Start on port 3000
flow server -p 3001   # Start on custom port
```

Uses `import.meta.url` to find the project root relative to the CLI installation.

### Flow Converse/Talk (Markdown Rendering)

The conversational REPL (`flow converse` or `flow talk`) renders markdown responses using `marked-terminal`:

- Tables render with box-drawing characters
- Bold, italic, and code formatting preserved
- Terminal width clamped to 60-120 chars to prevent table mangling

---

## Adding New Commands

See the [cli-patterns.md](/skills/cli-patterns.md) skill for complete patterns and checklist.

Quick checklist:
1. Create `src/commands/<name>.ts`
2. Export named command using Commander
3. Add to `commands/index.ts` barrel export
4. Register in main `index.ts`
5. Build and test
