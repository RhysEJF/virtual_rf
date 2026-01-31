# Market Intelligence Skill

## Purpose

This skill enables systematic collection and analysis of competitive market intelligence including pricing structures, feature comparisons, contract terms, and market positioning. It provides a reusable framework for understanding the competitive landscape in any B2B software market.

**Strategic Advantage:** By systematically gathering market intelligence, you can:
- Build accurate competitive pricing benchmarks
- Identify feature gaps and opportunities for differentiation
- Understand typical contract terms and buyer expectations
- Map competitor positioning to find whitespace opportunities
- Support data-driven pricing and packaging decisions

## Tools Available

- **web-scraper**: Extract pricing, features, and positioning from competitor websites
- **search-engine**: Find industry reports, analyst coverage, and third-party pricing data
- **review-analyzer**: Extract pricing mentions and feature sentiment from G2, Capterra, TrustRadius
- **document-parser**: Process PDFs, case studies, and analyst reports for market data

---

## Methodology

### Phase 1: Competitive Pricing Intelligence

**Objective:** Build a comprehensive view of competitor pricing models, tiers, and price points.

#### Step 1.1: Direct Pricing Page Analysis

**For each competitor:**

```
ACTION: Crawl pricing page
INPUT: {competitor_url}/pricing (or equivalent)
OUTPUT: Structured pricing data

Extract:
- Pricing model type (per user, per asset, per transaction, flat fee, usage-based, hybrid)
- Tier names and structure
- Listed price points (monthly vs annual, discounts)
- Feature gating by tier
- Enterprise/custom tier indicators
- Add-on pricing if available
```

**Pricing Model Classification:**

| Model Type | Characteristics | Common In | Implications |
|------------|-----------------|-----------|--------------|
| **Per User** | Price × number of users | SaaS broadly | Scales with adoption, seat pressure |
| **Per Asset** | Price × assets managed | Field service, IT mgmt | Aligns with customer value |
| **Flat Fee** | Fixed monthly/annual | SMB tools | Predictable, limits expansion |
| **Usage-Based** | Metered consumption | API, infrastructure | Scales with usage, variable revenue |
| **Per Transaction** | Fee per action | Payments, marketplace | Aligns with customer revenue |
| **Hybrid** | Combination models | Enterprise | Complex, flexible |

#### Step 1.2: Indirect Pricing Discovery

When pricing isn't public, use alternative sources:

**Review Sites:**
```
SEARCH: "[Competitor Name]" pricing site:g2.com
SEARCH: "[Competitor Name]" cost site:capterra.com
SEARCH: "[Competitor Name]" price site:trustradius.com

Look for:
- "Pricing" sections in reviews
- Comments mentioning costs
- Complaints about price changes
- Value-for-money ratings
```

**Comparison Sites:**
```
SEARCH: "[Competitor Name]" pricing comparison
SEARCH: "[Competitor Name]" vs alternatives pricing
SEARCH: "how much does [Competitor Name] cost"
```

**Job Postings (budget signals):**
```
SEARCH: "[Competitor Name]" budget site:linkedin.com
SEARCH: "implementing [Competitor Name]" budget

Look for:
- Software budget mentions in job descriptions
- Implementation consultant rate cards
- Partner pricing materials
```

**Press & Analyst Reports:**
```
SEARCH: "[Competitor Name]" pricing "per user" OR "per month" OR "annually"
SEARCH: "[Competitor Name]" "[price point]" OR "starting at" OR "costs"
```

#### Step 1.3: Pricing Data Normalization

Normalize all pricing to comparable metrics:

```markdown
## Pricing Normalization Table

| Metric | Calculation | Example |
|--------|-------------|---------|
| **Annual per user** | (Monthly × 12) or Annual price | $150/user/year |
| **TCO for 10 users** | Annual cost for typical small team | $1,500/year |
| **TCO for 50 users** | Annual cost for mid-market team | $6,000/year |
| **TCO for 200 users** | Annual cost for enterprise | $20,000/year |
| **Price per asset** | If asset-based, normalize per unit | $5/technician/month |
```

