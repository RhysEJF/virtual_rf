# Website Analyzer

## Purpose

This skill enables deep analysis of company websites to extract positioning, messaging strategy, feature sets, and market differentiation. It provides a systematic framework for understanding how a company presents itself to the market, what value propositions they emphasize, and how they differentiate from competitors.

**Strategic Advantage:** By systematically crawling and analyzing websites, you can:
- Extract the exact language companies use to describe their value
- Identify target customer segments from messaging cues
- Map complete feature sets from product pages
- Understand pricing models and go-to-market strategies
- Compare positioning across multiple competitors objectively

## Tools Available

- **web-scraper**: Extracts structured data from URLs. Use for fetching page content, navigation structures, and specific page sections.
- **position-parser**: Analyzes messaging and positioning language. Use for extracting value propositions, differentiators, and target audience signals.
- **feature-extractor**: Identifies features from product pages. Use for building comprehensive feature lists and capability inventories.

## Methodology

### Phase 1: Site Discovery and Mapping

**Objective:** Understand the complete website structure before deep analysis.

**Step 1.1: Identify Key Page Categories**

Every B2B software website follows a predictable structure. Map these pages first:

| Page Type | Typical URLs | Analysis Value |
|-----------|--------------|----------------|
| Homepage | `/`, `/home` | Primary value proposition, hero messaging |
| Product/Features | `/product`, `/features`, `/platform` | Feature inventory, capability claims |
| Solutions | `/solutions`, `/use-cases`, `/industries` | Target segments, vertical focus |
| Pricing | `/pricing`, `/plans` | Business model, market positioning (enterprise vs SMB) |
| About | `/about`, `/company`, `/about-us` | Company narrative, founding story, mission |
| Customers | `/customers`, `/case-studies` | Social proof, target customer profile |
| Resources | `/resources`, `/blog`, `/docs` | Thought leadership, content strategy |
| Careers | `/careers`, `/jobs` | Growth signals, culture indicators |

**Step 1.2: Execute Site Map Crawl**

```
ACTION: Use web-scraper to fetch homepage and extract navigation links
INPUT: {company_url}
OUTPUT: List of all navigable pages with URL patterns

For each major section, record:
- Page URL
- Page title
- Primary heading (H1)
- Meta description (if available)
```

**Step 1.3: Document Site Structure**

Create a site map table:

```markdown
| URL | Page Type | H1/Title | Notes |
|-----|-----------|----------|-------|
| /   | Homepage  | [Extract] | Primary positioning |
| /features | Features | [Extract] | Feature inventory |
| ... | ... | ... | ... |
```

---

### Phase 2: Messaging Analysis

**Objective:** Extract and categorize the company's core messaging.

**Step 2.1: Homepage Messaging Extraction**

The homepage contains the most refined positioning statements. Extract:

1. **Hero Headline** - The primary value proposition (usually H1 or largest text above fold)
2. **Hero Subheadline** - Supporting explanation or benefit statement
3. **CTA Text** - Call-to-action button text reveals intent (e.g., "Start Free Trial" vs "Request Demo" vs "Contact Sales")
4. **Social Proof** - Customer logos, stats, testimonials above the fold

**Step 2.2: Value Proposition Analysis**

Use the position-parser tool to categorize messaging into:

| Messaging Type | Example Signals | What It Reveals |
|----------------|-----------------|-----------------|
| **Problem-focused** | "Tired of...", "Stop wasting...", "Eliminate..." | Pain point targeting |
| **Solution-focused** | "The only platform that...", "All-in-one..." | Positioning claim |
| **Outcome-focused** | "Increase revenue by...", "Save X hours..." | ROI messaging |
| **Category-creating** | Unique terminology, new category names | Market positioning ambition |
| **Category-claiming** | "#1 in...", "Leader in..." | Established category play |

**Step 2.3: Target Audience Identification**

Extract audience signals from:

