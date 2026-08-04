# Graph Report - .  (2026-07-06)

## Corpus Check
- 118 files · ~57,440 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 420 nodes · 835 edges · 30 communities (15 shown, 15 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.83)
- Token cost: 200,511 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Constitution & Principles|Constitution & Principles]]
- [[_COMMUNITY_Admin Panel UI|Admin Panel UI]]
- [[_COMMUNITY_AI Generator Page|AI Generator Page]]
- [[_COMMUNITY_Auth & Admin APIs|Auth & Admin APIs]]
- [[_COMMUNITY_Architecture Studio Canvas|Architecture Studio Canvas]]
- [[_COMMUNITY_Dependencies & Packaging|Dependencies & Packaging]]
- [[_COMMUNITY_Provider Connections & Security|Provider Connections & Security]]
- [[_COMMUNITY_Dashboard & Connections UI|Dashboard & Connections UI]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Spec Kit Commands|Spec Kit Commands]]
- [[_COMMUNITY_Spec Kit Shell Scripts|Spec Kit Shell Scripts]]
- [[_COMMUNITY_Database Seeding|Database Seeding]]
- [[_COMMUNITY_Feature Scaffolding Script|Feature Scaffolding Script]]
- [[_COMMUNITY_Root App Layout|Root App Layout]]
- [[_COMMUNITY_MCP Server Config|MCP Server Config]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_Next Env Types|Next Env Types]]
- [[_COMMUNITY_PostCSS Config|PostCSS Config]]
- [[_COMMUNITY_Frontend Design Skill|Frontend Design Skill]]
- [[_COMMUNITY_Next.js Agent Rules|Next.js Agent Rules]]
- [[_COMMUNITY_Iterative Chat Requirement|Iterative Chat Requirement]]
- [[_COMMUNITY_Accessibility Requirement|Accessibility Requirement]]
- [[_COMMUNITY_Onboarding Speed Criterion|Onboarding Speed Criterion]]
- [[_COMMUNITY_Design Speed Criterion|Design Speed Criterion]]
- [[_COMMUNITY_Scale Criterion|Scale Criterion]]
- [[_COMMUNITY_Satisfaction Criterion|Satisfaction Criterion]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 39 edges
2. `connectDB()` - 19 edges
3. `compilerOptions` - 16 edges
4. `Button()` - 15 edges
5. `formatUSD()` - 12 edges
6. `Role` - 12 edges
7. `hashPassword()` - 11 edges
8. `getSession()` - 11 edges
9. `MVP Task List` - 11 edges
10. `serviceById()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Plugin-Based Provider Model (PRD Principle)` --semantically_similar_to--> `Provider Plugin Model (registry + adapters)`  [INFERRED] [semantically similar]
  prd.md → specs/001-mvp-baseline/data-model.md
- `Official AWS Cost MCP` --semantically_similar_to--> `AWS Pricing API`  [INFERRED] [semantically similar]
  specs/001-mvp-baseline/spec.md → prd.md
- `FR-025: All provider access through backend` --conceptually_related_to--> `Principle III: API-First & Secure by Default`  [INFERRED]
  specs/001-mvp-baseline/spec.md → .specify/memory/constitution.md
- `Principle III: API-First & Secure by Default` --rationale_for--> `SC-009: 100% authorization enforced server-side`  [INFERRED]
  .specify/memory/constitution.md → specs/001-mvp-baseline/spec.md
- `Principle IV: Spec-Driven Delivery` --rationale_for--> `MVP Feature Specification`  [INFERRED]
  .specify/memory/constitution.md → specs/001-mvp-baseline/spec.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Chat-to-architecture generation flow** — specs_001_mvp_baseline_spec_us2_generation, specs_001_mvp_baseline_spec_fr_014, prd_aws_labs_mcp, prd_mongodb_mcp_server, specs_001_mvp_baseline_spec_aws_cost_mcp, specs_001_mvp_baseline_data_model_aiconversation, specs_001_mvp_baseline_data_model_architecture [INFERRED 0.85]
- **Provider plugin model (registry + adapters)** — specs_001_mvp_baseline_data_model_provider_plugin_model, _specify_memory_constitution_plugin_based_extensible_providers, specs_001_mvp_baseline_research_r7_provider_plugin_model [INFERRED 0.85]
- **Hierarchical RBAC role separation** — specs_001_mvp_baseline_spec_role_super_admin, specs_001_mvp_baseline_spec_role_admin, specs_001_mvp_baseline_spec_role_user, specs_001_mvp_baseline_spec_fr_007, _specify_memory_constitution_api_first_secure_by_default [INFERRED 0.85]
- **Spec Kit core SDD lifecycle (specify -> plan -> tasks -> implement)** — claude_skills_speckit_specify_skill_speckit_specify, claude_skills_speckit_plan_skill_speckit_plan, claude_skills_speckit_tasks_skill_speckit_tasks, claude_skills_speckit_implement_skill_speckit_implement [EXTRACTED 0.75]
- **Templates kept in sync by the constitution command** — claude_skills_speckit_constitution_skill_speckit_constitution, specify_templates_plan_template_plan_template, specify_templates_spec_template_spec_template, specify_templates_tasks_template_tasks_template [EXTRACTED 0.75]
- **Spec Kit requirements-quality assurance commands** — claude_skills_speckit_clarify_skill_speckit_clarify, claude_skills_speckit_checklist_skill_speckit_checklist, claude_skills_speckit_analyze_skill_speckit_analyze [INFERRED 0.75]

## Communities (30 total, 15 thin omitted)

### Community 0 - "Constitution & Principles"
Cohesion: 0.06
Nodes (61): Cloud Architecture Studio AI Constitution, Principle I: Official Integrations First, Principle II: Plugin-Based, Extensible Providers, Principle IV: Spec-Driven Delivery, Principle V: Verify Before Done, AWS Labs MCP Server (Official), AWS Pricing API, Cloud Architecture Studio AI (Product) (+53 more)

### Community 1 - "Admin Panel UI"
Cohesion: 0.07
Nodes (37): AdminLayout(), CAPS, ROLE_ICON, RolesPage(), UsersPage(), active(), AdminShell(), NAV (+29 more)

### Community 2 - "AI Generator Page"
Cohesion: 0.08
Nodes (22): EXAMPLES, NewProjectPage(), ProviderToggle(), STEPS, ACCENTS, AppearanceSection(), SectionId, SECTIONS (+14 more)

### Community 3 - "Auth & Admin APIs"
Cohesion: 0.13
Nodes (33): AdminOverview(), POST(), POST(), POST(), GET(), POST(), POST(), DELETE() (+25 more)

### Community 4 - "Architecture Studio Canvas"
Cohesion: 0.13
Nodes (24): costFor(), makeNode(), nodeTypes, seedArchitecture(), SNode, StudioInner(), CanvasNode, Inspector() (+16 more)

### Community 5 - "Dependencies & Packaging"
Cohesion: 0.06
Nodes (30): dependencies, bcryptjs, class-variance-authority, clsx, jose, lucide-react, mongoose, next (+22 more)

### Community 6 - "Provider Connections & Security"
Cohesion: 0.10
Nodes (28): Principle III: API-First & Secure by Default, AWS IAM Identity Center (SSO), Contract: Provider Connections, Entity: Connection (AWS/Atlas), Entity: User, R4: AWS connection via IAM Identity Center, FR-001: Register standard-role account, FR-002: Email/password authentication + optional OAuth (+20 more)

### Community 7 - "Dashboard & Connections UI"
Cohesion: 0.15
Nodes (17): Dashboard(), stats, totalMonthly, totalServices, filters, ProjectsPage(), totalMonthly, PageHeader() (+9 more)

### Community 8 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 9 - "Spec Kit Commands"
Cohesion: 0.23
Nodes (16): speckit-analyze command, speckit-checklist command, speckit-clarify command, speckit-constitution command, speckit-converge command, speckit-implement command, speckit-plan command, speckit-specify command (+8 more)

### Community 10 - "Spec Kit Shell Scripts"
Cohesion: 0.22
Nodes (10): Find-SpecifyRoot(), Format-SpecKitCommand(), Get-CurrentBranch(), Get-FeaturePathsEnv(), Get-InvokeSeparator(), Get-Python3Command(), Get-RepoRoot(), Resolve-SpecifyInitDir() (+2 more)

### Community 11 - "Database Seeding"
Cohesion: 0.50
Nodes (3): __dirname, email, userSchema

## Knowledge Gaps
- **116 isolated node(s):** `npx`, `eslintConfig`, `nextConfig`, `name`, `version` (+111 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `AI Generator Page` to `Admin Panel UI`, `Architecture Studio Canvas`, `Dashboard & Connections UI`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `Button()` connect `AI Generator Page` to `Admin Panel UI`, `Architecture Studio Canvas`, `Dashboard & Connections UI`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `PageHeader()` connect `Dashboard & Connections UI` to `Admin Panel UI`, `AI Generator Page`, `Auth & Admin APIs`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `npx`, `eslintConfig`, `NOTE: This file should not be edited` to the rest of the system?**
  _118 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Constitution & Principles` be split into smaller, more focused modules?**
  _Cohesion score 0.05628415300546448 - nodes in this community are weakly interconnected._
- **Should `Admin Panel UI` be split into smaller, more focused modules?**
  _Cohesion score 0.06715063520871144 - nodes in this community are weakly interconnected._
- **Should `AI Generator Page` be split into smaller, more focused modules?**
  _Cohesion score 0.08244897959183674 - nodes in this community are weakly interconnected._