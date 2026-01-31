# Design Documentation

> Implementation details, APIs, and technical specifications for each module.

---

## How to Use These Docs

**Design docs describe HOW** - the implementation, APIs, file structures, and technical details.

**For WHAT and WHY**, see the corresponding [Vision Docs](../vision/README.md).

| When you want to... | Read |
|---------------------|------|
| Understand what a module does | Vision doc |
| Find API endpoints and request/response formats | Design doc |
| Understand the architecture philosophy | Vision doc |
| Find file paths and implementation details | Design doc |
| Know the success criteria | Vision doc |
| See code examples and patterns | Design doc |

---

## Module Index

| Module | Design Doc | Vision Doc | Description |
|--------|------------|------------|-------------|
| **API** | [API.md](./API.md) | [Vision](../vision/API.md) | Conversational API and session management |
| **Deployment** | [DEPLOYMENT.md](./DEPLOYMENT.md) | [Vision](../vision/DEPLOYMENT.md) | Mac Mini, Cloudflare Tunnel, Telegram |
| **Dispatcher** | [DISPATCHER.md](./DISPATCHER.md) | [Vision](../vision/DISPATCHER.md) | Request classification and routing implementation |
| **Orchestration** | [ORCHESTRATION.md](./ORCHESTRATION.md) | [Vision](../vision/ORCHESTRATION.md) | Two-phase execution flow and APIs |
| **Worker** | [WORKER.md](./WORKER.md) | [Vision](../vision/WORKER.md) | Ralph worker process management |
| **Skills** | [SKILLS.md](./SKILLS.md) | [Vision](../vision/SKILLS.md) | Skill loading, parsing, and matching |
| **Review** | [REVIEW.md](./REVIEW.md) | [Vision](../vision/REVIEW.md) | Review cycle implementation |
| **Supervisor** | [SUPERVISOR.md](./SUPERVISOR.md) | [Vision](../vision/SUPERVISOR.md) | Monitoring loop and alert system |
| **Database** | [DATABASE.md](./DATABASE.md) | [Vision](../vision/DATABASE.md) | Schema, queries, and migrations |
| **UI** | [UI.md](./UI.md) | [Vision](../vision/UI.md) | Components, styling, and patterns |
| **Integration** | [INTEGRATION.md](./INTEGRATION.md) | [Vision](../vision/INTEGRATION.md) | Claude CLI, Git, GitHub, Environment |
| **Analytics** | [ANALYTICS.md](./ANALYTICS.md) | [Vision](../vision/ANALYTICS.md) | Logging schemas and tracking |

---

## Design Doc Structure

Each design doc follows this structure:

```markdown
# Module Name - Design

## Overview
Brief technical summary

## Architecture
- File organization
- Key classes/functions
- Data flow diagrams

## Implementation
- Code patterns
- Configuration
- Key algorithms

## API Specification
- Endpoints
- Request/Response formats
- Error handling

## Dependencies
- What this module uses
- What uses this module

## Configuration
- Environment variables
- Thresholds and defaults
```

---

## Related Documents

- [Vision Docs](../vision/README.md) - WHAT each module does
- [IDEAS.md](../IDEAS.md) - Future improvement ideas
- [CLAUDE.md](../../CLAUDE.md) - Project coding standards
