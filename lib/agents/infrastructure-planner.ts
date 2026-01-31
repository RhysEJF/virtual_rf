/**
 * @deprecated This module has been renamed to capability-planner.ts
 * This file re-exports everything for backwards compatibility.
 */

export type {
  CapabilityNeed,
  CapabilityPlan,
  InfrastructureNeed,
  InfrastructurePlan,
} from './capability-planner';

export {
  analyzeApproachForCapabilities,
  analyzeApproachForInfrastructure,
  createCapabilityTasks,
  createInfrastructureTasks,
  hasCapabilityNeeds,
  hasInfrastructureNeeds,
} from './capability-planner';