**Output Template - Competitor Pricing:**

```markdown
## [Competitor Name] Pricing Analysis

### Pricing Model
- **Type:** [Per user / Per asset / Flat / Usage / Hybrid]
- **Billing:** [Monthly / Annual / Both]
- **Annual Discount:** [X% if applicable]

### Tier Structure
| Tier | Price | Key Inclusions | Key Exclusions |
|------|-------|----------------|----------------|
| [Name] | $X/user/mo | [Features] | [Features] |
| [Name] | $X/user/mo | [Features] | [Features] |
| Enterprise | Contact | [Features] | N/A |

### Normalized Pricing (Annual)
| Team Size | Annual Cost | Per User | Notes |
|-----------|-------------|----------|-------|
| 10 users | $X | $X | [Tier] |
| 50 users | $X | $X | [Tier] |
| 200 users | $X | $X | [Tier/estimate] |

### Add-ons / Extras
- [Add-on 1]: $X
- [Add-on 2]: $X

### Pricing Intelligence Source
- [ ] Direct (pricing page)
- [ ] Review sites (cite sources)
- [ ] Analyst reports (cite sources)
- [ ] Estimated (explain methodology)

### Sources
- [URL 1]
- [URL 2]
```

---

### Phase 2: Feature Comparison Matrix

**Objective:** Build a comprehensive feature comparison across competitors.

#### Step 2.1: Feature Taxonomy Development

Before comparing, establish a standard feature taxonomy for the market:

**Standard Feature Categories (B2B SaaS):**

| Category | Sub-Category | Description |
|----------|--------------|-------------|
| **Core Platform** | Primary Functions | The essential features that define the product category |
| **Core Platform** | Workflow Automation | Automation capabilities within the platform |
| **Core Platform** | Mobile/Field Access | Mobile apps, offline capability |
| **Data & Analytics** | Reporting | Standard and custom reporting |
| **Data & Analytics** | Dashboards | Real-time visualization |
| **Data & Analytics** | Business Intelligence | Advanced analytics, forecasting |
| **Integrations** | Native Integrations | Built-in connections to other software |
| **Integrations** | API & Developer Tools | Programmatic access and extensibility |
| **Integrations** | Marketplace/Ecosystem | Partner apps and extensions |
| **Administration** | User Management | Roles, permissions, access control |
| **Administration** | Security | SSO, 2FA, audit logs, compliance |
| **Administration** | Customization | Fields, workflows, branding |
| **Support & Services** | Support Tiers | Included support levels |
| **Support & Services** | Implementation | Onboarding, training, services |
| **Support & Services** | SLA/Uptime | Service level guarantees |

#### Step 2.2: Feature Extraction Protocol

**For each competitor:**

```
1. Identify all feature pages:
   - Main features/product page
   - Sub-feature detail pages
   - Integration pages
   - Security/compliance pages
   - Documentation/help center

2. For each feature:
   - Feature name (standardize to taxonomy)
   - Feature description
   - Tier availability (which pricing tiers include it)
   - Quantitative claims (e.g., "50+ integrations")
   - Screenshots or proof if available

3. Record source URLs for all claims
```

#### Step 2.3: Feature Comparison Matrix

**Output Template - Feature Matrix:**

```markdown
## Feature Comparison Matrix

### Core Platform

| Feature | [Company 1] | [Company 2] | [Company 3] | [Our Product] |
|---------|-------------|-------------|-------------|---------------|
| [Feature 1] | ✓ All tiers | ✓ Pro+ | ✗ | ✓ |
| [Feature 2] | ✓ Pro+ | ✓ All | ✓ Enterprise | ✓ |
| [Feature 3] | ✗ | ✓ All | ✓ All | ✗ |

### Data & Analytics

| Feature | [Company 1] | [Company 2] | [Company 3] | [Our Product] |
|---------|-------------|-------------|-------------|---------------|
| [Feature] | [Status] | [Status] | [Status] | [Status] |

### Integrations

| Feature | [Company 1] | [Company 2] | [Company 3] | [Our Product] |
|---------|-------------|-------------|-------------|---------------|
| Native integrations count | 50+ | 30+ | 100+ | X |
| Open API | ✓ | ✓ | ✓ | ✓/✗ |
| Key integrations | [List] | [List] | [List] | [List] |

### Legend
- ✓ = Available
- ✓ [Tier]+ = Available in specified tier and above
- ✗ = Not available
- ~ = Partial/Limited
- ? = Unclear/Unconfirmed
```