- **Explicit mentions**: "Built for [role/industry]", "For teams that..."
- **Language level**: Technical jargon vs. business language
- **Social proof**: Customer logos indicate target company size and industry
- **Pricing page**: Tiers reveal SMB vs. Mid-market vs. Enterprise focus
- **Solutions pages**: Industry-specific pages reveal vertical focus

**Output Template - Messaging Analysis:**

```markdown
## [Company Name] Messaging Analysis

### Primary Value Proposition
> [Exact hero headline text]

### Supporting Statement
> [Subheadline or supporting copy]

### Positioning Type
- [ ] Problem-focused
- [ ] Solution-focused
- [ ] Outcome-focused
- [ ] Category-creating
- [ ] Category-claiming

### Key Differentiators Claimed
1. [Differentiator 1]
2. [Differentiator 2]
3. [Differentiator 3]

### Target Audience Signals
- **Company Size:** [SMB / Mid-market / Enterprise / Mixed]
- **Industries:** [List specific industries mentioned]
- **Roles:** [List job titles/functions mentioned]
- **Use Cases:** [List specific use cases highlighted]

### CTA Strategy
- Primary CTA: [Text] → [Indicates: free trial / sales-led / PLG]
- Secondary CTA: [Text]

### Source URLs
- [URL 1]
- [URL 2]
```

---

### Phase 3: Feature Extraction

**Objective:** Build a complete inventory of product capabilities.

**Step 3.1: Feature Page Deep Crawl**

Identify and crawl all feature-related pages:
- Main features/product page
- Individual feature detail pages
- Integration pages
- API/developer documentation (for technical capabilities)

**Step 3.2: Feature Categorization Framework**

Organize features into standard categories for cross-competitor comparison:

| Category | Sub-categories | Example Features |
|----------|----------------|------------------|
| **Core Functionality** | Primary product capabilities | Scheduling, dispatching, work orders |
| **Data & Reporting** | Analytics, dashboards, exports | Custom reports, real-time dashboards |
| **Integrations** | Native, API, marketplace | QuickBooks, Salesforce, Zapier |
| **Mobile** | Apps, offline, field access | iOS/Android apps, offline mode |
| **Automation** | Workflows, triggers, AI | Auto-scheduling, smart routing |
| **Collaboration** | Team features, communication | Chat, notes, notifications |
| **Administration** | Settings, permissions, security | Role-based access, SSO, audit logs |

**Step 3.3: Feature Extraction Process**

```
For each feature page:
1. Extract feature name/title
2. Extract feature description
3. Identify feature category
4. Note any quantitative claims (e.g., "50+ integrations")
5. Flag unique/differentiating features
6. Record source URL
```

**Output Template - Feature Inventory:**

```markdown
## [Company Name] Feature Inventory

### Core Functionality
| Feature | Description | Differentiator? | Source |
|---------|-------------|-----------------|--------|
| [Name]  | [Brief description] | Yes/No | [URL] |

### Data & Reporting
| Feature | Description | Differentiator? | Source |
|---------|-------------|-----------------|--------|

### Integrations
- **Native Integrations:** [Count and key names]
- **API:** [Yes/No, documentation quality]
- **Marketplace:** [Yes/No, partner ecosystem size]

### Mobile Capabilities
| Capability | iOS | Android | Offline | Source |
|------------|-----|---------|---------|--------|

### Automation & AI
| Feature | Description | Differentiator? | Source |
|---------|-------------|-----------------|--------|

### Unique/Differentiating Features
1. [Feature] - [Why it's unique]
2. [Feature] - [Why it's unique]
```

---

### Phase 4: Competitive Positioning Analysis

**Objective:** Understand how the company positions against alternatives.

**Step 4.1: Comparison Page Analysis**

Many companies have explicit competitor comparison pages. Search for:
- `/compare`, `/vs`, `/alternative-to`
- `[company] vs [competitor]` pages
- "Why choose us" or "Why [company]" pages

Extract:
- Which competitors they compare against (reveals who they see as competition)
- Claims made against competitors
- Differentiators emphasized in comparisons

**Step 4.2: Implicit Positioning Signals**

Even without explicit comparisons, positioning is revealed through:

