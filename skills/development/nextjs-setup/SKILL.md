---
name: Next.js Project Setup
description: Best practices for setting up a Next.js project
triggers: [nextjs, next.js, react app, frontend setup]
---

# Next.js Project Setup

## Purpose
Guide for setting up a new Next.js 14+ project with best practices.

## Instructions

### Project Initialization
```bash
npx create-next-app@latest my-app --typescript --tailwind --eslint --app --src-dir
```

### Recommended Structure
```
src/
  app/
    layout.tsx       # Root layout
    page.tsx         # Home page
    globals.css      # Global styles
  components/
    ui/              # Reusable UI components
  lib/
    utils/           # Utility functions
    db/              # Database operations
  types/             # TypeScript type definitions
```

### Key Configuration

**tsconfig.json paths:**
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**tailwind.config.ts:**
- Configure content paths
- Add custom colors to theme
- Use CSS variables for theming

### Best Practices
1. Use App Router (not Pages Router)
2. Keep components small and focused
3. Use server components by default
4. Add 'use client' only when needed
5. Colocate files (keep related files together)

### Common Patterns
- API routes in `app/api/`
- Loading states with `loading.tsx`
- Error handling with `error.tsx`
- Dynamic routes with `[param]/`