---

### Phase 3: Contract Terms Intelligence

**Objective:** Understand typical contract structures, terms, and negotiation leverage points.

#### Step 3.1: Standard Contract Terms Research

**Sources for contract intelligence:**

```
SEARCH: "[Industry] software contract terms"
SEARCH: "[Competitor Name]" "master service agreement" OR "MSA"
SEARCH: "[Competitor Name]" "terms of service" changes
SEARCH: "[Competitor Name]" contract negotiation

Review site searches:
SEARCH: "[Competitor Name]" "contract length" site:g2.com
SEARCH: "[Competitor Name]" "annual contract" site:capterra.com
SEARCH: "[Competitor Name]" "locked in" OR "commitment" site:reddit.com
```

#### Step 3.2: Contract Elements to Track

| Element | What to Find | Where to Find It |
|---------|--------------|------------------|
| **Minimum term** | Monthly vs. annual vs. multi-year | Pricing page, ToS, reviews |
| **Billing frequency** | Monthly, quarterly, annual | Pricing page |
| **Cancellation policy** | Notice period, refund policy | ToS, reviews |
| **Auto-renewal** | Automatic vs. opt-in renewal | ToS, reviews |
| **Price lock** | Guaranteed pricing period | Sales materials, reviews |
| **Price increase caps** | Limits on annual increases | Contract terms, reviews |
| **User minimums** | Minimum seat purchases | Pricing page, sales |
| **Implementation fees** | One-time setup costs | Pricing, reviews |
| **Data portability** | Export capabilities, fees | ToS, documentation |
| **SLA terms** | Uptime guarantees, credits | SLA page, ToS |

#### Step 3.3: Contract Intelligence Output

**Output Template - Contract Terms:**

```markdown
## [Competitor Name] Contract Terms

### Contract Structure
- **Minimum Term:** [Monthly / Annual / Multi-year]
- **Billing Frequency:** [Monthly / Quarterly / Annual]
- **Annual Commitment Required:** [Yes/No, discount if yes]

### Flexibility Terms
- **Cancellation Notice:** [X days/months]
- **Early Termination:** [Policy, fees]
- **Refund Policy:** [Description]
- **Auto-Renewal:** [Yes/No, terms]

### Pricing Protection
- **Price Lock Period:** [Duration]
- **Price Increase Caps:** [X% annually, or none stated]
- **Grandfather Provisions:** [Description if known]

### Additional Fees
- **Implementation/Onboarding:** [$X or included]
- **Training:** [$X or included]
- **Premium Support:** [$X or included]
- **Data Export:** [Free / $X / Restricted]

### SLA
- **Uptime Commitment:** [X%]
- **Credit Policy:** [Description]
- **Support Response Times:** [Description]

### Sources
- Terms of Service: [URL]
- SLA: [URL]
- Review mentions: [URLs]
```

---

### Phase 4: Market Positioning Intelligence

**Objective:** Map competitor positioning and identify market whitespace.

#### Step 4.1: Positioning Data Collection

**For each competitor, extract:**

```
Messaging Analysis:
- Primary value proposition (homepage hero)
- Tagline/slogan
- Key differentiator claims
- Target audience statements

Market Category:
- How they define their category
- Categories they claim (G2, Capterra listings)
- Adjacent categories mentioned

Competitive Claims:
- Direct competitor comparisons
- "Alternative to" positioning
- Differentiation language
```

#### Step 4.2: Positioning Dimensions

Map competitors on key positioning dimensions:

| Dimension | Low End | High End | Signals |
|-----------|---------|----------|---------|
| **Market Segment** | SMB | Enterprise | Pricing, logos, messaging |
| **Solution Scope** | Point Solution | Platform | Feature breadth, integrations |
| **Specialization** | Horizontal | Vertical | Industry-specific content |
| **Innovation Stance** | Established/Reliable | Cutting-edge/Modern | Tech messaging, design |
| **Service Model** | Self-serve | High-touch | CTA buttons, support tiers |
| **Price Position** | Budget/Value | Premium | Pricing, brand signals |

#### Step 4.3: Market Map Construction

**Output Template - Market Positioning Map:**

```markdown
## Competitive Positioning Map

### Primary Positioning Claims

| Competitor | Primary Claim | Category | Target |
|------------|---------------|----------|--------|
| [Name] | "[Exact tagline]" | [Category] | [Audience] |
| [Name] | "[Exact tagline]" | [Category] | [Audience] |

### Positioning Matrix

```
                    ENTERPRISE
                        ↑
                        |
          [Competitor C]|  [Competitor A]
                        |
POINT ←-----------------+-----------------→ PLATFORM
SOLUTION                |                   SOLUTION
                        |
          [Competitor D]|  [Competitor B]
                        |
                        ↓
                       SMB
```

### Positioning Gap Analysis

**Underserved Positions:**
1. [Gap 1] - [Rationale]
2. [Gap 2] - [Rationale]

**Crowded Positions:**
1. [Position] - [Competitors competing here]

### Differentiation Opportunities
1. [Opportunity] - Based on [evidence]
2. [Opportunity] - Based on [evidence]
```

---

### Phase 5: Market Sizing & Trends

**Objective:** Gather market size, growth rates, and trend data.

#### Step 5.1: Market Size Research

**Search patterns:**

```
SEARCH: "[Market category]" market size [current year]
SEARCH: "[Market category]" TAM SAM SOM
SEARCH: "[Market category]" market forecast
SEARCH: "[Market category]" industry report
SEARCH: "[Market category]" gartner OR forrester OR IDC
```

**Data points to capture:**

- Total Addressable Market (TAM)
- Serviceable Addressable Market (SAM)
- Market growth rate (CAGR)
- Regional breakdowns
- Segment breakdowns (by company size, industry)

#### Step 5.2: Trend Analysis

**Sources:**

```
SEARCH: "[Industry]" trends [current year]
SEARCH: "[Industry]" predictions [next year]
SEARCH: "[Industry]" challenges survey
SEARCH: "[Market category]" "state of" report
```

**Trends to track:**

| Trend Category | Questions to Answer |
|----------------|---------------------|
| **Technology** | What tech shifts are affecting the market? |
| **Buyer Behavior** | How are buying patterns changing? |
| **Regulatory** | What regulations are emerging? |
| **Economic** | What macro factors are at play? |
| **Competitive** | What consolidation/new entrants are happening? |

---

## Output Templates

### Complete Market Intelligence Report