| Signal | What to Look For | Interpretation |
|--------|------------------|----------------|
| **Pricing display** | Shown openly vs. "Contact us" | PLG vs. Enterprise sales model |
| **Customer logos** | Fortune 500 vs. startup logos | Enterprise vs. SMB focus |
| **Feature depth** | Extensive vs. simple feature lists | Platform vs. point solution |
| **Language complexity** | Technical vs. accessible | Technical buyer vs. business buyer |
| **Vertical focus** | Industry-specific messaging | Niche vs. horizontal player |

**Step 4.3: Market Category Positioning**

Identify how the company defines its market category:
- What do they call themselves? ("field service management", "workforce optimization", etc.)
- Do they use established category terms or create new ones?
- What related categories do they mention?

---

### Phase 5: Business Model Analysis

**Objective:** Understand pricing and go-to-market strategy.

**Step 5.1: Pricing Page Analysis**

If pricing is public, extract:

| Element | Extract | Interpretation |
|---------|---------|----------------|
| **Pricing model** | Per user, per asset, flat fee, usage-based | Cost structure, scalability |
| **Tier names** | Basic/Pro/Enterprise, etc. | Market segmentation |
| **Tier pricing** | Actual numbers or ranges | Market positioning |
| **Feature gating** | What's in each tier | Core vs. premium features |
| **Enterprise tier** | "Contact us" tier presence | Enterprise sales motion |
| **Free tier/trial** | Availability and limits | PLG strategy |

**Step 5.2: Sales Motion Indicators**

| Indicator | Signal | Interpretation |
|-----------|--------|----------------|
| "Request Demo" prominent | Primary CTA | Sales-led, likely enterprise focus |
| "Start Free Trial" prominent | Primary CTA | Product-led growth |
| Chat widget | Present, proactive | Inside sales support |
| Pricing calculator | Present | Transparent, self-serve friendly |
| ROI calculator | Present | Enterprise, value selling |

---

### Phase 6: Social Proof Analysis

**Objective:** Understand customer base and market validation.

**Step 6.1: Customer Logo Analysis**

Extract and categorize customer logos:
- Company size (startup / SMB / mid-market / enterprise)
- Industry vertical
- Geographic region (if identifiable)
- Logo placement (homepage vs. dedicated page indicates importance)

**Step 6.2: Case Study Analysis**

For each case study, extract:
- Customer company name and profile
- Problem/challenge addressed
- Solution implemented
- Quantitative outcomes (if stated)
- Industry vertical

**Step 6.3: Review Platform Presence**

Note presence and ratings on:
- G2 (include link if found)
- Capterra
- GetApp
- TrustRadius
- Industry-specific directories

---

## Analysis Framework

### Scoring Rubric for Positioning Clarity

| Dimension | Score 1-5 | Criteria |
|-----------|-----------|----------|
| **Value Prop Clarity** | | 5=Crystal clear in <5 seconds, 1=Confusing/generic |
| **Target Audience Specificity** | | 5=Specific roles/industries, 1="Everyone" |
| **Differentiation Strength** | | 5=Unique/defensible claims, 1=Generic benefits |
| **Social Proof Quality** | | 5=Relevant logos + outcomes, 1=None/weak |
| **Feature Completeness** | | 5=Comprehensive inventory, 1=Vague capabilities |

### Positioning Matrix Placement Factors

When comparing multiple companies, use extracted data to score on dimensions like:

- **Target Market**: SMB ←→ Enterprise (based on pricing, logos, messaging)
- **Solution Scope**: Point Solution ←→ Platform (based on feature breadth)
- **Vertical Focus**: Horizontal ←→ Vertical (based on industry-specific content)
- **Technology Focus**: Legacy/Established ←→ Modern/Innovative (based on tech claims)

---

## Output Template

### Complete Website Analysis Report

