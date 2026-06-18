---
name: design
description: Repo-local design workflow for product, UI/UX, and frontend decision source of truth
---

# Design Skill

Use `$design` when product, UI/UX, frontend, visual identity, or design-system decisions need a durable source of truth in the repository. This skill discovers existing design context, interviews for missing product/design information, and writes a repo-local design brief under `.owx/specs/` so future UI/UX/frontend work is grounded, distinctive, and not improvised from generic defaults.

## Purpose

Make a repo-local design brief the source of truth and canonical design contract for the current repository:

`existing repo evidence -> missing-context interview -> create/refresh design brief -> use design brief for UI/UX/frontend decisions`.

This is the repo-local `DESIGN.md` source of truth workflow, even when the design brief is stored under `.owx/specs/` for the current task.

The output is not a pixel-matching loop and not a one-off visual critique. It is the maintained design brief/checklist that implementation, review, and future visual work should cite.

## Use when

- The user asks for design direction, UX guidance, frontend planning, visual identity, or design-system alignment.
- A repo needs a design brief before UI/frontend implementation begins.
- Existing UI/components/assets/screenshots need to be summarized into a reusable design source of truth.
- UI/UX/frontend decisions are ambiguous and should be resolved through product context, constraints, and documented principles.
- A feature needs a design brief created or refreshed before `$ralph`, a designer lane, or implementation work proceeds.
- New UI needs an aesthetic point of view, typography, palette, motion, or content voice that should be specific to the product rather than template-like.

## Do not use when

- The user provides or requests a visual reference/image/live URL and wants measured implementation until screenshots match. Use `$visual-ralph` for that visual-reference implementation loop.
- The task is pure backend/API/infrastructure work with no user-facing design consequence.
- The user only asks to compare screenshots or score visual fidelity. Use `$visual-ralph` and its built-in visual verdict flow.

## Relationship to `$visual-ralph`

`$design` owns the durable repo design source of truth: product goals, users, IA, visual language, components, accessibility, constraints, and open questions in a `.owx/specs/` design brief.

`$visual-ralph` owns implementation against an approved generated/static/live-URL visual reference, with screenshot capture, Visual Ralph verdict scoring, and pixel-diff evidence. `$visual-ralph` may read the design brief, and it may leave design-system artifacts behind, but it does not replace the `DESIGN.md` discovery/interview/refresh workflow.

If both are needed, run `$design` first to establish the design contract, then run `$visual-ralph` only after the visual reference/baseline is approved.

## Workflow

### 1. Discover local design evidence

Inspect the repository before writing guidance. Look for:

- Product specs, PRDs, issue notes, existing components, and screenshots.
- Existing UI source: routes, pages, layouts, components, stories, examples, demos, theme files, CSS variables, Tailwind/theme config, tokens, icons, and assets.
- Screenshots, mockups, brand files, logos, Figma/export notes, Storybook snapshots, Playwright screenshots, visual-regression baselines, or `.owx/artifacts/visual-ralph/*` references.
- Accessibility, responsive, i18n, content, and platform constraints already encoded in code or docs.

Record evidence with file paths. Distinguish observed facts from design inferences.

### 2. Ground the visual direction in the subject

Before choosing colors, type, layout, or motion, name the concrete product subject, audience, and page or workflow job. Derive visual choices from the subject's real materials, tools, vocabulary, data shapes, physical environment, domain conventions, and user pressures.

If repo evidence does not identify the subject clearly, make one explicit assumption and record it in the design brief. Do not let a vague brief collapse into generic SaaS, dashboard, portfolio, or landing-page defaults.

For frontend-heavy work, prepare a compact visual thesis:

- Palette: 4-6 named color tokens with hex values and a reason each belongs to this subject.
- Type: at least two roles, such as display, body, and utility/data, with a reason the pairing fits.
- Layout: the structural idea, including what information the structure encodes.
- Signature: one memorable element or interaction that embodies the subject.
- Risk: one intentional aesthetic risk and why it improves the product instead of decorating it.
- Template audit: which common AI/default look this direction might resemble, and what was changed to avoid that.

### 3. Interview only for missing context

Ask concise questions only when repo evidence cannot answer design-critical context. Prefer one focused round that closes the biggest gaps, such as:

