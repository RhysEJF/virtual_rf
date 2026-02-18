# Flow Design Document

> Detailed UI mockups, interaction patterns, and design rationale for the AI workforce management system.

---

> **NOTE FOR AI AGENTS AND DEVELOPERS**
>
> This document is the **original design spec** written at project inception. The UI mockups and patterns here informed the build but may not match the current implementation exactly.
>
> **For up-to-date documentation, see:**
> - [docs/vision/README.md](./docs/vision/README.md) - Index of modular vision docs
> - [docs/vision/UI.md](./docs/vision/UI.md) - Current UI components and pages
> - [docs/vision/DATABASE.md](./docs/vision/DATABASE.md) - Current schema (18 tables)
>
> The modular vision docs in `docs/vision/` describe **what exists today** based on code audits.
>
> **When making changes:** Update the relevant modular doc, not this file.

---

**Related:** See [VISION.md](./VISION.md) for original high-level philosophy.

---

## Table of Contents

1. [Design Principles](#design-principles)
2. [Information Architecture](#information-architecture)
3. [UI Mockups](#ui-mockups)
   - [Dashboard (Outcome List)](#mockup-1-dashboard-outcome-list)
   - [Outcome Detail View](#mockup-2-outcome-detail-view)
   - [Worker Drill-Down](#mockup-3-worker-drill-down)
   - [Command-First Interface](#mockup-4-command-first-interface-clitelegram)
4. [Execution Flow](#execution-flow)
5. [API Layer](#api-layer)
6. [Key Design Decisions](#key-design-decisions)

---

## Design Principles

### Visual Aesthetic
- **Minimalistic, not busy** - Focus on content, not chrome
- **Matte, not shiny** - Earthy, calm, professional
- **Dark mode optimized** - For long work sessions
- **High information density** - But never overwhelming

### Interaction Philosophy
- **Voice-first input** - Ramble naturally, AI optimizes
- **Clarify before execute** - Always confirm understanding
- **Progressive disclosure** - Summary first, details on demand
- **Convergence visibility** - Show progress toward done

### Data Model
Based on insights from compound engineering research:
- **PRD (Intent)** = WHAT we're building (stable, user-facing)
- **Design Doc (Approach)** = HOW we're building (can evolve)
- **Tasks** = Executable work items (generated, scored, prioritized)
- **Progress** = Compacted episodic memory (not raw logs)

---

## Information Architecture

### Outcome States (Recency-Based Auto-Sorting)

Instead of traditional "todo/in-progress/done", we use attention-based states:

```
OUTCOMES
├── 🔥 Active Focus (recently touched, work happening)
├── 💤 Dormant (paused intentionally, not forgotten)
├── ✓ Achieved (explicit celebration - optional for ongoing outcomes)
└── 📦 Archived (no longer relevant)
```

**Smart defaults:**
- Outcomes with recent activity bubble to top
- Untouched for 2+ weeks auto-collapse (but stay searchable)
- Some outcomes are explicitly "Ongoing" (∞) and never "achieve"
- Filter dropdown for explicit control when needed

**Why this works:**
- No guilt about dormant items (intentional pause ≠ failure)
- Active work naturally visible
- Achieved is a celebration, not a requirement

---

## UI Mockups

### Mockup 1: Dashboard (Outcome List)

The primary view. Shows all outcomes with activity feed.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Flow                                           ○ ● Dark Mode    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ What would you like to work on?                              ⎔  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├────────────────────────────────────┬────────────────────────────────────┤
│                                    │                                    │
│  OUTCOMES                          │  ACTIVITY                          │
│  ─────────              Filter ▾   │  ────────                          │
│                                    │                                    │
│  ┌──────────────────────────────┐  │  ┌──────────────────────────────┐  │
│  │ ● Launch ProductX MVP        │  │  │ Task completed: Hero section │  │
│  │   12 tasks · 2 workers       │  │  │ built with animations        │  │
│  │   Q1 2025 · 📉 converging    │  │  │ ProductX · 2 min ago         │  │
│  └──────────────────────────────┘  │  └──────────────────────────────┘  │
│                                    │                                    │
│  ┌──────────────────────────────┐  │  ┌──────────────────────────────┐  │
│  │ ∞ Scale ConsultingY          │  │  │ Review cycle: 3 new issues   │  │
│  │   8 tasks · 1 worker         │  │  │ added, 12 resolved           │  │
│  │   Ongoing · 📉 converging    │  │  │ ConsultingY · 15 min ago     │  │
│  └──────────────────────────────┘  │  └──────────────────────────────┘  │
│                                    │                                    │
│  ┌──────────────────────────────┐  │  ┌──────────────────────────────┐  │
│  │ ○ Personal Brand Refresh     │  │  │ Design doc updated:          │  │
│  │   Paused · 5 tasks waiting   │  │  │ Switched to Framer Motion    │  │
│  │                      [wake]  │  │  │ ProductX · 1 hour ago        │  │
│  └──────────────────────────────┘  │  └──────────────────────────────┘  │
│                                    │                                    │
│  ─────────────────────────────────  │                                    │
│  + 8 more outcomes      [View all]  │                                    │
│                                    │                                    │
│  + New Outcome                     │                                    │
│                                    │                                    │
├────────────────────────────────────┴────────────────────────────────────┤
│  ▲ 3 workers · 20 active tasks · 📉 all converging                      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Filter dropdown:**
```
┌───────────────────────────────────────────────────────┐
│  ☑ Active focus                                       │
│  ☑ Has active work                                    │
│  ☐ Dormant (paused)                                   │
│  ☐ Achieved                                           │
│  ☐ Archived                                           │
│  ─────────────────                                    │
│  ☐ Only mine (no collaborators)                       │
│  ☐ Shared with others                                 │
└───────────────────────────────────────────────────────┘
```

**Key elements:**
- Command bar always prominent at top
- Outcomes show task counts (not just workers)
- Convergence indicator (📉) shows progress toward done
- Activity feed shows task completions, reviews, design updates
- "Wake" button to bring dormant outcomes back to focus

---

### Mockup 2: Outcome Detail View

The deep view for a single outcome. Shows Intent, Approach, Tasks, Workers, Progress.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back                                                ○ ● Dark Mode    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  LAUNCH PRODUCTX MVP                                                    │
│  ══════════════════                                                     │
│                                                                         │
│  Q1 2025 · sarah@client.com, mike@agency.com              [+ Invite]    │
│                                                                         │
│  ┌─ INTENT (PRD) ───────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  What this outcome will achieve:                                  │  │
│  │  ┌─────────────────────────────────────────────────────────────┐ │  │
│  │  │                                                             │ │  │
│  │  │  • Users can view a landing page that explains ProductX     │ │  │
│  │  │  • Users can sign up for early access via email             │ │  │
│  │  │  • Page loads in <2s and scores 90+ on Lighthouse           │ │  │
│  │  │  • 3% conversion rate target                                │ │  │
│  │  │                                                             │ │  │
│  │  │  [Edit]                                                     │ │  │
│  │  │                                                             │ │  │
│  │  └─────────────────────────────────────────────────────────────┘ │  │
│  │                                                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐ │  │
│  │  │ Ramble your thoughts here... (voice or text)             ⎔  │ │  │
│  │  │                                                             │ │  │
│  │  │                                                             │ │  │
│  │  └─────────────────────────────────────────────────────────────┘ │  │
│  │                                                                   │  │
│  │  [Optimize Intent]                           [Redefine Success]  │  │
│  │                                                                   │  │
│  │  "Optimize" takes your ramble and generates a polished PRD.      │  │
│  │  "Redefine Success" triggers impact analysis on existing work.   │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ APPROACH (Design Doc) ──────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  How we're building it:                                           │  │
│  │  ┌─────────────────────────────────────────────────────────────┐ │  │
│  │  │                                                             │ │  │
│  │  │  • Next.js 14 with App Router                               │ │  │
│  │  │  • Tailwind CSS + Framer Motion for animations              │ │  │
│  │  │  • Resend for email capture                                 │ │  │
│  │  │  • Vercel deployment                                        │ │  │
│  │  │                                                             │ │  │
│  │  │  [Edit]                                                     │ │  │
│  │  │                                                             │ │  │
│  │  └─────────────────────────────────────────────────────────────┘ │  │
│  │                                                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐ │  │
│  │  │ Add thoughts on approach... (voice or text)              ⎔  │ │  │
│  │  │                                                             │ │  │
│  │  │                                                             │ │  │
│  │  └─────────────────────────────────────────────────────────────┘ │  │
│  │                                                                   │  │
│  │  [Optimize Approach]                           [Change Approach] │  │
│  │                                                                   │  │
│  │  "Optimize" uses Intent + your notes + available skills to       │  │
│  │  generate a recommended approach. May trigger research.          │  │
│  │                                                                   │  │
│  │  Last updated: 2 hours ago (switched from CSS to Framer Motion)  │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ ACTIVE TASKS ────────────────────────────────────── 8 of 12 ────┐  │
│  │                                                                   │  │
│  │  Convergence: 📉 Improving (3 new issues last cycle, was 7)       │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │                                                                   │  │
│  │  #1  [████████████████] Set up Next.js project        ✓ done     │  │
│  │  #2  [████████████████] Create hero section           ✓ done     │  │
│  │  #3  [████████████████] Add email signup form         ✓ done     │  │
│  │  #4  [████████████░░░░] Build testimonials section    ● running  │  │
│  │  #5  [████░░░░░░░░░░░░] Create pricing comparison     ● running  │  │
│  │  #6  [░░░░░░░░░░░░░░░░] Add footer with CTA           ○ queued   │  │
│  │  #7  [░░░░░░░░░░░░░░░░] Mobile responsive pass        ○ queued   │  │
│  │  #8  [░░░░░░░░░░░░░░░░] Lighthouse optimization       ○ queued   │  │
│  │                                                                   │  │
│  │  + 4 tasks from last review cycle                                 │  │
│  │                                                                   │  │
│  │  [Add Task]  [Reprioritize]                      [View All 12]    │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ WORKERS ────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐ │  │
│  │  │ Ralph #1: Landing Page Builder                    running   │ │  │
│  │  │ Working on: #4 Build testimonials section                   │ │  │
│  │  │ Iteration: 34 · Last commit: 3 min ago                      │ │  │
│  │  │ [View Log] [Intervene] [Pause]                              │ │  │
│  │  └─────────────────────────────────────────────────────────────┘ │  │
│  │                                                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐ │  │
│  │  │ Ralph #2: Asset Generator                         running   │ │  │
│  │  │ Working on: #5 Create pricing comparison                    │ │  │
│  │  │ Iteration: 12 · Last commit: 1 min ago                      │ │  │
│  │  │ [View Log] [Intervene] [Pause]                              │ │  │
│  │  └─────────────────────────────────────────────────────────────┘ │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ PROGRESS (Compacted) ───────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  Latest (Iteration 34):                                           │  │
│  │  • Testimonials section 80% complete                              │  │
│  │  • Found issue: avatar images need optimization                   │  │
│  │  • Design doc updated: using next/image for optimization          │  │
│  │                                                                   │  │
│  │  Previous (Iterations 20-33 compacted):                           │  │
│  │  • Hero section built with fade-in animations                     │  │
│  │  • Email form connected to Resend, tested working                 │  │
│  │  • Review cycle added 4 responsive design tasks                   │  │
│  │                                                                   │  │
│  │  [View Full History]                                              │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ LINKED RESOURCES ───────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  SHARED (GitHub - changes need PR)                                │  │
│  │  • github.com/client/productx-landing          [View] [PR: 2]    │  │
│  │                                                                   │  │
│  │  PRIVATE (Your context)                                           │  │
│  │  • Research/competitor-analysis.md             [View]             │  │
│  │  • Strategy/positioning.md                     [View]             │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key interactions:**

1. **Intent ramble box** - Speak or type raw thoughts, hit "Optimize Intent" to generate polished PRD
2. **Approach ramble box** - Add notes, hit "Optimize Approach" to generate design doc using:
   - The Intent (PRD) as context
   - Your notes/ramble
   - Available skills
   - May trigger research for best practices
3. **Redefine Success** - Triggers impact analysis workflow (see below)
4. **Change Approach** - Update HOW without changing WHAT

**Why ramble boxes:**
- High-level outcomes like "build an app 100k people love" need human thought
- Speaking is faster than typing structured docs
- AI optimizes the ramble into structured format
- Human reviews and edits the output

---

### Mockup 2b: Redefine Success Flow

When user clicks "Redefine Success":

```
┌─────────────────────────────────────────────────────────────────────────┐
│  REDEFINE SUCCESS                                              [Close]  │
│  ═════════════════                                                      │
│                                                                         │
│  Current Success Criteria:                                              │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ • Landing page live with 3% conversion                             │ │
│  │ • 1000 email signups                                               │ │
│  │ • Page loads in <2s, Lighthouse 90+                                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  New Success Criteria:                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Ramble your new vision here... (voice or text)                  ⎔ │ │
│  │                                                                    │ │
│  │ "Actually I want to target 5% conversion now and I think we       │ │
│  │  need mobile-first design, the current approach isn't going to    │ │
│  │  work for mobile users which are 70% of our traffic..."           │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  [Optimize & Analyze Impact]                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

After clicking "Optimize & Analyze Impact":

```
┌─────────────────────────────────────────────────────────────────────────┐
│  IMPACT ANALYSIS                                               [Close]  │
│  ═══════════════                                                        │
│                                                                         │
│  Optimized New Intent:                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ • Landing page live with 5% conversion (was 3%)                    │ │
│  │ • 1000 email signups (unchanged)                                   │ │
│  │ • Mobile-first responsive design (NEW)                             │ │
│  │ • Page loads in <2s, Lighthouse 90+ (unchanged)                    │ │
│  │                                                          [Edit]    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ SUMMARY ──────────────────────────────────────────────────────────┐ │
│  │  2 changes affect completed work                                   │ │
│  │  1 new requirement added                                           │ │
│  │  1 change affects shared code (needs PR)                           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ COMPLETED WORK AFFECTED ──────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  ⚠ Conversion tracking dashboard                                   │ │
│  │    Current: Shows 3% target                                        │ │
│  │    Change: Update to show 5% target                                │ │
│  │    Effort: Minor (config change)                                   │ │
│  │                                                                    │ │
│  │  ✓ Email signup flow - No changes needed                           │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ IN-PROGRESS WORK AFFECTED ────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  ⚠ Tasks #4, #5, #6 (UI components)                                │ │
│  │    NEW: Must be mobile-first responsive                            │ │
│  │    Impact: Design doc update + 3 new tasks generated               │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ GITHUB CHANGES REQUIRED ──────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  📁 github.com/client/productx-landing (SHARED)                    │ │
│  │     Will create branch: scope/mobile-first-redesign                │ │
│  │     Will create PR for collaborator review                         │ │
│  │                                                                    │ │
│  │  📁 Your private context (PRIVATE)                                 │ │
│  │     PRD updates (direct)                                           │ │
│  │     Design doc updates (direct)                                    │ │
│  │     New tasks generated (direct)                                   │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  [Abandon]                              [Accept & Create PR]            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Mockup 3: Worker Drill-Down

Deep view into a single worker's execution.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back to ProductX MVP                                ○ ● Dark Mode    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  RALPH #1: LANDING PAGE BUILDER                                         │
│  ═════════════════════════════                                          │
│                                                                         │
│  Status: ● running · Iteration 34 · Started 2 hours ago                 │
│                                                                         │
│  ┌─ CURRENT TASK ───────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  #4 Build testimonials section                                    │  │
│  │  ─────────────────────────────                                    │  │
│  │  Priority: 2 (high) · Estimated: medium · Attempts: 1             │  │
│  │                                                                   │  │
│  │  From PRD (Intent):                                               │  │
│  │  "Users see social proof from 3 early adopters"                   │  │
│  │                                                                   │  │
│  │  From Design Doc (Approach):                                      │  │
│  │  "Horizontal card layout, avatar + quote + name/title,            │  │
│  │   Framer Motion fade-in on scroll"                                │  │
│  │                                                                   │  │
│  │  Progress: [████████████░░░░░░░░] 60%                             │  │
│  │                                                                   │  │
│  │  Subtasks:                                                        │  │
│  │  ✓ Create TestimonialCard component                               │  │
│  │  ✓ Add sample testimonial data                                    │  │
│  │  ○ Implement scroll animation                                     │  │
│  │  ○ Add responsive breakpoints                                     │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ TASK QUEUE ─────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  Next up (by priority):                                           │  │
│  │  1. #6 Add footer with CTA (priority: 3)                          │  │
│  │  2. #7 Mobile responsive pass (priority: 4)                       │  │
│  │  3. #8 Lighthouse optimization (priority: 5)                      │  │
│  │                                                                   │  │
│  │  [Reprioritize]                                                   │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ LIVE PROGRESS ──────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  Iteration 34 (current):                                          │  │
│  │  > Reading TestimonialCard.tsx                                    │  │
│  │  > Adding useInView hook for scroll detection                     │  │
│  │  > Installing framer-motion...                                    │  │
│  │  > Writing animation variants                                     │  │
│  │                                                                   │  │
│  │  ──────────────────────────────────────────────────────────────   │  │
│  │                                                                   │  │
│  │  Iteration 33 (compacted):                                        │  │
│  │  Created testimonial data structure and component skeleton.       │  │
│  │  Committed: "Add TestimonialCard component"                       │  │
│  │                                                                   │  │
│  │  Iteration 32 (compacted):                                        │  │
│  │  Finished email signup form. Verified working with test email.    │  │
│  │  Committed: "Complete email capture flow"                         │  │
│  │                                                                   │  │
│  │  [View Full Log]                                                  │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ REVIEW STATUS ──────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  Last review: Iteration 30                                        │  │
│  │  Issues found: 3 (down from 7 at iteration 20)                    │  │
│  │  Convergence: 📉 Improving                                        │  │
│  │                                                                   │  │
│  │  Issues from last review:                                         │  │
│  │  • Avatar images need lazy loading (added as subtask)             │  │
│  │  • Missing aria-labels on form (added as subtask)                 │  │
│  │  • Hero CTA button needs hover state (completed)                  │  │
│  │                                                                   │  │
│  │  Next review: ~Iteration 40                                       │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ ACTIONS ────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐ │  │
│  │  │ Intervene: Tell Ralph something...                       ⎔  │ │  │
│  │  └─────────────────────────────────────────────────────────────┘ │  │
│  │                                                                   │  │
│  │  [Pause]  [Skip Task]  [Force Review]  [Kill]                     │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key elements:**
- Shows which task worker is on (not PRD item directly)
- Task shows its origin (PRD intent + Design approach)
- Live progress for current iteration
- Compacted progress for previous iterations
- Review status with convergence indicator
- Intervention box for human input

---

### Mockup 4: Command-First Interface (CLI/Telegram)

For terminal and Telegram interactions:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Flow                                           ○ ● Dark Mode    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                        ┌───────────────────────────────────┐            │
│                        │                                   │            │
│                        │   What would you like to          │            │
│                        │   work on?                     ⎔  │            │
│                        │                                   │            │
│                        │   Context: ProductX MVP ▾         │            │
│                        │                                   │            │
│                        └───────────────────────────────────┘            │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  You: "yeah so I need like a landing page that converts really    │ │
│  │  well, thinking maybe 5% conversion, needs to work on mobile      │ │
│  │  because most of our users are on phones, oh and we need email    │ │
│  │  capture for the waitlist"                                        │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │  │  RF: Let me clarify what I understood:                       │ │ │
│  │  │                                                              │ │ │
│  │  │  You want a landing page for ProductX that:                  │ │ │
│  │  │  • Targets 5% conversion rate                                │ │ │
│  │  │  • Mobile-first design (most users on phones)                │ │ │
│  │  │  • Email capture for waitlist signups                        │ │ │
│  │  │                                                              │ │ │
│  │  │  A few questions:                                            │ │ │
│  │  │  1. Do you have existing brand assets (colors, logo)?        │ │ │
│  │  │  2. Any specific sections needed (testimonials, pricing)?    │ │ │
│  │  │  3. Where should this be deployed?                           │ │ │
│  │  │                                                              │ │ │
│  │  │  [Approve Understanding]  [Clarify More]                     │ │ │
│  │  └──────────────────────────────────────────────────────────────┘ │ │
│  │                                                                    │ │
│  │  You: "yes we have brand stuff, need testimonials and pricing,    │ │
│  │  deploy to vercel"                                                │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │  │  RF: Perfect. Creating outcome under ProductX MVP.           │ │ │
│  │  │                                                              │ │ │
│  │  │  Intent (PRD):                                               │ │ │
│  │  │  • Mobile-first landing page with 5% conversion target       │ │ │
│  │  │  • Email waitlist capture                                    │ │ │
│  │  │  • Testimonials section with social proof                    │ │ │
│  │  │  • Pricing comparison section                                │ │ │
│  │  │                                                              │ │ │
│  │  │  Approach (Design Doc):                                      │ │ │
│  │  │  • Next.js 14 + Tailwind (mobile-first)                      │ │ │
│  │  │  • Framer Motion for animations                              │ │ │
│  │  │  • Resend for email                                          │ │ │
│  │  │  • Vercel deployment                                         │ │ │
│  │  │                                                              │ │ │
│  │  │  [Start Work]  [Edit First]                                  │ │ │
│  │  └──────────────────────────────────────────────────────────────┘ │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐        │
│  │ ● ProductX MVP   │ │ ○ ConsultingY    │ │ ○ + New Outcome  │        │
│  │   2 active       │ │   idle           │ │                  │        │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘        │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  ▲ 2 workers · $0.00 today · [All Items] [Pool] [Settings]              │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key flow:**
1. User rambles naturally (voice or text)
2. System clarifies understanding + asks questions
3. User confirms/adds more context
4. System generates PRD + Design Doc
5. User approves to start work

**The Briefer Agent receives:**
- Original ramble
- Clarification Q&A
- Final polished summary
- Full conversation context

---

## Execution Flow

How user input becomes executed work:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                         THE EXECUTION FLOW                              │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │   USER INPUT (often messy ramble)                                 │  │
│  │   "yeah so I need like a landing page that converts..."           │  │
│  │                                                                   │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │   DISPATCHER                                                      │  │
│  │   • Parses messy input                                            │  │
│  │   • Asks clarifying questions                                     │  │
│  │   • Generates polished summary                                    │  │
│  │   • Gets user approval                                            │  │
│  │                                                                   │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│                              │                                          │
│                              │ Passes to Briefer:                       │
│                              │ • Original ramble                        │
│                              │ • Q&A exchange                           │
│                              │ • Polished summary                       │
│                              │ • Full conversation context              │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │   BRIEFER AGENT                                                   │  │
│  │   Creates PRD (WHAT) + Design Doc (HOW)                           │  │
│  │   • May use "optimize approach" skill                             │  │
│  │   • May trigger research for best practices                       │  │
│  │                                                                   │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│                              │                                          │
│              ┌───────────────┴───────────────┐                          │
│              │                               │                          │
│              ▼                               ▼                          │
│  ┌─────────────────────┐       ┌─────────────────────────────────────┐  │
│  │                     │       │                                     │  │
│  │   PRD (Intent)      │       │   DESIGN DOC (Approach)             │  │
│  │                     │       │                                     │  │
│  │   The WHAT          │       │   The HOW                           │  │
│  │   • Users see X     │       │   • Next.js + Tailwind              │  │
│  │   • System does Y   │◀─────▶│   • Framer Motion                   │  │
│  │   • Success = Z     │ linked│   • Vercel deploy                   │  │
│  │                     │       │                                     │  │
│  │   Stays stable      │       │   Can evolve                        │  │
│  │                     │       │                                     │  │
│  └─────────────────────┘       └─────────────────────────────────────┘  │
│              │                               │                          │
│              └───────────────┬───────────────┘                          │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │   TASK GENERATOR                                                  │  │
│  │   Creates executable tasks from PRD + Design Doc                  │  │
│  │   • Scores by priority                                            │  │
│  │   • Estimates effort                                              │  │
│  │                                                                   │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │   TASKS (Scored & Prioritized)                                    │  │
│  │                                                                   │  │
│  │   #1 [P:1] Set up Next.js          ───────────────────────────▶  │  │
│  │   #2 [P:2] Create hero section     ───────────────────────────▶  │  │
│  │   #3 [P:2] Add email signup        ───────────────────────────▶  │  │
│  │   #4 [P:2] Build testimonials      ───────────────────────────▶  │  │
│  │   ...                                                             │  │
│  │                                                                   │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│                              │                                          │
│              ┌───────────────┼───────────────┐                          │
│              │               │               │                          │
│              ▼               ▼               ▼                          │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐                 │
│  │               │ │               │ │               │                 │
│  │   RALPH #1    │ │   RALPH #2    │ │   RALPH #N    │                 │
│  │               │ │               │ │               │                 │
│  │   Picks task  │ │   Picks task  │ │   Picks task  │                 │
│  │   Executes    │ │   Executes    │ │   Executes    │                 │
│  │   Commits     │ │   Commits     │ │   Commits     │                 │
│  │               │ │               │ │               │                 │
│  └───────┬───────┘ └───────┬───────┘ └───────┬───────┘                 │
│          │                 │                 │                          │
│          └─────────────────┼─────────────────┘                          │
│                            │                                            │
│                            ▼                                            │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │   REVIEW AGENT (every N iterations)                               │  │
│  │                                                                   │  │
│  │   • Checks work quality                                           │  │
│  │   • Finds issues                                                  │  │
│  │   • Adds new tasks ──────────────────────────────▶ TASKS          │  │
│  │   • Tracks convergence (fewer issues = getting close)             │  │
│  │                                                                   │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │   PRIORITIZER AGENT                                               │  │
│  │                                                                   │  │
│  │   • Reads progress                                                │  │
│  │   • Re-scores tasks based on what's learned                       │  │
│  │   • Reorders queue ──────────────────────────────▶ TASKS          │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │   STOPPING CRITERIA                                               │  │
│  │                                                                   │  │
│  │   Stop when:                                                      │  │
│  │   • All tasks complete                              AND           │  │
│  │   • Review agent finds 0 new issues                 AND           │  │
│  │   • Convergence confirmed (2+ cycles with 0 issues)               │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Layer

All interfaces (Web, CLI, Telegram) are thin clients over the same API.

### Core Endpoints

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  POST /api/converse          ← Main interaction endpoint        │   │
│  │  GET  /api/outcomes          ← List outcomes (filtered)         │   │
│  │  POST /api/outcomes          ← Create outcome                   │   │
│  │  GET  /api/outcomes/:id      ← Outcome detail                   │   │
│  │  PATCH /api/outcomes/:id     ← Update (incl. redefine success)  │   │
│  │  POST /api/outcomes/:id/optimize-intent     ← AI optimize PRD   │   │
│  │  POST /api/outcomes/:id/optimize-approach   ← AI optimize design│   │
│  │  GET  /api/pool              ← Flat item list                   │   │
│  │  GET  /api/tasks             ← Task list (by outcome)           │   │
│  │  PATCH /api/tasks/:id        ← Update task                      │   │
│  │  POST /api/tasks/reprioritize ← Trigger reprioritization        │   │
│  │  GET  /api/workers/:id       ← Worker status                    │   │
│  │  POST /api/workers/:id/intervene  ← Send intervention           │   │
│  │  GET  /api/stream            ← SSE for real-time updates        │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
     ┌─────────┐       ┌─────────┐       ┌─────────┐
     │   WEB   │       │   CLI   │       │TELEGRAM │
     │   UI    │       │         │       │   BOT   │
     │         │       │  rf     │       │         │
     │ React   │       │  command│       │ Webhook │
     │ Next.js │       │         │       │ → API   │
     └─────────┘       └─────────┘       └─────────┘
```

### The `/api/converse` Endpoint

Main interaction endpoint. Handles natural language, routes internally.

```typescript
// POST /api/converse
Request:
{
  "message": "yeah so I need like a landing page...",
  "context": {
    "outcome_id": "outcome_123",    // optional - can be inferred
    "session_id": "sess_abc",       // for conversation continuity
    "source": "web"                 // web | cli | telegram
  }
}

Response:
{
  "type": "clarification",          // clarification | confirmation | execution
  "message": "Let me clarify what I understood...",
  "understanding": {
    "summary": "Landing page with 5% conversion, mobile-first...",
    "questions": [
      "Do you have existing brand assets?",
      "Any specific sections needed?"
    ]
  },
  "session_id": "sess_abc"
}

// After clarification confirmed:
Response:
{
  "type": "execution",
  "message": "Creating outcome under ProductX MVP.",
  "outcome": {
    "id": "outcome_123",
    "name": "ProductX Landing Page",
    "prd": { ... },
    "design_doc": { ... }
  },
  "tasks_created": 8,
  "workers_spawned": 1,
  "session_id": "sess_abc"
}
```

### Telegram Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TELEGRAM FLOW                                   │
│                                                                         │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐       │
│  │  Telegram   │ webhook │   Your      │  POST   │   @rf API   │       │
│  │  Servers    │────────▶│   Server    │────────▶│             │       │
│  │             │         │  (webhook   │         │  /converse  │       │
│  │             │◀────────│   handler)  │◀────────│             │       │
│  │             │ sendMsg │             │  JSON   │             │       │
│  └─────────────┘         └─────────────┘         └─────────────┘       │
│                                                                         │
│  Session Management:                                                    │
│  • telegram_chat_id → session_id mapping                               │
│  • Outcome context persists per chat                                   │
│  • "switch to ConsultingY" changes context                             │
│                                                                         │
│  Telegram Commands:                                                     │
│  /outcomes       - List active outcomes                                │
│  /switch X       - Set context to outcome X                            │
│  /status         - Current workers and progress                        │
│  /intervene ...  - Send intervention to worker                         │
│                                                                         │
│  Or just talk naturally - AI routes appropriately                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   LOCAL (Your Machine / Mac Mini)       DEPLOYED (Server)               │
│   ═══════════════════════════════       ═════════════════               │
│                                                                         │
│   ┌─────────────────┐                   ┌─────────────────┐            │
│   │   Next.js App   │                   │   API Gateway   │            │
│   │   (Full UI)     │                   │                 │            │
│   │                 │                   │   • /converse   │            │
│   │   localhost:    │                   │   • /outcomes   │            │
│   │   3000          │                   │   • /telegram   │            │
│   │                 │                   │     webhook     │            │
│   │   SQLite DB     │◀──── tunnel ─────▶│                 │            │
│   │   Claude CLI    │                   │   Routes to     │            │
│   │   Workers       │                   │   local via     │            │
│   └─────────────────┘                   │   Cloudflare    │            │
│                                         │   Tunnel        │            │
│                                         └─────────────────┘            │
│                                                  │                      │
│                                                  ▼                      │
│                                         ┌─────────────────┐            │
│                                         │    Telegram     │            │
│                                         │    Bot API      │            │
│                                         └─────────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Tunnel approach:**
- Telegram webhook → server → Cloudflare tunnel → your local machine
- Workers run locally with Claude CLI (uses your Max subscription)
- Full power, requires machine to be on (Mac Mini always-on solution)

---

## Key Design Decisions

### 1. PRD vs Design Doc vs Tasks

**Decision:** Separate these three artifacts.

**Rationale:** Based on compound engineering research (James Phoenix insights):
- PRD (Intent) = WHAT. Stays stable. User-facing behavior.
- Design Doc (Approach) = HOW. Can change without changing intent.
- Tasks = Executable work. Generated from PRD + Design, scored, prioritized.

This separation allows:
- Changing architecture without changing requirements
- Clear stopping criteria (all tasks done + review passes)
- Better progress tracking (task completion, not vague PRD progress)

### 2. Ramble + Optimize Pattern

**Decision:** Allow messy voice/text input with "Optimize" button.

**Rationale:**
- User input is often unstructured (especially voice)
- Forcing structure slows down ideation
- AI can polish ramble into structured PRD/Design
- Human reviews and edits the output

### 3. Convergence-Based Stopping

**Decision:** Track review cycles and measure convergence.

**Rationale:**
- "All tasks done" isn't enough (new issues always emerge)
- Convergence = fewer new issues each review cycle
- Stop when: tasks done + 0 new issues for 2+ cycles
- Visual indicator helps user understand progress

### 4. Compacted Progress (Episodic Memory)

**Decision:** Compact progress logs instead of showing raw output.

**Rationale:**
- Raw logs are overwhelming and hard to scan
- Compaction preserves key information
- Each iteration summarized, older iterations compressed further
- Workers inject compacted progress into their context

### 5. Shared vs Private Zones

**Decision:** Explicit separation of shared (GitHub) and private (local) resources.

**Rationale:**
- Collaborators should only see what's shared
- Private research/strategy stays yours
- Shared code changes require PRs (branch-per-scope-change)
- Private context can be edited directly

### 6. API-First Architecture

**Decision:** All interfaces (Web, CLI, Telegram) use same API.

**Rationale:**
- Consistent behavior across interfaces
- Easier to add new interfaces (Slack, etc.)
- Core logic lives in one place
- Enables tunnel-to-local deployment pattern

---

---

## Implementation Details (From Research)

### Task Management System (James's Model + SQLite Claiming)

James's core insight: **Separate PRD from Tasks**. The PRD defines WHAT, tasks are the executable work items.

**Task Lifecycle:**
```
PRD + Design Doc
       │
       ▼
┌─────────────────┐
│ Task Generator  │  Creates scored, prioritized tasks
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    TASKS TABLE (SQLite)                     │
│                                                             │
│  id | outcome_id | title | status | priority | claimed_by  │
│  ───┼────────────┼───────┼────────┼──────────┼───────────  │
│  1  | out_123    | Hero  | done   | 1        | null        │
│  2  | out_123    | Form  | claimed| 2        | ralph_1     │
│  3  | out_123    | Footer| pending| 3        | null        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │
         │  Atomic claiming (from oh-my-claudecode pattern)
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│Ralph 1│ │Ralph 2│   Each worker:
│       │ │       │   1. BEGIN IMMEDIATE transaction
│Claims │ │Claims │   2. SELECT first pending task
│task 2 │ │task 3 │   3. UPDATE status='claimed', claimed_by=me
└───────┘ └───────┘   4. COMMIT (only one succeeds per task)
```

**Why SQLite atomic claiming:**
- Prevents race conditions when multiple workers run in parallel
- Workers self-organize without central coordinator
- Stale claims auto-released via heartbeat timeout (5 min)
- Aligns with James's task management requirement

### Verification & Convergence (James's Model + Checklist)

James's insight: **Track convergence** - fewer issues each review cycle means getting closer to done.

**Verification Checklist** (borrowed from oh-my-claudecode, adapted):
```
┌─ VERIFICATION GATES ────────────────────────────────────────┐
│                                                             │
│  Before marking outcome complete, verify:                   │
│                                                             │
│  □ BUILD    - Code compiles/builds without errors           │
│  □ TEST     - All tests pass                                │
│  □ LINT     - No linting errors                             │
│  □ FUNCTION - Core functionality works as intended          │
│  □ PRD      - All PRD items addressed                       │
│  □ TASKS    - All tasks complete (none pending/claimed)     │
│  □ REVIEW   - Last review found 0 new issues                │
│  □ CONVERGE - 2+ consecutive reviews with 0 new issues      │
│                                                             │
│  Evidence must be fresh (within 5 minutes of completion)    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Convergence Tracking:**
```
Review Cycle 1: 12 issues found
Review Cycle 2: 7 issues found   ← improving
Review Cycle 3: 3 issues found   ← improving
Review Cycle 4: 0 issues found   ← converging
Review Cycle 5: 0 issues found   ← DONE (2 consecutive zeros)
```

### Skill System (James's Model + Structure)

James's insight: **Skills = deterministic paths**. They're dynamically loaded CLAUDE.md files with specific instructions for task types.

**When to Build a Skill (Quality Gates):**

1. **Effort gate:** Did this require real debugging/research work?
   - If you could Google it in 5 minutes → don't build skill

2. **Reuse gate:** Will this be used again?
   - One-time task → don't build skill
   - Recurring pattern → build skill

3. **Context gate:** Would putting this in main CLAUDE.md bloat it?
   - Small, always-needed → put in CLAUDE.md
   - Large, sometimes-needed → make it a skill

4. **Competitive edge gate:** Does this tilt advantage toward the outcome?
   - If overall success requires superhuman-level performance here → build skill
   - If this is key throughout the project lifespan → build skill
   - If mastering this creates defensible advantage → build skill

**Skill File Structure:**
```markdown
---
name: epub-review
description: Review ePub book builds for quality issues
triggers:
  - "review epub"
  - "check book"
scripts:
  - scripts/validate-exercises.ts
  - scripts/screenshot-pages.ts
---

# ePub Review Skill

## When to Use
This skill applies when reviewing ePub book builds...

## Required Steps
1. Run `npm run build:epub` to generate fresh build
2. Run `scripts/validate-exercises.ts` to check code blocks
3. Run `scripts/screenshot-pages.ts` to capture pages
4. Review screenshots for CSS/layout issues

## Scripts Reference
- `validate-exercises.ts --hash-check` - Only re-run changed code
- `screenshot-pages.ts --pages 1-10` - Limit page range
```

**Skill Learning Flow:**
```
Worker encounters hard problem
         │
         ▼
Solves it through debugging/research
         │
         ▼
┌─────────────────────────────────────────┐
│         QUALITY GATES                   │
│                                         │
│  □ Required real effort? (not Google)   │
│  □ Will be reused?                      │
│  □ Too big for CLAUDE.md?               │
│  □ Creates competitive edge?            │
│                                         │
│  All yes? → Extract as skill            │
│  Any no?  → Don't extract               │
└─────────────────────────────────────────┘
         │
         ▼
AI extracts PRINCIPLE, not code snippet
         │
         ▼
Creates SKILL.md with:
- The insight (why this matters)
- Recognition pattern (when to apply)
- The approach (decision framework)
- Scripts (if custom tooling needed)
```

### Progress Compaction (James's Model)

James's insight: **Episodic memory** - compact progress over time so context doesn't explode.

**Compaction Strategy:**
```
Iteration 1-10:   Raw entries in progress.txt
Iteration 11:     Compact iterations 1-10 into summary
Iteration 11-20:  Raw entries continue
Iteration 21:     Compact iterations 11-20 into summary
...

Result in CLAUDE.md context:
- Summary of iterations 1-10 (compacted)
- Summary of iterations 11-20 (compacted)
- Raw details of iterations 21-current
```

### Model Routing (Future Enhancement)

> **Note:** Currently using Claude Max subscription via CLI. Future enhancement to route by complexity:

```
// FUTURE: Tiered model routing
const MODEL_TIERS = {
  LOW: 'haiku',      // Quick lookups, simple operations
  MEDIUM: 'sonnet',  // Standard implementations
  HIGH: 'opus',      // Complex reasoning, architecture
};

function selectModel(taskComplexity: string): string {
  // For now, always use default (user's subscription)
  return 'default';

  // FUTURE: Route based on complexity
  // return MODEL_TIERS[taskComplexity] || 'sonnet';
}
```

---

## Git Integration & Output Control

### Philosophy

**Key insight:** We don't need complex OAuth integrations. Git is already on the user's machine, already authenticated via SSH keys or credential helpers. We need **workflow orchestration** on top of existing git.

**Core principle:** User controls what flows where, and when. Never auto-push. Always review before sharing.

### The Three Zones

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     RESOURCE CLASSIFICATION                              │
│                                                                         │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │     🔒 PRIVATE          │  │        🌐 SHAREABLE                  │  │
│  │     (Never committed)   │  │        (Can be committed)            │  │
│  │                         │  │                                      │  │
│  │  • API Keys             │  │  • Skills (SKILL.md files)           │  │
│  │  • .env.local           │  │  • Tools (scripts skills use)        │  │
│  │  • Personal notes       │  │  • Source code                       │  │
│  │  • Draft explorations   │  │  • Documentation                     │  │
│  │  • Local app state      │  │  • Config (non-secret)               │  │
│  │                         │  │                                      │  │
│  └─────────────────────────┘  └─────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                    🎛️ USER CONTROLLED                              │ │
│  │                    (User decides per-item)                         │ │
│  │                                                                    │ │
│  │  • Outcome outputs (code, docs, assets)                            │ │
│  │  • Custom tools (share with team or keep private?)                 │ │
│  │  • Research findings (share insights or keep competitive edge?)    │ │
│  │                                                                    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Output Destination Model

Each outcome can be configured with where its outputs flow:

```typescript
interface OutcomeGitConfig {
  // Where work happens
  workingDirectory: string;

  // Git mode
  gitMode: 'none' | 'local' | 'branch' | 'worktree';

  // Branch settings (when gitMode is 'branch' or 'worktree')
  baseBranch?: string;           // e.g., 'main'
  workBranch?: string;           // e.g., 'outcome/productx-landing'
  branchNaming?: 'auto' | 'custom';

  // Commit behavior
  autoCommit: boolean;           // Commit after each task?
  commitStrategy: 'per-task' | 'per-iteration' | 'manual';

  // Push behavior (NEVER auto-push by default)
  pushStrategy: 'manual' | 'ask-on-complete' | 'never';
  createPrOnComplete: boolean;   // For collaboration mode
}
```

### Workflow Modes

#### Mode 1: Solo, No Git
```
Use case: Exploring ideas, not ready to version control
─────────────────────────────────────────────────────────

User selects: gitMode = 'none'
         ↓
Workers create files in working directory
         ↓
No commits, no branches
         ↓
User can later "Adopt" outputs into a repo if they want
```

#### Mode 2: Solo, Own Repo
```
Use case: Working on personal project with full control
─────────────────────────────────────────────────────────

User selects: gitMode = 'branch', baseBranch = 'main'
         ↓
Outcome creates: outcome/feature-name branch
         ↓
Workers commit to branch locally
         ↓
User reviews outputs in UI
         ↓
User clicks "Merge to main" (local merge, no PR needed)
         ↓
User clicks "Push" when ready
```

#### Mode 3: Collaboration, Shared Repo
```
Use case: Working with team, need review before merge
─────────────────────────────────────────────────────────

User selects: gitMode = 'branch', createPrOnComplete = true
         ↓
Outcome creates: outcome/feature-name branch
         ↓
Workers commit to branch locally
         ↓
User reviews outputs in UI (selective commit inclusion)
         ↓
User clicks "Create PR"
         ↓
gh pr create --title "..." --body "..."
         ↓
Opens PR in browser, collaborators review
```

#### Mode 4: Isolated Parallel Work
```
Use case: Multiple outcomes working on same repo simultaneously
─────────────────────────────────────────────────────────

User selects: gitMode = 'worktree'
         ↓
Git worktree created: .worktrees/outcome-{id}/
         ↓
Each outcome has isolated copy of repo
         ↓
No conflicts between parallel workers
         ↓
Merge back via PR workflow
```

### Output Review UI

User must always review before pushing:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     OUTCOME: ProductX Landing                            │
│                                                                         │
│  ┌─ OUTPUT REVIEW ──────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  Branch: outcome/productx-landing                                 │  │
│  │  Base: main (↓3 commits behind)                    [Sync Base]    │  │
│  │                                                                   │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │                                                                   │  │
│  │  LOCAL COMMITS (not pushed):                                      │  │
│  │                                                                   │  │
│  │  ☑ abc1234  Add hero section with animations         +142 -12    │  │
│  │             components/Hero.tsx, styles/hero.css                  │  │
│  │                                                      [View Diff]  │  │
│  │                                                                   │  │
│  │  ☑ def5678  Implement email signup form              +89 -3      │  │
│  │             components/SignupForm.tsx, lib/email.ts               │  │
│  │                                                      [View Diff]  │  │
│  │                                                                   │  │
│  │  ☑ ghi9012  Add testimonials component               +67 -0      │  │
│  │             components/Testimonials.tsx                           │  │
│  │                                                      [View Diff]  │  │
│  │                                                                   │  │
│  │  ☐ jkl3456  WIP: pricing table (incomplete)          +23 -0      │  │
│  │             ⚠ Uncommitted changes in working tree                 │  │
│  │                                                      [View Diff]  │  │
│  │                                                                   │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │                                                                   │  │
│  │  FILES MODIFIED (summary):                                        │  │
│  │  • 4 new files, 2 modified, 0 deleted                             │  │
│  │  • No sensitive files detected ✓                                  │  │
│  │                                                                   │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │                                                                   │  │
│  │  [Discard Selected]  [Push Selected]  [Create PR]                 │  │
│  │                                                                   │  │
│  │  ⚠ Base branch has new commits. Recommend syncing before push.   │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Git Operations (No OAuth Required)

All git operations use the user's existing authentication:

| Operation | Implementation | Auth Source |
|-----------|---------------|-------------|
| Clone | `git clone` | SSH keys / credential helper |
| Create branch | `git checkout -b {name}` | Local only |
| Commit | `git commit -m "..."` | Local only |
| Push | `git push -u origin {branch}` | SSH keys / credential helper |
| Create PR | `gh pr create` | GitHub CLI auth |
| Check status | `git status`, `git log` | Local only |
| Detect remote changes | `git fetch && git rev-list` | SSH keys / credential helper |

**No OAuth tokens stored in the app. No GitHub API keys needed.**

---

## Skills, Tools & API Keys Architecture

### The Separation of Concerns

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   SKILL = Instructions (WHAT to do, HOW to do it)                       │
│   ───────────────────────────────────────────────                       │
│   • Markdown file with structured guidance                              │
│   • Can reference tools by name                                         │
│   • Can declare API key requirements                                    │
│   • SHAREABLE - can be committed to repos                               │
│                                                                         │
│   TOOL = Executable capability (scripts, CLIs, integrations)            │
│   ──────────────────────────────────────────────────────────            │
│   • Scripts that skills can invoke                                      │
│   • May need API keys to function                                       │
│   • USER CONTROLLED - user decides if shared or private                 │
│                                                                         │
│   API KEY = Secret credential                                           │
│   ───────────────────────────────                                       │
│   • Required by some tools to function                                  │
│   • ALWAYS PRIVATE - never committed, never in LLM context              │
│   • Stored in .env.local (gitignored) or system keychain                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Skill Structure (Enhanced)

```yaml
# skills/research/web-research/SKILL.md
---
name: web-research
description: Research topics using web search and content extraction
version: 1.0.0
category: research

# What this skill needs to function
requires:
  apis:
    - name: SERPER_API_KEY
      purpose: Web search queries
      required: true
    - name: FIRECRAWL_API_KEY
      purpose: Web page content extraction
      required: false
      fallback: "Uses basic fetch if not available"

  tools:
    - name: search-web
      path: ./tools/search-web.ts
    - name: extract-content
      path: ./tools/extract-content.ts

# Whether this skill can be shared
sharing:
  shareable: true
  # Tools bundled with skill are shared too
  includeTools: true
---

# Web Research Skill

## When to Use
Use this skill when you need to research a topic using web sources...

## Process
1. Use `search-web` tool to find relevant sources
2. Use `extract-content` tool to get page content
3. Synthesize findings into structured output

## Tool Reference

### search-web
```bash
npx ts-node tools/search-web.ts --query "your search query" --limit 10
```

### extract-content
```bash
npx ts-node tools/extract-content.ts --url "https://example.com"
```
```

### Tool Privacy Control

Users decide what tools to share:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     TOOL: competitor-scraper                             │
│                                                                         │
│  Location: skills/research/tools/competitor-scraper.ts                   │
│  Used by: competitive-analysis skill                                     │
│  Requires: BROWSERBASE_API_KEY                                          │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │  Sharing Settings:                                                 │  │
│  │                                                                    │  │
│  │  ○ Private - Keep in .gitignore, don't share                       │  │
│  │     Tool stays local, collaborators won't see it                   │  │
│  │                                                                    │  │
│  │  ● Shared - Commit to repo, available to collaborators             │  │
│  │     Tool code is visible, but API keys remain private              │  │
│  │                                                                    │  │
│  │  ○ Shared (Obfuscated) - Commit but minimize code visibility       │  │
│  │     For competitive tools you want to share but not expose         │  │
│  │                                                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### API Key Management

API keys are managed separately from skills:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          SETTINGS > API KEYS                             │
│                                                                         │
│  API keys are stored securely in .env.local and never leave your        │
│  machine. They're passed to workers as environment variables.           │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │  KEY                    STATUS      USED BY                      │   │
│  │  ─────────────────────────────────────────────────────────────  │   │
│  │                                                                  │   │
│  │  SERPER_API_KEY         ✓ Set      web-research, seo-analysis   │   │
│  │                                                        [Edit]    │   │
│  │                                                                  │   │
│  │  FIRECRAWL_API_KEY      ✓ Set      web-research                 │   │
│  │                                                        [Edit]    │   │
│  │                                                                  │   │
│  │  BROWSERBASE_API_KEY    ○ Not Set  competitor-scraper           │   │
│  │                                                        [Add]     │   │
│  │                                                                  │   │
│  │  OPENAI_API_KEY         ○ Not Set  (none currently)             │   │
│  │                                                        [Add]     │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  [+ Add Custom Key]                                                     │
│                                                                         │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  ⚠ Keys are written directly to .env.local                             │
│  ⚠ Never passed through AI models or logged                            │
│  ⚠ Never committed to git (.env.local is in .gitignore)                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Skills Library Page (Redesigned)

Focus on skills, not API keys:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back to Dashboard                                                     │
│                                                                         │
│  SKILLS LIBRARY                                          [Sync] [+ New] │
│  Reusable capabilities that Ralph can use on tasks                      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 🔍 Search skills...                              [All Categories]│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  RESEARCH (3)                                                           │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────┐ │
│  │ 🌐 Web Research                  │  │ 📊 Competitive Analysis      │ │
│  │                                  │  │                              │ │
│  │ Research topics using web       │  │ Analyze competitor products  │ │
│  │ search and content extraction   │  │ and market positioning       │ │
│  │                                  │  │                              │ │
│  │ Tools: 2  │  Uses: 14           │  │ Tools: 3  │  Uses: 8         │ │
│  │                                  │  │                              │ │
│  │ ✓ Ready                         │  │ ⚠ Missing: BROWSERBASE_KEY   │ │
│  │                       [View]    │  │                       [View] │ │
│  └──────────────────────────────────┘  └──────────────────────────────┘ │
│                                                                         │
│  ┌──────────────────────────────────┐                                   │
│  │ 📈 SEO Analysis                  │                                   │
│  │                                  │                                   │
│  │ Analyze SEO performance and     │                                   │
│  │ generate optimization tasks     │                                   │
│  │                                  │                                   │
│  │ Tools: 1  │  Uses: 3            │                                   │
│  │                                  │                                   │
│  │ ✓ Ready                         │                                   │
│  │                       [View]    │                                   │
│  └──────────────────────────────────┘                                   │
│                                                                         │
│  DEVELOPMENT (2)                                                        │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────┐ │
│  │ ⚛️ React Patterns                │  │ 🗄️ Database Design           │ │
│  │                                  │  │                              │ │
│  │ Best practices for React        │  │ Design efficient database    │ │
│  │ component architecture          │  │ schemas and queries          │ │
│  │                                  │  │                              │ │
│  │ Tools: 0  │  Uses: 21           │  │ Tools: 1  │  Uses: 5         │ │
│  │                                  │  │                              │ │
│  │ ✓ Ready (no API keys needed)    │  │ ✓ Ready                      │ │
│  │                       [View]    │  │                       [View] │ │
│  └──────────────────────────────────┘  └──────────────────────────────┘ │
│                                                                         │
│  ─────────────────────────────────────────────────────────────────────  │
│  ⚙️ 2 skills need API keys configured. [Go to Settings]                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Skill Detail View

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back to Skills                                                        │
│                                                                         │
│  🌐 WEB RESEARCH                                              [Edit]    │
│  ═══════════════                                                        │
│                                                                         │
│  Research topics using web search and content extraction                │
│                                                                         │
│  Category: Research  │  Version: 1.0.0  │  Uses: 14                     │
│                                                                         │
│  ┌─ REQUIREMENTS ───────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  API Keys:                                                        │  │
│  │  • SERPER_API_KEY (required)     ✓ Configured                    │  │
│  │  • FIRECRAWL_API_KEY (optional)  ✓ Configured                    │  │
│  │                                                                   │  │
│  │  Tools:                                                           │  │
│  │  • search-web.ts                 ✓ Available                     │  │
│  │  • extract-content.ts            ✓ Available                     │  │
│  │                                                                   │  │
│  │  Status: ✓ Ready to use                                          │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ SHARING ────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  This skill is: 🌐 Shared (committed to repo)                     │  │
│  │                                                                   │  │
│  │  Tools included:                                                  │  │
│  │  • search-web.ts        🌐 Shared                                │  │
│  │  • extract-content.ts   🌐 Shared                                │  │
│  │                                                                   │  │
│  │  Collaborators who clone this repo will:                          │  │
│  │  • See this skill and its tools                                   │  │
│  │  • Need to add their own API keys to use it                       │  │
│  │                                                                   │  │
│  │  [Change Sharing Settings]                                        │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ INSTRUCTIONS ───────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  ## When to Use                                                   │  │
│  │  Use this skill when you need to research a topic using web      │  │
│  │  sources...                                                       │  │
│  │                                                                   │  │
│  │  ## Process                                                       │  │
│  │  1. Use `search-web` tool to find relevant sources               │  │
│  │  2. Use `extract-content` tool to get page content               │  │
│  │  3. Synthesize findings into structured output                   │  │
│  │                                                                   │  │
│  │  [View Full Markdown]                                             │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ USAGE HISTORY ──────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  Recent uses:                                                     │  │
│  │  • ProductX MVP - Market research task (2 hours ago)              │  │
│  │  • ConsultingY - Competitor analysis (yesterday)                  │  │
│  │  • Product Strategy - Industry trends (3 days ago)                │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Collaborator Onboarding Flow

When someone clones a repo that uses Digital Twin:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Step 1: Clone repo                                                     │
│  ───────────────────                                                    │
│  $ git clone git@github.com:team/project.git                            │
│  $ cd project                                                           │
│                                                                         │
│  Repo contains:                                                         │
│  • Source code                                                          │
│  • skills/ directory with team's shared skills                          │
│  • .gitignore includes .env.local                                       │
│                                                                         │
│  Step 2: First run of Digital Twin                                      │
│  ─────────────────────────────────                                      │
│  App detects:                                                           │
│  • This is a git repo                                                   │
│  • skills/ directory exists with 3 skills                               │
│  • Some skills need API keys                                            │
│                                                                         │
│  Step 3: Onboarding prompt                                              │
│  ──────────────────────────                                             │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │  Welcome to ProductX!                                              │  │
│  │                                                                    │  │
│  │  This project has 3 shared skills. Some need API keys to work:    │  │
│  │                                                                    │  │
│  │  web-research                                                      │  │
│  │  ├── SERPER_API_KEY (required)      [Add Key]                     │  │
│  │  └── FIRECRAWL_API_KEY (optional)   [Add Key] [Skip]              │  │
│  │                                                                    │  │
│  │  competitive-analysis                                              │  │
│  │  └── BROWSERBASE_API_KEY (required) [Add Key]                     │  │
│  │                                                                    │  │
│  │  react-patterns                                                    │  │
│  │  └── No API keys needed ✓                                         │  │
│  │                                                                    │  │
│  │  Your keys are stored in .env.local (gitignored, never shared)    │  │
│  │                                                                    │  │
│  │  [Configure Now]  [Skip for Now]                                   │  │
│  │                                                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  Step 4: Ready to work                                                  │
│  ─────────────────────                                                  │
│  User can now use the shared skills with their own API keys.            │
│  Outputs flow to branches, PRs for collaboration.                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## File System Layout

```
project/
├── .git/                          # Git repo (user's existing auth)
├── .gitignore                     # Includes .env.local, .digital-twin/
├── .env.local                     # 🔒 API KEYS - NEVER COMMITTED
│   ├── SERPER_API_KEY=xxx
│   ├── FIRECRAWL_API_KEY=xxx
│   └── ...
│
├── .digital-twin/                 # 🔒 LOCAL APP STATE - NEVER COMMITTED
│   ├── outcomes.db                # SQLite database
│   ├── cache/                     # Temporary files
│   └── logs/                      # Worker logs
│
├── skills/                        # 🌐 SHAREABLE (if user chooses)
│   ├── research/
│   │   ├── web-research/
│   │   │   ├── SKILL.md           # Skill instructions
│   │   │   └── tools/             # Tool scripts
│   │   │       ├── search-web.ts
│   │   │       └── extract-content.ts
│   │   └── competitive-analysis/
│   │       ├── SKILL.md
│   │       └── tools/
│   │           └── analyze-competitor.ts
│   └── development/
│       └── react-patterns/
│           └── SKILL.md           # No tools, just instructions
│
├── src/                           # 🌐 PROJECT SOURCE (committed)
│   └── ...
│
├── workspaces/                    # 🔒 WORKING FILES - GITIGNORED
│   └── outcome-{id}/              # Per-outcome working directory
│       ├── progress.txt
│       └── task-{id}/
│
└── package.json
```

### .gitignore Additions

```gitignore
# Digital Twin - Private files
.env.local
.digital-twin/
workspaces/

# Optional: Private skills/tools (if user marks them private)
skills/**/*.private.ts
skills/**/.private/
```

---

## Change Log

| Date | Change | Rationale |
|------|--------|-----------|
| 2026-01-29 | Initial design document | Consolidate mockups and decisions |
| 2026-01-29 | Added PRD/Design/Tasks separation | Based on compound engineering research (James) |
| 2026-01-29 | Added ramble + optimize pattern | Support voice-first natural input |
| 2026-01-29 | Added convergence tracking | Clear stopping criteria for workers (James) |
| 2026-01-29 | Added SQLite atomic task claiming | From oh-my-claudecode, aligns with James's task management |
| 2026-01-29 | Added verification checklist | Adapted from oh-my-claudecode, supports convergence |
| 2026-01-29 | Added skill quality gates | James's model + competitive edge gate |
| 2026-01-29 | Added progress compaction details | James's episodic memory concept |
| 2026-01-29 | Noted model routing for future | Infrastructure placeholder |
| 2026-01-29 | Added Git Integration & Output Control | Workflow orchestration without OAuth |
| 2026-01-29 | Added Skills, Tools & API Keys Architecture | Clear separation of shareable vs private |
| 2026-01-29 | Added Collaborator Onboarding Flow | How team members join and configure |
| 2026-01-29 | Added File System Layout | Clear mapping of what goes where |

---

*This document captures the detailed design decisions for Flow. For high-level vision and philosophy, see [VISION.md](./VISION.md).*
