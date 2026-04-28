# apps/docs — instructions for Claude

This is the Astro marketing + docs site for flipagent. Before changing
any styles, components, or page structure, **read
[`STYLEGUIDE.md`](./STYLEGUIDE.md)** in this folder. It is the source
of truth for how the frontend is organized.

## Hard rules

- **Two CSS layers only**: `src/styles/global.css` for shared, sibling
  `Foo.css` next to `Foo.tsx` for one-off. No third layer, no inline
  `<style>` blocks for component styling.
- **Never duplicate a class** across files. If reused, lift to global.
- **Never reproduce another site's copy verbatim.** Match patterns,
  write our own words. No false metric claims.
- **Two-color headlines only**: one phrase wrapped in `<span class="accent">`.
- **Section number format is fixed**: `[NN]  LABEL` mono at the left
  gutter, with `[NN]` brand-orange (brackets are CSS pseudo-elements
  on `.num`, not in the HTML). No slash, dot, rule, or total counter.
- **Edge-flush panels never have left/right borders** — the
  page-frame's vertical lines own those.

## When you add a new section / component

1. Follow the section skeleton in `STYLEGUIDE.md` §5.
2. If it's a React component, create `Foo.tsx` + `Foo.css` and
   `import "./Foo.css"` at the top.
3. If it's Astro markup, import its CSS at the top of the page that
   uses it.
4. Run `npx astro build` from `apps/docs/` before reporting done —
   markup errors can fail silently in dev.

## When you change copy

Headline framing is `<black framing> <accent phrase> <black framing>`.
Pick one phrase per headline as the orange accent — never two, never
the whole sentence.

The footer must always carry `NOT AFFILIATED WITH EBAY INC.` on
every page.

## When you change CSS

- Reference design tokens (`var(--text-2)`, `var(--border-faint)`),
  never hardcoded hex.
- Match the typography scale in `STYLEGUIDE.md` §4. New sizes need
  a justification + an entry in that table.
- Solid `1px var(--border-faint)` for cell dividers, never dashed.
- Looping animations require a `prefers-reduced-motion: reduce`
  override.

## Repo-wide conventions

The root `CLAUDE.md` covers TypeScript, packages, eBay ToS hygiene,
and deploy. Both apply.
