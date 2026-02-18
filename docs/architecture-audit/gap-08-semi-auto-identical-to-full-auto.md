# Gap 8: Semi-Auto Mode Identical to Full-Auto Mode

> **Verdict: CONFIRMED GAP**
> **Severity: MEDIUM**
> **Fix complexity: MEDIUM (UI and resolver logic needed)**

---

## Claimed Gap

The HOMR auto-resolver has three modes — manual, semi-auto, and full-auto — but semi-auto behaves identically to full-auto. There is no UI confirmation step or human-in-the-loop approval flow for semi-auto mode.

## Audit Findings

### The code explicitly acknowledges this

**File:** `lib/homr/auto-resolver.ts:337`

```typescript
// For now, we treat semi-auto same as full-auto (can add UI later)
```

This is not a subtle bug — it's a known, documented shortcut. The developer left a TODO comment indicating this was intentional deferral.

### Three modes are defined but only two behaviors exist

**Schema:** `lib/db/schema.ts` defines the `AutoResolveMode` type:

```typescript
type AutoResolveMode = 'manual' | 'semi-auto' | 'full-auto';
```

**Actual behavior:**

| Mode | Intended Behavior | Actual Behavior |
|------|------------------|-----------------|
| `manual` | Human resolves all escalations | Human resolves all escalations ✅ |
| `semi-auto` | AI resolves with human approval before action | AI resolves automatically (same as full-auto) ❌ |
| `full-auto` | AI resolves and acts automatically | AI resolves and acts automatically ✅ |

### `tryAutoResolve()` has no semi-auto code path

**File:** `lib/homr/auto-resolver.ts`

The `tryAutoResolve()` function checks:
1. If mode is `manual` → return (don't auto-resolve)
2. Otherwise → resolve automatically

There is no branch for semi-auto that would:
- Generate a proposed resolution
- Present it to the user for approval
- Wait for confirmation before executing

### The UI offers semi-auto as a selectable option

**File:** `app/components/homr/HomrDashboard.tsx`

The auto-resolve settings UI presents all three modes as selectable radio buttons. A user selecting "Semi-Auto" would expect human-in-the-loop approval, but instead gets fully autonomous resolution.

### Worker auto-spawn compounds the issue

**File:** `lib/homr/auto-resolver.ts`

After auto-resolving an escalation, the system can automatically spawn a worker to act on the resolution. In semi-auto mode, this means:
1. Escalation is auto-resolved (no human approval)
2. Worker is auto-spawned (no human approval)
3. Worker executes (no human oversight)

The entire chain from escalation to execution runs without human involvement, despite the user selecting a mode that implies human checkpoints.

## Impact Assessment

**MEDIUM impact:**

1. **Trust violation** — Semi-auto mode is explicitly about giving humans a checkpoint. Running without that checkpoint undermines the graduated autonomy model that HOMR is designed to provide.

2. **Risk in sensitive contexts** — Some escalations involve ambiguous requirements, scope questions, or decisions with real consequences. A user choosing semi-auto is specifically saying "I want AI help but I want final say." That preference is ignored.

3. **Worker auto-spawn amplifies the gap** — Without the human checkpoint, semi-auto can trigger irreversible actions (code changes, file modifications) just like full-auto.

4. **Mitigation: confidence threshold** — The auto-resolver does use a confidence threshold before acting. Low-confidence resolutions are skipped even in full-auto mode. This provides a safety net but is not a substitute for the explicit human approval that semi-auto promises.

## Recommendation

Implement a proper semi-auto flow:

1. **Propose, don't execute** — When mode is semi-auto, generate the proposed resolution and store it as a "pending approval" state on the escalation
2. **UI notification** — Show a banner or toast: "AI proposed a resolution for escalation X — approve or reject?"
3. **Approval endpoint** — Add an API endpoint for approving/rejecting proposed resolutions
4. **Only spawn worker after approval** — The worker auto-spawn should be conditional on the approval

The escalation already has a UI presence (EscalationAlert component), so the approval UI can be added to existing components.

## If Left Unfixed

- Users who select semi-auto get full-auto behavior, with no human checkpoints
- The graduated autonomy model (manual → semi-auto → full-auto) has a gap in the middle
- Workers may be auto-spawned to act on AI resolutions that the user never approved
- The "semi-auto" UI option is misleading — it should either work as described or be hidden
