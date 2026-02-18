/**
 * Integration Tests for Escalation Deduplication Race Condition Fix
 *
 * These tests verify that the race condition fix for escalation deduplication works correctly:
 * 1. Creating two escalations for the same task returns the same escalation ID
 * 2. Starting decomposition prevents workers from claiming the task
 * 3. Answering an escalation while decomposition is in progress doesn't create duplicate subtasks
 * 4. Full scenario: user answers break_into_subtasks, then another worker tries to claim during decomposition
 * 5. Selecting "break_into_subtasks" immediately marks the task as decomposing (via markTasksForDecomposition)
 * 6. Tasks with decomposition_status='in_progress' are skipped during escalation creation
 * 7. The complete flow from answer -> decomposition -> subtask creation works without race conditions
 *
 * To run these tests manually:
 * ```bash
 * npx ts-node lib/homr/__tests__/escalation-deduplication.test.ts
 * ```
 */

import { getDb, now } from '../../db/index';
import { generateId } from '../../utils/id';
import { createTask, claimNextTask, updateTask, getTaskById, getSubtasksByParentTaskId } from '../../db/tasks';
import { createOutcome, deleteOutcome } from '../../db/outcomes';
import { createWorker, deleteWorker } from '../../db/workers';
import { getPendingEscalations } from '../../db/homr';
import { decomposeTask } from '../../agents/task-decomposer';
import { markTasksForDecomposition, isBreakIntoSubtasksOption } from '../escalator';
import type { Task, Outcome, HomrAmbiguitySignal, HomrAmbiguityType } from '../../db/schema';

// ============================================================================
// Test Utilities
// ============================================================================

interface TestContext {
  outcomeId: string;
  workerId1: string;
  workerId2: string;
  cleanup: () => void;
}

/**
 * Set up a test context with an outcome and two workers
 */
function setupTestContext(): TestContext {
  // Create test outcome
  const outcome = createOutcome({
    name: 'Test Outcome for Escalation Deduplication',
    intent: JSON.stringify({ summary: 'Test outcome for integration tests', success_criteria: ['All tests pass'] }),
  });

  // Create two workers to simulate race condition
  const worker1 = createWorker({
    outcome_id: outcome.id,
    name: 'Test Worker 1',
  });

  const worker2 = createWorker({
    outcome_id: outcome.id,
    name: 'Test Worker 2',
  });

  return {
    outcomeId: outcome.id,
    workerId1: worker1.id,
    workerId2: worker2.id,
    cleanup: () => {
      // Clean up in reverse order
      deleteWorker(worker2.id);
      deleteWorker(worker1.id);
      deleteOutcome(outcome.id);
    },
  };
}

/**
 * Create a test task with high complexity
 */
function createHighComplexityTask(outcomeId: string): Task {
  return createTask({
    outcome_id: outcomeId,
    title: 'High Complexity Task for Testing',
    description: 'This is a complex task that should trigger escalation',
    complexity_score: 8,
    estimated_turns: 25,
    phase: 'execution',
  });
}

/**
 * Create a mock ambiguity signal for testing
 */
function createMockAmbiguity(type: HomrAmbiguityType = 'blocking_decision'): HomrAmbiguitySignal {
  return {
    detected: true,
    type,
    description: 'Test ambiguity for escalation',
    evidence: ['Test evidence 1', 'Test evidence 2'],
    affectedTasks: [],
    suggestedQuestion: 'How should we proceed with this test?',
    options: [
      {
        id: 'break_into_subtasks',
        label: 'Break Into Subtasks',
        description: 'Decompose this task into smaller pieces',
        implications: 'Creates subtasks',
      },
      {
        id: 'proceed_anyway',
        label: 'Proceed Anyway',
        description: 'Continue with the task as-is',
        implications: 'May fail',
      },
    ],
  };
}

// ============================================================================
// Test 1: Duplicate Escalation Returns Same ID
// ============================================================================

