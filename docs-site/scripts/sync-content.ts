/**
 * sync-content.ts
 *
 * Transforms source markdown files from docs/, archive/ into
 * Fumadocs-ready MDX content in content/docs/ with proper
 * frontmatter and meta.json sidebar configuration.
 *
 * New pages (introduction, quick-start, architecture) are NOT
 * overwritten — only synced pages from source docs.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const CONTENT_DIR = path.resolve(__dirname, '../content/docs');

// ── Source → destination mapping ──────────────────────────────────────

interface DocMapping {
  src: string;        // relative to ROOT
  dest: string;       // relative to content/docs/, without extension
  title?: string;     // override title (otherwise extracted from # heading)
  description?: string; // override description
}

const MAPPINGS: DocMapping[] = [
  // ── Vision docs → modules/{name}/vision ──
  { src: 'docs/vision/DISPATCHER.md',         dest: 'modules/dispatcher/vision' },
  { src: 'docs/vision/WORKER.md',             dest: 'modules/worker/vision' },
  { src: 'docs/vision/ORCHESTRATION.md',      dest: 'modules/orchestration/vision' },
  { src: 'docs/vision/SKILLS.md',             dest: 'modules/skills/vision' },
  { src: 'docs/vision/REVIEW.md',             dest: 'modules/review/vision' },
  { src: 'docs/vision/SUPERVISOR.md',         dest: 'modules/supervisor/vision' },
  { src: 'docs/vision/DATABASE.md',           dest: 'modules/database/vision' },
  { src: 'docs/vision/API.md',                dest: 'interfaces/api/vision' },
  { src: 'docs/vision/CLI.md',                dest: 'interfaces/cli/vision' },
  { src: 'docs/vision/CONVERSATIONAL-API.md', dest: 'interfaces/conversational/vision' },
  { src: 'docs/vision/DEPLOYMENT.md',         dest: 'operations/deployment/vision' },
  { src: 'docs/vision/INTEGRATION.md',        dest: 'operations/integration/vision' },
  { src: 'docs/vision/MEMORY.md',             dest: 'operations/memory/vision' },
  { src: 'docs/vision/ANALYTICS.md',          dest: 'operations/analytics/vision' },
  { src: 'docs/vision/UI.md',                 dest: 'interfaces/ui/vision', title: 'UI Vision' },

  // ── Design docs → modules/{name}/design ──
  { src: 'docs/design/DISPATCHER.md',    dest: 'modules/dispatcher/design' },
  { src: 'docs/design/WORKER.md',        dest: 'modules/worker/design' },
  { src: 'docs/design/ORCHESTRATION.md', dest: 'modules/orchestration/design' },
  { src: 'docs/design/SKILLS.md',        dest: 'modules/skills/design' },
  { src: 'docs/design/REVIEW.md',        dest: 'modules/review/design' },
  { src: 'docs/design/SUPERVISOR.md',    dest: 'modules/supervisor/design' },
  { src: 'docs/design/DATABASE.md',      dest: 'modules/database/design' },
  { src: 'docs/design/API.md',           dest: 'interfaces/api/design' },
  { src: 'docs/design/CLI.md',           dest: 'interfaces/cli/design' },
  { src: 'docs/design/DEPLOYMENT.md',    dest: 'operations/deployment/design' },
  { src: 'docs/design/INTEGRATION.md',   dest: 'operations/integration/design' },
  { src: 'docs/design/MEMORY.md',        dest: 'operations/memory/design' },
  { src: 'docs/design/ANALYTICS.md',     dest: 'operations/analytics/design' },
  { src: 'docs/design/UI.md',            dest: 'interfaces/ui/design', title: 'UI Design' },

  // ── HOMR protocol ──
  { src: 'docs/homr/VISION.md',  dest: 'homr/vision', title: 'HOMR Vision' },
  { src: 'docs/homr/DESIGN.md',  dest: 'homr/design', title: 'HOMR Design' },

  // ── Learnings / Cross-outcome ──
  { src: 'docs/learnings/VISION.md', dest: 'homr/learnings-vision', title: 'Cross-Outcome Learning' },
  { src: 'docs/learnings/DESIGN.md', dest: 'homr/learnings-design', title: 'Cross-Outcome Learning Design' },

  // ── Research ──
  { src: 'docs/research/harness-engineering.md',   dest: 'research/harness-engineering' },
  { src: 'docs/research/agent-teams.md',           dest: 'research/agent-teams' },
  { src: 'docs/research/VECTOR-SEARCH-SQLITE.md',  dest: 'research/vector-search' },

  // ── Architecture audit ──
  { src: 'docs/architecture-audit/SUMMARY.md',                                   dest: 'architecture-audit/summary' },
  { src: 'docs/architecture-audit/gap-01-task-intent-approach-not-injected.md',   dest: 'architecture-audit/gap-01' },
  { src: 'docs/architecture-audit/gap-02-design-doc-not-available-to-workers.md', dest: 'architecture-audit/gap-02' },
  { src: 'docs/architecture-audit/gap-03-create-pr-on-complete-not-implemented.md', dest: 'architecture-audit/gap-03' },
  { src: 'docs/architecture-audit/gap-04-orchestrator-path-mismatch.md',          dest: 'architecture-audit/gap-04' },
  { src: 'docs/architecture-audit/gap-05-keyword-only-skill-matching.md',         dest: 'architecture-audit/gap-05' },
  { src: 'docs/architecture-audit/gap-06-skill-directory-inconsistency.md',       dest: 'architecture-audit/gap-06' },
  { src: 'docs/architecture-audit/gap-07-worker-claudemd-scope.md',               dest: 'architecture-audit/gap-07' },
  { src: 'docs/architecture-audit/gap-08-semi-auto-identical-to-full-auto.md',    dest: 'architecture-audit/gap-08' },
  { src: 'docs/architecture-audit/gap-09-no-cross-outcome-homr-sharing.md',       dest: 'architecture-audit/gap-09' },
  { src: 'docs/architecture-audit/gap-10-cost-tracking-fragility.md',             dest: 'architecture-audit/gap-10' },

  // ── Standalone design docs ──
  { src: 'docs/SUPERVISOR_DESIGN.md',              dest: 'modules/supervisor/extended-design', title: 'Supervisor Extended Design' },
  { src: 'docs/HIERARCHICAL_OUTCOMES.md',           dest: 'architecture/hierarchical-outcomes' },
  { src: 'docs/RALPH_UNLEASHED.md',                 dest: 'modules/worker/ralph-unleashed', title: 'Ralph Unleashed' },
  { src: 'docs/REPOSITORY_CONFIG_DESIGN.md',        dest: 'operations/repo-config-design', title: 'Repository Config Design' },
  { src: 'docs/REPOSITORY_INHERITANCE_DESIGN.md',   dest: 'operations/repo-inheritance-design', title: 'Repository Inheritance Design' },
  { src: 'docs/ENRICHED_TASKS_DESIGN.md',           dest: 'architecture/enriched-tasks', title: 'Enriched Tasks Design' },
  { src: 'docs/SKILLS_SHARING_DESIGN.md',           dest: 'modules/skills/sharing-design', title: 'Skills Sharing Design' },
  { src: 'docs/IDEAS.md',                           dest: 'architecture/ideas', title: 'Ideas & Future Work' },
  { src: 'docs/ROADMAP-NEXT.md',                    dest: 'architecture/roadmap', title: 'Roadmap' },
  { src: 'docs/SETUP.md',                           dest: 'getting-started/installation' },
  { src: 'docs/CLI-SPEC-DRAFT.md',                  dest: 'interfaces/cli/spec-draft', title: 'CLI Spec Draft' },

  // ── Design README (indexes) ──
  { src: 'docs/vision/README.md', dest: 'modules/index', title: 'Module Index' },
  { src: 'docs/design/README.md', dest: 'modules/design-index', title: 'Design Doc Index' },

  // ── Archive ──
  { src: 'archive/VISION.md',                         dest: 'archive/original-vision', title: 'Original Vision' },
  { src: 'archive/DESIGN.md',                         dest: 'archive/original-design', title: 'Original Design' },
  { src: 'archive/refactor-ready-for-sharing.md',     dest: 'archive/refactor-sharing', title: 'Refactor for Sharing' },
  { src: 'archive/ralph-wiggum-method/README.md',     dest: 'archive/ralph-wiggum/index', title: 'Ralph Wiggum Method' },
  { src: 'archive/ralph-wiggum-method/questions.md',  dest: 'archive/ralph-wiggum/questions' },
  { src: 'archive/ralph-wiggum-method/ralph-failure-modes.md', dest: 'archive/ralph-wiggum/failure-modes', title: 'Ralph Failure Modes' },
  { src: 'archive/ralph-wiggum-method/ralph-setup-skill.md',   dest: 'archive/ralph-wiggum/setup-skill', title: 'Ralph Setup Skill' },
  { src: 'archive/ralph-wiggum-method/research_findings.md',   dest: 'archive/ralph-wiggum/research-findings', title: 'Research Findings' },
  { src: 'archive/ralph-wiggum-method/wiggumloop.md',          dest: 'archive/ralph-wiggum/wiggum-loop', title: 'Wiggum Loop' },
];

// ── Sidebar meta.json definitions ─────────────────────────────────────

interface MetaDef {
  dir: string;   // relative to content/docs/
  meta: {
    title?: string;
    root?: boolean;
    pages: string[];
  };
}

const META_DEFS: MetaDef[] = [
  {
    dir: '',
    meta: {
      root: true,
      pages: [
        'index',
        '---Getting Started---',
        'getting-started',
        '---Architecture---',
        'architecture',
        '---Core Modules---',
        'modules',
        '---HOMR Protocol---',
        'homr',
        '---Interfaces---',
        'interfaces',
        '---Operations---',
        'operations',
        '---Research---',
        'research',
        '---Architecture Audit---',
        'architecture-audit',
        '---Archive---',
        'archive',
      ],
    },
  },
  {
    dir: 'getting-started',
    meta: {
      title: 'Getting Started',
      pages: ['index', 'installation', 'quick-start', 'configuration'],
    },
  },
  {
    dir: 'architecture',
    meta: {
      title: 'Architecture',
      pages: ['index', 'two-phase', 'data-model', 'hierarchical-outcomes', 'enriched-tasks', 'ideas', 'roadmap'],
    },
  },
  {
    dir: 'modules',
    meta: {
      title: 'Core Modules',
      pages: ['index', 'design-index', 'dispatcher', 'worker', 'orchestration', 'skills', 'review', 'supervisor', 'database'],
    },
  },
  {
    dir: 'modules/dispatcher',
    meta: { title: 'Dispatcher', pages: ['vision', 'design'] },
  },
  {
    dir: 'modules/worker',
    meta: { title: 'Worker (Ralph)', pages: ['vision', 'design', 'ralph-unleashed', 'extended-design'] },
  },
  {
    dir: 'modules/orchestration',
    meta: { title: 'Orchestration', pages: ['vision', 'design'] },
  },
  {
    dir: 'modules/skills',
    meta: { title: 'Skills System', pages: ['vision', 'design', 'sharing-design'] },
  },
  {
    dir: 'modules/review',
    meta: { title: 'Review & Iteration', pages: ['vision', 'design'] },
  },
  {
    dir: 'modules/supervisor',
    meta: { title: 'Supervisor', pages: ['vision', 'design', 'extended-design'] },
  },
  {
    dir: 'modules/database',
    meta: { title: 'Database', pages: ['vision', 'design'] },
  },
  {
    dir: 'homr',
    meta: {
      title: 'HOMR Protocol',
      pages: ['vision', 'design', 'learnings-vision', 'learnings-design'],
    },
  },
  {
    dir: 'interfaces',
    meta: {
      title: 'Interfaces',
      pages: ['api', 'cli', 'ui', 'conversational'],
    },
  },
  {
    dir: 'interfaces/api',
    meta: { title: 'API', pages: ['vision', 'design'] },
  },
  {
    dir: 'interfaces/cli',
    meta: { title: 'CLI', pages: ['vision', 'design', 'spec-draft'] },
  },
  {
    dir: 'interfaces/ui',
    meta: { title: 'Web UI', pages: ['vision', 'design'] },
  },
  {
    dir: 'interfaces/conversational',
    meta: { title: 'Conversational API', pages: ['vision'] },
  },
  {
    dir: 'operations',
    meta: {
      title: 'Operations',
      pages: ['deployment', 'integration', 'memory', 'analytics', 'repo-config-design', 'repo-inheritance-design'],
    },
  },
  {
    dir: 'operations/deployment',
    meta: { title: 'Deployment', pages: ['vision', 'design'] },
  },
  {
    dir: 'operations/integration',
    meta: { title: 'Integration', pages: ['vision', 'design'] },
  },
  {
    dir: 'operations/memory',
    meta: { title: 'Memory System', pages: ['vision', 'design'] },
  },
  {
    dir: 'operations/analytics',
    meta: { title: 'Analytics', pages: ['vision', 'design'] },
  },
  {
    dir: 'research',
    meta: {
      title: 'Research',
      pages: ['harness-engineering', 'agent-teams', 'vector-search'],
    },
  },
  {
    dir: 'architecture-audit',
    meta: {
      title: 'Architecture Audit',
      pages: ['summary', 'gap-01', 'gap-02', 'gap-03', 'gap-04', 'gap-05', 'gap-06', 'gap-07', 'gap-08', 'gap-09', 'gap-10'],
    },
  },
  {
    dir: 'archive',
    meta: {
      title: 'Archive',
      pages: ['original-vision', 'original-design', 'refactor-sharing', 'ralph-wiggum'],
    },
  },
  {
    dir: 'archive/ralph-wiggum',
    meta: {
      title: 'Ralph Wiggum Method',
      pages: ['index', 'questions', 'failure-modes', 'setup-skill', 'research-findings', 'wiggum-loop'],
    },
  },
];

// ── Protected paths (new content, don't overwrite) ────────────────────

const PROTECTED_PATHS = new Set([
  'index.mdx',
  'getting-started/index.mdx',
  'getting-started/quick-start.mdx',
  'getting-started/configuration.mdx',
  'architecture/index.mdx',
  'architecture/two-phase.mdx',
  'architecture/data-model.mdx',
]);

// ── Helpers ───────────────────────────────────────────────────────────

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

function extractDescription(content: string): string {
  const match = content.match(/^>\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function stripFrontmatter(content: string): string {
  if (content.startsWith('---')) {
    const end = content.indexOf('---', 3);
    if (end !== -1) {
      return content.slice(end + 3).trim();
    }
  }
  return content;
}

function stripTitle(content: string): string {
  // Remove the first # heading (we put it in frontmatter)
  return content.replace(/^#\s+.+\n*/m, '');
}

