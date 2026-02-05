/**
 * Capability Tools
 *
 * Tools for detecting and creating capabilities (skills/tools)
 * via the conversational API.
 */

import {
  detectCapabilities,
  listCapabilities,
  createCapabilityTask,
  createSkillFile,
  createToolFile,
  createOutcomeSkillFile,
  type DetectedCapability,
  type ExistingCapability,
} from '../../capabilities';
import { getOutcomeById } from '../../db/outcomes';

// ============================================================================
// Detect Capabilities
// ============================================================================

export interface DetectCapabilitiesResult {
  success: boolean;
  suggested: DetectedCapability[];
  existing: ExistingCapability[];
  skillReferences: string[];
  summary: {
    suggestedCount: number;
    existingCount: number;
    referencesCount: number;
  };
  error?: string;
}

/**
 * Detect capabilities mentioned in text
 */
export function detectCapabilitiesTool(
  text: string,
  outcomeId?: string
): DetectCapabilitiesResult {
  if (!text || text.trim().length === 0) {
    return {
      success: false,
      suggested: [],
      existing: [],
      skillReferences: [],
      summary: { suggestedCount: 0, existingCount: 0, referencesCount: 0 },
      error: 'Text is required',
    };
  }

  try {
    const result = detectCapabilities(text, outcomeId);

    return {
      success: true,
      suggested: result.suggested,
      existing: result.existing,
      skillReferences: result.skillReferences,
      summary: {
        suggestedCount: result.suggested.length,
        existingCount: result.existing.length,
        referencesCount: result.skillReferences.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      suggested: [],
      existing: [],
      skillReferences: [],
      summary: { suggestedCount: 0, existingCount: 0, referencesCount: 0 },
      error: error instanceof Error ? error.message : 'Detection failed',
    };
  }
}

// ============================================================================
// List Capabilities
// ============================================================================

export interface ListCapabilitiesToolResult {
  success: boolean;
  globalSkills: Array<{
    id: string;
    name: string;
    category: string;
    description: string | null;
  }>;
  outcomeSkills: Array<{ name: string; path: string }>;
  outcomeTools: Array<{ name: string; path: string }>;
  totalCount: number;
  error?: string;
}

/**
 * List all available capabilities
 */
export function listCapabilitiesTool(
  outcomeId?: string
): ListCapabilitiesToolResult {
  try {
    const result = listCapabilities(outcomeId);

    return {
      success: true,
      globalSkills: result.globalSkills.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
      })),
      outcomeSkills: result.outcomeSkills,
      outcomeTools: result.outcomeTools,
      totalCount:
        result.globalSkills.length +
        result.outcomeSkills.length +
        result.outcomeTools.length,
    };
  } catch (error) {
    return {
      success: false,
      globalSkills: [],
      outcomeSkills: [],
      outcomeTools: [],
      totalCount: 0,
      error: error instanceof Error ? error.message : 'Listing failed',
    };
  }
}

// ============================================================================
// Create Capability
// ============================================================================

export interface CreateCapabilityToolResult {
  success: boolean;
  taskId?: string;
  filePath?: string;
  message: string;
  error?: string;
}

/**
 * Create a new capability (skill or tool)
 *
 * @param type - 'skill' or 'tool'
 * @param name - Name of the capability
 * @param outcomeId - Outcome ID (required for tools, optional for skills)
 * @param description - Optional description
 * @param category - Category for global skills (required if not creating for outcome)
 * @param createFile - If true, create file directly instead of task
 */
export function createCapabilityTool(
  type: 'skill' | 'tool',
  name: string,
  outcomeId?: string,
  description?: string,
  category?: string,
  createFile?: boolean
): CreateCapabilityToolResult {
  // Validate type
  if (!type || !['skill', 'tool'].includes(type)) {
    return {
      success: false,
      message: 'Type must be "skill" or "tool"',
      error: 'Invalid type',
    };
  }

  // Validate name
  if (!name || name.trim().length === 0) {
    return {
      success: false,
      message: 'Name is required',
      error: 'Name is required',
    };
  }

  try {
    // Handle direct file creation
    if (createFile) {
      if (type === 'skill') {
        if (outcomeId) {
          // Create outcome-specific skill
          const result = createOutcomeSkillFile(outcomeId, name, description);
          return {
            success: result.success,
            filePath: result.path,
            message: result.message,
            error: result.error,
          };
        } else {
          // Create global skill
          if (!category) {
            return {
              success: false,
              message: 'Category is required for global skill creation',
              error: 'Category required',
            };
          }
          const result = createSkillFile({ category, name, description });
          return {
            success: result.success,
            filePath: result.path,
            message: result.message,
            error: result.error,
          };
        }
      } else {
        // Create tool file
        if (!outcomeId) {
          return {
            success: false,
            message: 'Outcome ID is required for tool creation',
            error: 'Outcome ID required',
          };
        }
        const result = createToolFile({ outcomeId, name, description });
        return {
          success: result.success,
          filePath: result.path,
          message: result.message,
          error: result.error,
        };
      }
    }

    // Handle task-based creation (default)
    if (!outcomeId) {
      return {
        success: false,
        message: 'Outcome ID is required to create a capability task',
        error: 'Outcome ID required',
      };
    }

    // Validate outcome exists
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return {
        success: false,
        message: `Outcome ${outcomeId} not found`,
        error: 'Outcome not found',
      };
    }

    const result = createCapabilityTask(outcomeId, {
      type,
      name,
      description,
    });

    return {
      success: result.success,
      taskId: result.taskId,
      message: result.message,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to create capability',
      error: error instanceof Error ? error.message : 'Creation failed',
    };
  }
}