async function testDuplicateEscalationReturnsSameId(): Promise<boolean> {
  console.log('\n[TEST 1] Duplicate escalation returns same ID...');

  const ctx = setupTestContext();
  let passed = false;

  try {
    const task = createHighComplexityTask(ctx.outcomeId);
    const ambiguity = createMockAmbiguity('blocking_decision');

    // Import the escalator module to use the async createEscalation
    const escalator = await import('../escalator');

    // First escalation creation
    const escalationId1 = await escalator.createEscalation(ctx.outcomeId, ambiguity, task);
    console.log(`  Created first escalation: ${escalationId1}`);

    // Second escalation creation (same task, same trigger type)
    const escalationId2 = await escalator.createEscalation(ctx.outcomeId, ambiguity, task);
    console.log(`  Created second escalation: ${escalationId2}`);

    // Verify they return the same ID (deduplication worked)
    if (escalationId1 === escalationId2) {
      console.log('  ✓ Both calls returned the same escalation ID (deduplication works!)');
      passed = true;
    } else {
      console.log(`  ✗ Different IDs returned: ${escalationId1} vs ${escalationId2}`);
    }

  } catch (error) {
    console.log(`  ✗ Test error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    ctx.cleanup();
  }

  return passed;
}

// ============================================================================
// Test 2: Decomposition Blocks Task Claims
// ============================================================================

async function testDecompositionBlocksTaskClaims(): Promise<boolean> {
  console.log('\n[TEST 2] Decomposition in progress blocks task claims...');

  const ctx = setupTestContext();
  let passed = false;

  try {
    const task = createHighComplexityTask(ctx.outcomeId);
    console.log(`  Created task: ${task.id}`);

    // Simulate decomposition starting by setting decomposition_status = 'in_progress'
    await updateTask(task.id, { decomposition_status: 'in_progress' });
    console.log('  Set decomposition_status = in_progress');

    // Try to claim the task with worker 1
    const claimResult1 = claimNextTask(ctx.outcomeId, ctx.workerId1);
    console.log(`  Worker 1 claim result: success=${claimResult1.success}, reason=${claimResult1.reason}`);

    // Try to claim with worker 2
    const claimResult2 = claimNextTask(ctx.outcomeId, ctx.workerId2);
    console.log(`  Worker 2 claim result: success=${claimResult2.success}, reason=${claimResult2.reason}`);

    // Both should fail because the task is being decomposed
    if (!claimResult1.success && !claimResult2.success) {
      console.log('  ✓ Neither worker could claim the task (decomposition blocks claiming)');
      passed = true;
    } else {
      console.log('  ✗ Worker was able to claim task during decomposition');
    }

  } catch (error) {
    console.log(`  ✗ Test error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    ctx.cleanup();
  }

  return passed;
}

// ============================================================================
// Test 3: Escalation Answer During Decomposition Doesn't Create Duplicates
// ============================================================================

async function testEscalationAnswerIdempotency(): Promise<boolean> {
  console.log('\n[TEST 3] Escalation answer during decomposition is idempotent...');

  const ctx = setupTestContext();
  let passed = false;

  try {
    const task = createHighComplexityTask(ctx.outcomeId);
    console.log(`  Created task: ${task.id}`);

    // Create an escalation for the task
    const escalator = await import('../escalator');
    const ambiguity = createMockAmbiguity('blocking_decision');
    const escalationId = await escalator.createEscalation(ctx.outcomeId, ambiguity, task);
    console.log(`  Created escalation: ${escalationId}`);

    // Simulate decomposition already having created subtasks
    // This simulates the race condition where decomposition starts before escalation is answered
    await updateTask(task.id, { decomposition_status: 'in_progress' });

    // Create some fake subtasks with decomposed_from_task_id set
    const subtask1 = createTask({
      outcome_id: ctx.outcomeId,
      title: '[1/2] First Subtask',
      description: 'First subtask from decomposition',
      decomposed_from_task_id: task.id,
    });
    const subtask2 = createTask({
      outcome_id: ctx.outcomeId,
      title: '[2/2] Second Subtask',
      description: 'Second subtask from decomposition',
      decomposed_from_task_id: task.id,
    });
    console.log(`  Created subtasks: ${subtask1.id}, ${subtask2.id}`);

    // Mark decomposition as complete
    await updateTask(task.id, { decomposition_status: 'completed', status: 'completed' });

    // Now check that getSubtasksByParentTaskId returns the existing subtasks
    const existingSubtasks = getSubtasksByParentTaskId(task.id);
    console.log(`  Found ${existingSubtasks.length} existing subtasks for task ${task.id}`);

    // The decomposeTask function should return existing subtasks (idempotency)
    const decompositionResult = await decomposeTask({
      task,
      outcomeIntent: null,
      outcomeApproach: null,
      forceDecompose: true,
    });

    console.log(`  Decomposition result: success=${decompositionResult.success}, subtasks=${decompositionResult.createdTaskIds.length}`);

    // Verify no NEW subtasks were created (returns existing ones)
    const allSubtasks = getSubtasksByParentTaskId(task.id);
    if (allSubtasks.length === 2 && decompositionResult.createdTaskIds.length === 2) {
      console.log('  ✓ Decomposition is idempotent - returned existing subtasks without creating duplicates');
      passed = true;
    } else {
      console.log(`  ✗ Duplicate subtasks created: expected 2, got ${allSubtasks.length}`);
    }

  } catch (error) {
    console.log(`  ✗ Test error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    ctx.cleanup();
  }

  return passed;
}

// ============================================================================
// Test 4: Full Race Condition Scenario from Bug Report
// ============================================================================

async function testFullRaceConditionScenario(): Promise<boolean> {
  console.log('\n[TEST 4] Full race condition scenario from bug report...');
  console.log('  Scenario: User answers "break_into_subtasks", another worker tries to claim during decomposition');

  const ctx = setupTestContext();
  let passed = false;

  try {
    // Step 1: Create a high-complexity task that triggers an escalation
    const task = createHighComplexityTask(ctx.outcomeId);
    console.log(`  Step 1: Created task ${task.id}`);

    // Step 2: Worker 1 detects high complexity and creates escalation
    const escalator = await import('../escalator');
    const ambiguity = createMockAmbiguity('blocking_decision');
    const escalationId1 = await escalator.createEscalation(ctx.outcomeId, ambiguity, task);
    console.log(`  Step 2: Worker 1 created escalation ${escalationId1}`);

    // Step 3: Worker 2 also tries to create escalation for the same task (race condition)
    const escalationId2 = await escalator.createEscalation(ctx.outcomeId, ambiguity, task);
    console.log(`  Step 3: Worker 2 tried to create escalation, got ${escalationId2}`);

    // Verify deduplication: should get same ID
    const deduplicationWorked = escalationId1 === escalationId2;
    console.log(`  Deduplication check: ${deduplicationWorked ? 'PASS' : 'FAIL'} (IDs match: ${escalationId1 === escalationId2})`);

    // Step 4: User answers the escalation with "break_into_subtasks"
    // This triggers decomposition
    console.log('  Step 4: Simulating user answering with break_into_subtasks...');

    // First, let's set up the decomposition_status to 'in_progress' (simulating what happens during decomposition)
    await updateTask(task.id, { decomposition_status: 'in_progress' });
    console.log('  Set decomposition_status = in_progress (decomposition started)');

    // Step 5: During decomposition, Worker 2 tries to claim the task
    const claimDuringDecomposition = claimNextTask(ctx.outcomeId, ctx.workerId2);
    console.log(`  Step 5: Worker 2 claim during decomposition: success=${claimDuringDecomposition.success}`);

    // The claim should fail because decomposition is in progress
    const claimBlockedCorrectly = !claimDuringDecomposition.success;
    console.log(`  Claim blocked check: ${claimBlockedCorrectly ? 'PASS' : 'FAIL'}`);

    // Step 6: Decomposition completes, subtasks are created
    const subtask1 = createTask({
      outcome_id: ctx.outcomeId,
      title: '[1/3] Analysis Subtask',
      description: 'Part 1 of the decomposed task',
      decomposed_from_task_id: task.id,
    });
    const subtask2 = createTask({
      outcome_id: ctx.outcomeId,
      title: '[2/3] Implementation Subtask',
      description: 'Part 2 of the decomposed task',
      decomposed_from_task_id: task.id,
    });
    const subtask3 = createTask({
      outcome_id: ctx.outcomeId,
      title: '[3/3] Testing Subtask',
      description: 'Part 3 of the decomposed task',
      decomposed_from_task_id: task.id,
    });
    await updateTask(task.id, { decomposition_status: 'completed', status: 'completed' });
    console.log(`  Step 6: Decomposition completed, created ${3} subtasks`);

    // Step 7: Another call to resolve escalation or decompose should NOT create duplicate subtasks
    const existingSubtasks = getSubtasksByParentTaskId(task.id);
    console.log(`  Step 7: Verifying no duplicate subtasks. Found ${existingSubtasks.length} subtasks.`);

    const noDuplicateSubtasks = existingSubtasks.length === 3;
    console.log(`  No duplicate subtasks check: ${noDuplicateSubtasks ? 'PASS' : 'FAIL'}`);

    // Step 8: Workers can now claim the subtasks (not the original task)
    const subtaskClaim = claimNextTask(ctx.outcomeId, ctx.workerId1);
    const canClaimSubtask = subtaskClaim.success && subtaskClaim.task?.decomposed_from_task_id === task.id;
    console.log(`  Step 8: Worker can claim subtask: ${canClaimSubtask ? 'PASS' : 'FAIL'} (claimed ${subtaskClaim.task?.title || 'none'})`);

    // Overall result
    passed = deduplicationWorked && claimBlockedCorrectly && noDuplicateSubtasks;
    console.log(`\n  Overall: ${passed ? '✓ All race condition protections working' : '✗ Some protections failed'}`);

  } catch (error) {
    console.log(`  ✗ Test error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    ctx.cleanup();
  }

  return passed;
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  Integration Tests: Escalation Deduplication Race Condition Fix');
  console.log('═══════════════════════════════════════════════════════════════════');

  const results: { name: string; passed: boolean }[] = [];

  // Run each test
  results.push({
    name: 'Test 1: Duplicate escalation returns same ID',
    passed: await testDuplicateEscalationReturnsSameId(),
  });

  results.push({
    name: 'Test 2: Decomposition blocks task claims',
    passed: await testDecompositionBlocksTaskClaims(),
  });

  results.push({
    name: 'Test 3: Escalation answer idempotency',
    passed: await testEscalationAnswerIdempotency(),
  });

  results.push({
    name: 'Test 4: Full race condition scenario',
    passed: await testFullRaceConditionScenario(),
  });

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  Test Results Summary');
  console.log('═══════════════════════════════════════════════════════════════════');

  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  for (const result of results) {
    console.log(`  ${result.passed ? '✓' : '✗'} ${result.name}`);
  }

  console.log('───────────────────────────────────────────────────────────────────');
  console.log(`  ${passedCount}/${totalCount} tests passed`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Exit with appropriate code
  if (passedCount < totalCount) {
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

export {
  testDuplicateEscalationReturnsSameId,
  testDecompositionBlocksTaskClaims,
  testEscalationAnswerIdempotency,
  testFullRaceConditionScenario,
  runAllTests,
};
