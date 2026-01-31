# RF CLI Patterns

Established patterns for the Digital Twin CLI (`rf` command). Follow these conventions when adding new commands.

## Project Structure

```
cli/
├── package.json           # ESM package with bin entry
├── tsconfig.json          # TypeScript config (ES2022, NodeNext)
├── src/
│   ├── index.ts           # Main entry, Commander setup
│   ├── api.ts             # API client with typed responses
│   ├── utils/
│   │   └── index.ts       # Re-exports from api.ts
│   └── commands/
│       ├── index.ts       # Command exports barrel
│       ├── status.ts      # System status command
│       ├── list.ts        # List outcomes command
│       └── show.ts        # Show outcome detail command
└── dist/                  # Compiled output
```

### Key Configuration

**package.json:**
- Type: ESM (`"type": "module"` implied via NodeNext)
- Bin entry: `"rf": "./dist/index.js"`
- Dependencies: `commander` (CLI framework), `chalk` (output styling)

**tsconfig.json:**
- `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`
- `"strict": true` with all strict checks enabled
- Output to `./dist`, source in `./src`

## Command Registration Pattern

### Main Entry (index.ts)

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { statusCommand, listCommand, showCommand } from './commands/index.js';

const program = new Command();

program
  .name('rf')
  .description('CLI for Digital Twin API - manage outcomes and workers')
  .version('0.1.0');

// Register commands
program.addCommand(statusCommand);
program.addCommand(listCommand);
program.addCommand(showCommand);

