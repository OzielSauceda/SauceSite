# Project UI Rules

These rules apply to every visual, layout, and component change in this site.

## Design Direction

- The site should feel dark, technical, refined, and personal.
- Avoid generic SaaS, startup landing-page, or template portfolio patterns.
- The code/glyph portrait and the name are the hero anchors; backgrounds and effects must support them, not compete with them.
- Prefer quiet technical atmosphere over decorative noise.
- Use animation as polish and communication, not constant distraction.
- Keep the interface sharp, intentional, and readable.

## Responsive First

Every new section, component, animation, and layout change must be designed and checked across phone, tablet, laptop, desktop, and large desktop viewports.

Required viewport checks:

- `390x844` - iPhone standard
- `430x932` - large iPhone
- `412x915` - common Android phone
- `768x1024` - tablet portrait
- `1024x768` - tablet landscape
- `1366x768` - common laptop
- `1440x900` - MacBook-style laptop
- `1920x1080` - desktop monitor
- `2560x1440` - large desktop monitor

Before marking UI work complete, verify:

- no horizontal overflow
- no important content clipped by viewport bounds
- name/headings remain visible and readable
- body copy remains readable with sane line length
- portrait/media remain visible, crisp, and intentionally framed
- nav controls do not cover important content
- touch targets are usable on phone/tablet
- animations do not create layout jumps or blurry canvas rendering
- production build passes

## Layout Rules

- Prefer mobile-first responsive layout over fixed artboard assumptions.
- Use explicit breakpoint behavior when a composition is art-directed.
- Avoid `whitespace-nowrap` on long text unless there is a tested fallback for narrow screens.
- Avoid fixed viewport-height sections for content-heavy layouts unless overflow behavior is intentionally handled.
- Avoid absolute positioning for primary readable content on mobile unless the viewport matrix has been checked.
- Cap large-screen scaling so text and media do not grow endlessly on 1920px+ and 2560px+ screens.
- Treat tablet sizes as their own layout problem; do not assume phone or desktop rules will work at `768x1024` or `1024x768`.

## Hero Portrait Rules

- Preserve the code/glyph portrait's crispness safeguards.
- Do not put the portrait canvas inside transform/scale wrappers.
- Do not add CSS blur, filter, or backdrop-filter to the portrait canvas or its parents.
- Do not reintroduce `ctx.shadowBlur`.
- Keep canvas CSS sizing aligned to integer pixels and DPR-aware backing buffers.
- Use opacity-only entry animation for the portrait canvas wrapper.

## Preserve Existing Wins

- Do not retune the code/glyph portrait unless explicitly asked.
- Do not redesign the approved hero composition while working on unrelated sections.
- Do not undo the current responsive baseline unless replacing it with a verified improvement.
- Do not replace working custom visual systems with generic components.
- Treat prior approved states as constraints, not suggestions.

## Accessibility

- Preserve semantic heading order and meaningful landmarks.
- Keep body text contrast readable on all backgrounds.
- Ensure interactive elements have accessible names.
- Keep keyboard focus states visible.
- Use real buttons/links for interactive controls.
- Respect reduced-motion where practical, especially for canvas, WebGL, and repeated animation.
- Do not rely on color alone to communicate important state.

## Performance

- Avoid expensive per-frame work unless it is visually necessary.
- Canvas and WebGL animations should pause, skip, or reduce work when hidden.
- Do not add heavy dependencies without a strong reason.
- Prefer CSS/Tailwind and existing Motion patterns before introducing new animation libraries.
- Avoid unnecessary image, font, or model payloads.
- Run a production build after meaningful UI changes.

## Content Standards

- Do not use lorem ipsum.
- If final copy is unknown, write realistic draft copy and make it easy to replace.
- Keep copy concise, specific, and portfolio-appropriate.
- Avoid generic claims like "innovative solutions" unless the surrounding content proves them.
- Keep section labels, nav labels, and headings consistent.

## Visual QA

- Build success is not enough for UI work.
- Inspect the actual rendered page after visual changes.
- Check for text overlap, clipping, awkward empty space, unreadable contrast, and broken hierarchy.
- Verify hover/focus/open/closed states for interactive elements.
- Verify mobile menu behavior when relevant.
- Compare new work against the existing art direction before calling it complete.

## Scope Discipline

- Keep changes tightly scoped to the requested area.
- Do not refactor unrelated files while implementing visual changes.
- Match existing React, Tailwind, and Motion patterns.
- Prefer small coherent changes over broad rewrites.
- If a broader rewrite is necessary, state why and identify the blast radius.

## Visual Change Process

When making a visual change:

1. Identify which breakpoints it affects.
2. Implement the smallest coherent change.
3. Run `npm run build`.
4. Check the viewport matrix above.
5. Report any viewport that still needs attention.

Do not continue adding new design layers on top of known responsive breakage. Fix structural responsive issues before background, typography, or animation polish.