function rewriteLinks(content: string, destDir: string): string {
  // Rewrite relative .md links to doc site paths
  return content
    // Links to vision docs like ../vision/WORKER.md or ./WORKER.md
    .replace(/\[([^\]]+)\]\(\.\.\/vision\/(\w+)\.md\)/g, (_, text, name) => {
      const slug = name.toLowerCase();
      return `[${text}](/docs/modules/${slug}/vision)`;
    })
    .replace(/\[([^\]]+)\]\(\.\/(\w+)\.md\)/g, (_, text, name) => {
      const slug = name.toLowerCase();
      // Infer from current context
      return `[${text}](${slug})`;
    })
    // Links to design docs like ../design/WORKER.md
    .replace(/\[([^\]]+)\]\(\.\.\/design\/(\w+)\.md\)/g, (_, text, name) => {
      const slug = name.toLowerCase();
      return `[${text}](/docs/modules/${slug}/design)`;
    })
    // Links to homr
    .replace(/\[([^\]]+)\]\(\.\.\/homr\/(\w+)\.md\)/g, (_, text, name) => {
      const slug = name.toLowerCase();
      return `[${text}](/docs/homr/${slug})`;
    })
    // Links to learnings
    .replace(/\[([^\]]+)\]\(\.\.\/learnings\/(\w+)\.md\)/g, (_, text, name) => {
      const slug = name.toLowerCase();
      return `[${text}](/docs/homr/learnings-${slug})`;
    })
    // Links to research
    .replace(/\[([^\]]+)\]\(\.\.\/research\/([^)]+)\.md\)/g, (_, text, file) => {
      const slug = file.toLowerCase().replace(/_/g, '-');
      return `[${text}](/docs/research/${slug})`;
    })
    // Links to architecture-audit
    .replace(/\[([^\]]+)\]\(\.\.\/architecture-audit\/([^)]+)\.md\)/g, (_, text, file) => {
      const slug = file.toLowerCase();
      return `[${text}](/docs/architecture-audit/${slug})`;
    })
    // Links to archive
    .replace(/\[([^\]]+)\]\(\.\.\/\.\.\/archive\/([^)]+)\.md\)/g, (_, text, file) => {
      const slug = file.toLowerCase().replace(/_/g, '-');
      return `[${text}](/docs/archive/${slug})`;
    })
    // Skills link
    .replace(/\[([^\]]+)\]\(\/skills\/([^)]+)\.md\)/g, (_, text) => {
      return `[${text}](#)`;
    })
    // IDEAS.md from vision
    .replace(/\[([^\]]+)\]\(\.\.\/IDEAS\.md\)/g, (_, text) => {
      return `[${text}](/docs/architecture/ideas)`;
    })
    // SETUP.md
    .replace(/\[([^\]]+)\]\(\.\.\/SETUP\.md\)/g, (_, text) => {
      return `[${text}](/docs/getting-started/installation)`;
    })
    // VISION.md in same dir
    .replace(/\[([^\]]+)\]\(\.\/VISION\.md\)/g, (_, text) => {
      return `[${text}](vision)`;
    })
    // DESIGN.md in same dir
    .replace(/\[([^\]]+)\]\(\.\/DESIGN\.md\)/g, (_, text) => {
      return `[${text}](design)`;
    });
}