```markdown
# [Market/Industry] Market Intelligence Report

**Report Date:** [Date]
**Prepared For:** [Project/Purpose]
**Analyst:** [Name/AI]

---

## Executive Summary

[3-5 bullet points with key findings]

---

## 1. Market Overview

### Market Definition
[How the market/category is defined]

### Market Size
- **TAM:** $X billion ([Year])
- **Growth Rate:** X% CAGR
- **Key Segments:** [List]

### Key Trends
1. [Trend 1]
2. [Trend 2]
3. [Trend 3]

---

## 2. Competitive Landscape

### Key Players
[List of competitors analyzed]

### Market Share (if available)
| Competitor | Est. Share | Notes |
|------------|------------|-------|

### Positioning Map
[Include positioning matrix]

---

## 3. Pricing Intelligence

### Pricing Model Comparison
[Summary table of pricing models]

### Price Benchmarks
| Segment | Low | Mid | High |
|---------|-----|-----|------|
| SMB | $X | $X | $X |
| Mid-market | $X | $X | $X |
| Enterprise | $X | $X | $X |

### Pricing Trends
[Any observed pricing trends]

---

## 4. Feature Landscape

### Feature Comparison Matrix
[Include feature matrix]

### Feature Gaps & Opportunities
1. [Gap/Opportunity 1]
2. [Gap/Opportunity 2]

### Table Stakes Features
[Features every competitor has]

### Differentiating Features
[Features that vary significantly]

---

## 5. Contract & Commercial Terms

### Standard Terms Comparison
[Summary of contract terms across competitors]

### Negotiation Leverage Points
1. [Leverage point 1]
2. [Leverage point 2]

---

## 6. Strategic Implications

### Opportunities
1. [Opportunity 1]
2. [Opportunity 2]

### Threats
1. [Threat 1]
2. [Threat 2]

### Recommendations
1. [Recommendation 1]
2. [Recommendation 2]

---

## Appendix: Detailed Competitor Profiles

### [Competitor 1]
[Detailed profile]

### [Competitor 2]
[Detailed profile]

---

## Sources

| Type | Source | URL | Date Accessed |
|------|--------|-----|---------------|
| Pricing | [Company] pricing page | [URL] | [Date] |
| Features | [Company] features page | [URL] | [Date] |
| Reviews | G2 | [URL] | [Date] |
| Report | [Analyst firm] | [URL] | [Date] |
```

---

## Competitive Battle Card Template

```markdown
# [Competitor Name] Battle Card

**Last Updated:** [Date]
**Confidence Level:** [High/Medium/Low]

---

## Quick Facts

| Attribute | Value |
|-----------|-------|
| **Founded** | [Year] |
| **HQ** | [Location] |
| **Employees** | [Count/range] |
| **Customers** | [Count/range] |
| **Funding** | [Amount/stage] |
| **Target Market** | [Description] |

---

## Positioning

**Their Pitch:** "[Exact tagline/value prop]"

**Target Buyer:** [Description]

**Key Differentiators They Claim:**
1. [Claim 1]
2. [Claim 2]
3. [Claim 3]

---

## Pricing

**Model:** [Description]

| Tier | Price | Key Features |
|------|-------|--------------|
| [Name] | $X | [Features] |
| [Name] | $X | [Features] |

**Win Insight:** [How to compete on price]

---

## Strengths

1. **[Strength 1]** - [Evidence]
2. **[Strength 2]** - [Evidence]
3. **[Strength 3]** - [Evidence]

---

## Weaknesses

1. **[Weakness 1]** - [Evidence/source]
2. **[Weakness 2]** - [Evidence/source]
3. **[Weakness 3]** - [Evidence/source]

---

## Feature Comparison

| Feature | Them | Us | Talking Point |
|---------|------|-------|---------------|
| [Feature] | ✓/✗ | ✓/✗ | [What to say] |
| [Feature] | ✓/✗ | ✓/✗ | [What to say] |

---

## Win/Loss Intelligence

**When We Win:**
- [Scenario 1]
- [Scenario 2]

**When We Lose:**
- [Scenario 1]
- [Scenario 2]

---

## Objection Handling

**"They have [feature] and you don't"**
> [Response]

**"They're cheaper"**
> [Response]

**"They're the market leader"**
> [Response]

---

## Landmines to Set

Questions to ask prospects that highlight our strengths:
1. "[Question 1]"
2. "[Question 2]"
3. "[Question 3]"

---

## Sources

- [Source 1 with URL]
- [Source 2 with URL]
```

---

## Search Patterns Reference

### Pricing Intelligence

```
"[Company]" pricing
"[Company]" cost
"[Company]" "per user" OR "per month"
"[Company]" pricing site:g2.com
"[Company]" pricing site:capterra.com
"[Company]" pricing review
"[Company]" "too expensive" OR "good value"
```

### Feature Intelligence

```
"[Company]" features
"[Company]" capabilities
"[Company]" integrations
"[Company]" API documentation
site:[company.com] features
site:[company.com] integrations
"[Company]" "[specific feature]"
```