program.parse(process.argv);
```

### Command File Structure

Each command file follows this pattern:

```typescript
/**
 * Command Name
 *
 * Brief description of what this command does.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';

// Helper functions at top (if needed)
function formatSomething(value: string): string {
  // ...
}

// Export named command
export const commandName = new Command('name')
  .description('What this command does')
  .option('-s, --status <status>', 'Option description')
  .option('--flag', 'Boolean flag description', false)
  .argument('[arg]', 'Optional argument')  // or '<arg>' for required
  .action(async (arg, options) => {
    try {
      // Command implementation
    } catch (error) {
      // Error handling (see below)
    }
  });

export default commandName;
```

### Command Barrel Export (commands/index.ts)

```typescript
// Command exports
export { statusCommand } from './status.js';
export { listCommand } from './list.js';
export { showCommand } from './show.js';
```

**Important:** Always use `.js` extension in imports (required for ESM with NodeNext).

## API Client Usage

### Import Pattern

```typescript
import { api, ApiError, NetworkError, OutcomeWithCounts } from '../api.js';
```

### Making API Calls

```typescript
// Single request
const response = await api.outcomes.list({ counts: true });

// Parallel requests
const [status, outcomes] = await Promise.all([
  api.supervisor.status(),
  api.outcomes.list({ counts: true }),
]);

// Direct endpoint access (for non-standard routes)
const detail = await api.get<CustomResponse>(`/outcomes/${id}`);
```

### Available API Methods

```typescript
// Outcomes
api.outcomes.list(params?)      // { counts?, tree?, status?, ... }
api.outcomes.get(id)
api.outcomes.create(input)
api.outcomes.update(id, input)
api.outcomes.delete(id)
api.outcomes.tasks(id)
api.outcomes.progress(id)
api.outcomes.start(id)

// Workers
api.workers.get(id)
api.workers.update(id, input)
api.workers.logs(id)
api.workers.intervene(id, message)

// Tasks
api.tasks.get(id)
api.tasks.update(id, input)

// Other
api.skills.list()
api.dispatch.send(request)
api.supervisor.status()

// Raw methods
api.get<T>(path)
api.post<T>(path, body?)
api.patch<T>(path, body?)
api.delete<T>(path)
```

## Error Handling

Every command must handle both `NetworkError` and `ApiError`:

```typescript
try {
  // API calls and logic
} catch (error) {
  if (error instanceof NetworkError) {
    console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
    console.error(chalk.gray('Make sure the server is running (npm run dev)'));
    process.exit(1);
  }
  if (error instanceof ApiError) {
    // Handle specific status codes if needed
    if (error.status === 404) {
      console.error(chalk.red('Error:'), `Resource not found: ${id}`);
    } else {
      console.error(chalk.red('API Error:'), error.message);
    }
    process.exit(1);
  }
  throw error;  // Re-throw unknown errors
}
```

## Output Formatting with Chalk

### Color Conventions

| Color | Usage |
|-------|-------|
| `chalk.bold.white()` | Headers, main titles |
| `chalk.bold.cyan()` | Section headers |
| `chalk.white()` | Important values |
| `chalk.gray()` | Secondary info, dividers, hints |
| `chalk.green()` | Success, active, completed |
| `chalk.yellow()` | Pending, warnings |
| `chalk.red()` | Errors, failed |
| `chalk.cyan()` | Running, in-progress |
| `chalk.blue()` | Claimed, intermediate states |

### Status Indicators

```typescript
// Running/active states
chalk.green('● Running')
chalk.green('✓')

// Stopped/inactive
chalk.gray('○ Stopped')

// Pending/warning
chalk.yellow('◐ Paused')

// Error/failed
chalk.red('✗ Failed')

// Converging/cycling
chalk.green(' ⟳')  // Rotation symbol
```

### Layout Patterns

**Headers and Dividers:**
```typescript
console.log();
console.log(chalk.bold('Main Title'));
console.log(chalk.gray('─'.repeat(50)));
console.log();
```

**Sections:**
```typescript
console.log(chalk.bold.cyan('Section Name'));
console.log(`  Label: ${chalk.white(value)}`);
```

**Tables:**
```typescript
// Header
console.log(
  chalk.bold.gray(padEnd('ID', 16)) +
  chalk.bold.gray(padEnd('NAME', 32)) +
  chalk.bold.gray('STATUS')
);
console.log(chalk.gray('─'.repeat(80)));

// Rows
console.log(`${chalk.gray(id)}${chalk.white(name)}${status}`);
```

**Lists:**
```typescript
console.log(`  ${chalk.gray('•')} ${chalk.white(item.name)} ${status}`);
```

**Summary:**
```typescript
console.log(chalk.gray(`${count} item${count !== 1 ? 's' : ''}`));
```

### Helper Functions

**String padding with truncation:**
```typescript
function padEnd(str: string, length: number): string {
  if (str.length >= length) {
    return str.substring(0, length - 1) + '…';
  }
  return str + ' '.repeat(length - str.length);
}
```

**Text truncation:**
```typescript
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '…';
}
```

**Relative time formatting:**
```typescript
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
```

**Status formatting (parameterized):**
```typescript
function formatStatus(status: string): string {
  switch (status) {
    case 'active':
      return chalk.green('● Active');
    case 'dormant':
      return chalk.gray('○ Dormant');
    // ... other cases
    default:
      return status;
  }
}
```

## Complete Command Example

```typescript
/**
 * Example Command
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, OutcomeWithCounts } from '../api.js';

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '…';
}

export const exampleCommand = new Command('example')
  .description('Show example data')
  .option('-v, --verbose', 'Show verbose output', false)
  .action(async (options) => {
    try {
      const response = await api.outcomes.list({ counts: true });
      const outcomes = response.outcomes as OutcomeWithCounts[];

      console.log();
      console.log(chalk.bold('Example Output'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log();

      for (const outcome of outcomes) {
        console.log(`  ${chalk.gray('•')} ${chalk.white(outcome.name)}`);
        if (options.verbose && outcome.brief) {
          console.log(`    ${chalk.gray(truncate(outcome.brief, 60))}`);
        }
      }

      console.log();
      console.log(chalk.gray(`${outcomes.length} outcomes`));
      console.log();

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

export default exampleCommand;
```

## Checklist for New Commands

1. [ ] Create `src/commands/<name>.ts`
2. [ ] Add JSDoc comment at top explaining the command
3. [ ] Import `Command` from `commander`, `chalk`, and API client
4. [ ] Define helper functions if needed
5. [ ] Export named command using `new Command('name')`
6. [ ] Add `.description()` for help text
7. [ ] Add options with `.option()` (use sensible defaults)
8. [ ] Add arguments with `.argument()` if needed
9. [ ] Implement `.action()` with async handler
10. [ ] Wrap API calls in try/catch with proper error handling
11. [ ] Use consistent output formatting (headers, sections, lists)
12. [ ] Export as default
13. [ ] Add export to `commands/index.ts`
14. [ ] Register in main `index.ts` with `program.addCommand()`
15. [ ] Run `npm run build` to verify compilation