function escapeForMdx(content: string): string {
  // Escape characters that MDX interprets as JSX: < > { }
  // Must not escape inside code blocks or inline code
  const lines = content.split('\n');
  let inCodeBlock = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }
    if (inCodeBlock) {
      // Even inside code blocks, MDX can interpret {expressions}
      // Escape curly braces to prevent JSX evaluation
      result.push(line.replace(/\{/g, '\\{').replace(/\}/g, '\\}'));
    } else {
      // Escape < that aren't part of HTML tags or links, but appear in text
      // e.g., "<50ms" or "<500ms" or "< 10"
      // Strategy: replace < followed by a digit or space+digit (not a valid tag)
      let escaped = line.replace(/(?<!`)(<)(\d)/g, '\\<$2');
      // Also escape { } outside inline code
      // Split on inline code spans and only escape outside them
      const parts = escaped.split(/(`[^`]*`)/);
      escaped = parts.map((part, i) => {
        if (i % 2 === 1) return part; // inside inline code
        return part
          .replace(/(?<!\\)\{/g, '\\{')
          .replace(/(?<!\\)\}/g, '\\}');
      }).join('');
      result.push(escaped);
    }
  }

  return result.join('\n');
}

// ── Main sync ─────────────────────────────────────────────────────────

function syncContent(): void {
  let synced = 0;
  let skipped = 0;

  for (const mapping of MAPPINGS) {
    const srcPath = path.join(ROOT, mapping.src);
    const destPath = path.join(CONTENT_DIR, mapping.dest + '.mdx');
    const relDest = path.relative(CONTENT_DIR, destPath);

    // Check if this is a protected path
    if (PROTECTED_PATHS.has(relDest)) {
      if (fs.existsSync(destPath)) {
        skipped++;
        continue;
      }
    }

    // Check source exists
    if (!fs.existsSync(srcPath)) {
      console.warn(`  SKIP: ${mapping.src} (not found)`);
      skipped++;
      continue;
    }

    // Read and process
    let content = fs.readFileSync(srcPath, 'utf-8');
    content = stripFrontmatter(content);

    const title = mapping.title || extractTitle(content);
    const description = extractDescription(content);

    // Strip the title heading (we render it via frontmatter)
    content = stripTitle(content);

    // Strip the description blockquote if it follows immediately
    content = content.replace(/^>\s+.+\n+/m, '');

    // Rewrite links
    const destDir = path.dirname(mapping.dest);
    content = rewriteLinks(content, destDir);

    // Escape MDX-incompatible characters
    content = escapeForMdx(content);

    // Build frontmatter
    let frontmatter = `---\ntitle: "${title.replace(/"/g, '\\"')}"`;
    if (description) {
      frontmatter += `\ndescription: "${description.replace(/"/g, '\\"')}"`;
    }
    frontmatter += '\n---\n\n';

    const final = frontmatter + content.trim() + '\n';

    // Ensure directory exists
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    // Write
    fs.writeFileSync(destPath, final, 'utf-8');
    synced++;
  }

  console.log(`\nSynced ${synced} files, skipped ${skipped}`);

  // Write meta.json files
  let metaCount = 0;
  for (const def of META_DEFS) {
    const metaPath = path.join(CONTENT_DIR, def.dir, 'meta.json');
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify(def.meta, null, 2) + '\n', 'utf-8');
    metaCount++;
  }

  console.log(`Wrote ${metaCount} meta.json files`);
}

syncContent();
