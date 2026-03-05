/**
 * Capabilities Module
 *
 * Unified capability detection and creation services.
 * Used by UI, Conversational API, and CLI.
 */

export {
  detectCapabilities,
  detectCapabilitiesWithClaude,
  getExistingCapabilities,
  listCapabilities,
  type DetectedCapability,
  type ExistingCapability,
  type DetectionResult,
  type ListCapabilitiesResult,
  type ClaudeCapabilityResult,
} from './detection';

export {
  createCapabilityTask,
  createSkillFile,
  createToolFile,
  createOutcomeSkillFile,
  type CreateCapabilityInput,
  type CreateCapabilityResult,
  type CreateSkillFileInput,
  type CreateSkillFileResult,
  type CreateToolFileInput,
  type CreateToolFileResult,
} from './creation';
