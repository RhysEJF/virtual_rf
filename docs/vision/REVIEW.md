# Review

> Quality assurance system that checks work and creates fix tasks.

---

## Purpose

Work isn't done when tasks complete. The Review system:

1. **Evaluates completed work** against success criteria
2. **Identifies issues** with severity levels
3. **Creates fix tasks** for problems found
4. **Tracks convergence** - fewer issues each cycle means we're getting close

The goal is autonomous quality assurance with human-level thoroughness.

---

## Status

| Capability | Status |
|------------|--------|
| PRD-based success criteria checking | Complete |
| Issue detection with severity levels | Complete |
| Automatic fix task generation | Complete |
| Convergence tracking | Complete |
| Verification checklist validation | Complete |
| Iterate feedback system | Complete |

**Overall:** Complete and production-ready

---

## Key Concepts

### Review Cycles

Reviews happen periodically during execution:

```
Cycle 1: 12 issues found → 12 fix tasks created
Cycle 2: 7 issues found  → 7 fix tasks (improving)
Cycle 3: 3 issues found  → 3 fix tasks (improving)
Cycle 4: 0 issues found  → converging
Cycle 5: 0 issues found  → DONE (2 consecutive zeros)
```

### Convergence

**Convergence = consistent improvement toward done.**

The system tracks `consecutive_clean_reviews`. When this reaches 2, the outcome is considered truly complete - not just "tasks done" but "quality verified."

### Severity Levels

| Severity | Meaning | Action |
|----------|---------|--------|
| `critical` | Blocks core functionality | High priority fix task |
| `high` | Significant issue | Standard fix task |
| `medium` | Should be addressed | Lower priority task |
| `low` | Nice to have | Optional task |

### Verification Checklist

Before marking complete, the reviewer checks:
- BUILD - Code compiles without errors
- TEST - All tests pass
- LINT - No linting errors
- FUNCTION - Core functionality works
- PRD - All PRD items addressed
- TASKS - All tasks complete

### Iteration System

Post-completion, users can provide feedback via the Iterate section:

1. User describes bug or desired change
2. System parses feedback into structured tasks
3. Tasks created with `from_review: true`
4. Worker can be auto-started

This enables continuous improvement even after "completion."

---

## Behaviors

1. **PRD-driven** - Reviews against the original intent, not arbitrary standards
2. **Severity-aware** - Critical issues get high-priority tasks
3. **Convergent** - Tracks improvement over time, knows when to stop
4. **User-adjustable** - Iterate lets users provide feedback post-completion

---

## Success Criteria

- Reviews catch real issues that would affect user satisfaction
- Fix tasks are actionable and specific
- Convergence tracking prevents infinite review loops
- User feedback is converted to appropriate tasks

---

## Open Questions

1. **Review frequency** - When should reviews auto-trigger? Every N tasks? Every N iterations? Currently manual.

2. **Review depth** - Should the reviewer actually run the code? Currently analyzes code statically.

3. **False positives** - Reviewer sometimes creates unnecessary tasks. Need better calibration.

4. **Workspace inspection** - Reviewer should check actual outputs (screenshots, logs). Currently limited to code analysis.

---

## Related

- **Design:** [REVIEW.md](../design/REVIEW.md) - Implementation details, API specs, and data structures
- **Vision:** [WORKER.md](./WORKER.md) - How workers execute fix tasks
- **Vision:** [ORCHESTRATION.md](./ORCHESTRATION.md) - When reviews happen in the workflow