- target users/personas and jobs to be done,
- product/business goals and non-goals,
- brand personality, forbidden aesthetics, and visual identity expectations,
- primary flows and information architecture,
- accessibility level, device/browser support, and implementation constraints,
- existing design assets or references the repo does not contain.

If the user wants autonomous progress or cannot answer, create `DESIGN.md` with explicit assumptions and open questions instead of blocking.

### 4. Create or refresh `DESIGN.md`

Use the structure below. Preserve useful existing content, remove contradictions, and mark unknowns as open questions. Keep it actionable for implementers and reviewers. The brief must make the intended visual direction falsifiable: a reviewer should be able to tell whether a later UI is specific to this product or has drifted back to a template.

#### Required design brief structure/checklist

```markdown
# Design

## Source of truth
- Status: Draft | Active | Needs refresh
- Last refreshed: YYYY-MM-DD
- Primary product surfaces:
- Evidence reviewed:

## Brand
- Personality:
- Trust signals:
- Avoid:

## Product goals
- Goals:
- Non-goals:
- Success signals:

## Personas and jobs
- Primary personas:
- User jobs:
- Key contexts of use:

## Information architecture
- Primary navigation:
- Core routes/screens:
- Content hierarchy:

## Design principles
- Principle 1:
- Principle 2:
- Tradeoffs:

## Visual language
- Subject anchor:
- Distinctive thesis:
- Color:
- Typography:
- Spacing/layout rhythm:
- Shape/radius/elevation:
- Motion:
- Imagery/iconography:
- Signature element:
- Template risks to avoid:

## Components
- Existing components to reuse:
- New/changed components:
- Variants and states:
- Token/component ownership:

## Accessibility
- Target standard:
- Keyboard/focus behavior:
- Contrast/readability:
- Screen-reader semantics:
- Reduced motion and sensory considerations:

## Responsive behavior
- Supported breakpoints/devices:
- Layout adaptations:
- Touch/hover differences:

## Interaction states
- Loading:
- Empty:
- Error:
- Success:
- Disabled:
- Offline/slow network, if applicable:

## Content voice
- Tone:
- Terminology:
- Microcopy rules:
- Empty/error/recovery copy rules:

## Implementation constraints
- Framework/styling system:
- Design-token constraints:
- Performance constraints:
- Compatibility constraints:
- Test/screenshot expectations:

## Open questions
- [ ] Question / owner / impact
```

### 5. Use `DESIGN.md` as the decision contract

For UI/UX/frontend work after the refresh:

- Cite the relevant `DESIGN.md` sections before making design choices.
- Prefer existing components, tokens, and documented constraints.
- If implementation reveals a design contradiction, update `DESIGN.md` or add an open question before proceeding.
- Do not introduce a new design-system layer when existing repo-native patterns can be extended.
- Before coding visual changes, run a two-pass design gate: draft the token/type/layout/signature plan, critique it against the product subject and template risks, then revise before implementation.
- Spend boldness in one place. Keep supporting surfaces disciplined so the signature element is memorable instead of noisy.
- Treat copy as interface design. Button labels, empty states, errors, and success messages should use the user's vocabulary, active verbs, and consistent action names.

### 6. Handoff to implementation or Visual Ralph when appropriate

- For normal frontend implementation, hand off with the relevant design brief sections, repo evidence, and acceptance criteria.
- For visual-reference/image/live-URL matching, hand off to `$visual-ralph` with the approved reference/baseline and note that the design brief is supporting context, not the visual verdict target.

## Completion checklist

Do not declare the design workflow complete until:

- Existing design assets/components/screenshots have been inspected or explicitly noted as absent.
- Missing product/design context has been answered, assumed, or listed in design brief open questions.
- The design brief exists under `.owx/specs/` and contains all required checklist sections.
- The design brief records subject anchor, distinctive thesis, signature element, and template risks to avoid for frontend-heavy work.
- UI/UX/frontend recommendations cite the design brief rather than relying on unstated preferences.
- A two-pass design gate has been applied before visual implementation recommendations or handoff.
- Any `$visual-ralph` handoff is clearly separated as visual implementation matching, not design-brief governance.

Task: {{ARGUMENTS}}