```markdown
# [Company Name] Website Analysis

**Analysis Date:** [Date]
**Website URL:** [URL]
**Analyst:** [Name/AI]

---

## Executive Summary

[2-3 sentence summary of positioning, target market, and key differentiators]

---

## 1. Company Overview

- **Founded:** [Year, if found]
- **Headquarters:** [Location, if found]
- **Company Size Signals:** [Funding, employee count, customer count - if available]

---

## 2. Positioning Analysis

### Primary Value Proposition
> [Exact text from website]

### Positioning Category
- [Problem/Solution/Outcome/Category-focused]

### Target Market
- **Company Size:** [SMB / Mid-market / Enterprise]
- **Industries:** [List]
- **Buyer Personas:** [List roles]
- **Geographic Focus:** [If apparent]

### Key Differentiators
1. [Differentiator + evidence]
2. [Differentiator + evidence]
3. [Differentiator + evidence]

---

## 3. Feature Inventory

### Core Capabilities
[Table of core features]

### Integration Ecosystem
- Native integrations: [Count, key names]
- API availability: [Yes/No, quality notes]
- Partner ecosystem: [Assessment]

### Mobile & Field Capabilities
[Table of mobile features]

### Unique Features
[List of standout/unique capabilities]

---

## 4. Business Model

### Pricing Model
[Model type and tier structure]

### Sales Motion
[PLG / Sales-led / Hybrid]

### Target Deal Size
[Inferred from pricing and positioning]

---

## 5. Social Proof

### Customer Logos
[List notable logos by segment]

### Case Studies
[Summary of case studies analyzed]

### Review Platform Presence
- G2: [Rating, review count, link]
- Capterra: [Rating, review count, link]
- Other: [As applicable]

---

## 6. Competitive Positioning

### Stated Competitors
[List any competitors mentioned on site]

### Market Category
[How they define their category]

### Positioning Assessment
[Your analysis of their positioning strength and coherence]

---

## 7. Sources

| Page | URL | Data Extracted |
|------|-----|----------------|
| Homepage | [URL] | Value prop, hero messaging |
| Features | [URL] | Feature inventory |
| Pricing | [URL] | Pricing model |
| ... | ... | ... |

---

## Appendix: Raw Extractions

[Include key verbatim text excerpts for reference]
```

---

## Search Patterns

### Finding Company Websites

For a known company:
```
"[Company Name]" field service management
"[Company Name]" official site
site:[company-domain].com
```

### Finding Specific Page Types

```
site:[domain].com pricing
site:[domain].com features
site:[domain].com integrations
site:[domain].com case studies
site:[domain].com vs [competitor]
```

### Finding Review Data

```
"[Company Name]" site:g2.com
"[Company Name]" site:capterra.com
"[Company Name]" reviews field service
```

---

## Quality Assurance Checklist

Before finalizing any website analysis:

- [ ] All major page types have been crawled
- [ ] Primary value proposition is extracted verbatim
- [ ] Target audience is identified with supporting evidence
- [ ] Feature inventory is complete with source URLs
- [ ] Pricing model is documented (or noted as hidden)
- [ ] At least 3 differentiators are identified with evidence
- [ ] Social proof is catalogued
- [ ] All claims cite specific source pages
- [ ] Analysis date is recorded (websites change)

---

## Common Pitfalls to Avoid

1. **Don't infer unstated claims** - Only document what's explicitly on the website
2. **Don't miss subpages** - Features are often spread across multiple detail pages
3. **Don't ignore footer links** - Often contain important pages like integrations, security, compliance
4. **Don't conflate marketing and reality** - Note when claims seem aspirational vs. documented
5. **Don't skip mobile view** - Some companies show different messaging/CTAs on mobile
6. **Don't forget dated content** - Blog posts and case studies may reveal historical positioning shifts

---

## Integration with Other Skills

This skill's outputs feed directly into:

- **competitor-profiling.md**: Use website analysis as primary input for competitor profiles
- **matrix-builder.md**: Use extracted positioning data to plot companies on strategic matrices
- **strategy-synthesizer.md**: Use feature gaps and positioning insights for recommendations

---

## Version History

- **v1.0** - Initial methodology for deep site crawl and messaging analysis