### Contract Intelligence

```
"[Company]" contract terms
"[Company]" "terms of service"
"[Company]" "master service agreement"
"[Company]" cancellation
"[Company]" "annual contract"
"[Company]" "locked in" site:reddit.com
```

### Market Intelligence

```
"[Market category]" market size [year]
"[Market category]" industry report
"[Market category]" TAM
"[Market category]" competitive landscape
"[Market category]" trends [year]
"[Market category]" gartner magic quadrant
"[Market category]" forrester wave
```

### Review Intelligence

```
"[Company]" site:g2.com
"[Company]" site:capterra.com
"[Company]" site:trustradius.com
"[Company]" reviews
"[Company]" complaints
"[Company]" vs "[Competitor]"
```

---

## Quality Assurance Checklist

Before finalizing market intelligence:

### Pricing Intelligence
- [ ] Pricing model documented for all competitors
- [ ] Prices normalized to comparable metrics
- [ ] Sources cited for all price points
- [ ] Confidence level noted (direct vs. inferred)
- [ ] Date of data capture recorded

### Feature Comparison
- [ ] Feature taxonomy established
- [ ] All competitors evaluated against same criteria
- [ ] Tier availability noted (not just yes/no)
- [ ] Unique/differentiating features flagged
- [ ] Source URLs for all claims

### Contract Terms
- [ ] Key terms documented for each competitor
- [ ] SLA terms captured where available
- [ ] Hidden fees/costs identified
- [ ] Data portability terms noted

### Market Positioning
- [ ] Exact positioning language captured
- [ ] Target audience documented
- [ ] Positioning dimensions scored
- [ ] Market map created
- [ ] Whitespace opportunities identified

### Overall
- [ ] All sources documented with URLs
- [ ] Data freshness noted
- [ ] Confidence levels assigned
- [ ] Gaps in intelligence flagged

---

## Common Pitfalls to Avoid

1. **Don't assume pricing is current** - Always note the date; pricing changes frequently
2. **Don't conflate list price with street price** - Enterprise deals often have 20-40% discounts
3. **Don't ignore regional pricing** - Some competitors price differently by geography
4. **Don't miss tier-specific features** - A "yes" on a feature may only apply to top tiers
5. **Don't rely solely on marketing claims** - Validate with reviews and documentation
6. **Don't ignore negative signals** - Complaints in reviews are valuable intelligence
7. **Don't assume static market** - Competitors pivot; track changes over time

---

## Integration with Other Skills

This skill's outputs feed directly into:

- **website-analyzer.md**: Use for deep-dive on individual competitor websites
- **persona-research.md**: Combine with buyer pain points for positioning
- **campaign-planning.md**: Use pricing intelligence to inform competitive messaging
- **battle-cards**: Generate from competitor profiles in this intelligence

---

## Regional Considerations: Canada

When gathering market intelligence for Canadian markets:

### Canadian-Specific Sources
- **Industry Associations:** MCAC, HRAI, provincial HVAC/mechanical associations
- **Trade Publications:** Canadian Contractor, HPAC Magazine, Plumbing & HVAC
- **Government Data:** Statistics Canada, provincial business registries
- **Review Sites:** May have Canadian-specific filters

### Pricing Considerations
- **Currency:** Always note CAD vs USD pricing
- **Regional Pricing:** Some vendors price differently for Canada
- **Tax Implications:** Provincial sales taxes vary

### Regulatory Factors
- **Provincial Licensing:** Trade licensing varies by province
- **Data Residency:** Some buyers require Canadian data hosting
- **Bilingual Requirements:** Quebec may require French support

### Search Patterns for Canadian Market
```
"[Category]" Canada market size
"[Category]" Canadian contractors
"[Competitor]" Canada pricing
"[Competitor]" Canadian customers
site:canada.constructconnect.com "[Category]"
```

---

## Version History

- **v1.0** - Initial methodology for competitive pricing, features, contracts, and positioning intelligence
