# flipagent.dev frontend styleguide

The marketing + docs site is an Astro app with React islands, Tailwind v4,
and motion/react animations. This doc captures the rules so any new
component / section stays consistent.

## 1. CSS architecture

Two layers, no third:

| Layer                                           | What lives here                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/styles/global.css`                         | Design tokens, base reset, typography, layout shell, shared chrome, primitives, utilities |
| `src/components/Foo.css` (sibling of `Foo.tsx`) | Anything used in exactly one component                                                    |

Decision rule: **if a class name is used in 2+ places, it belongs in
`global.css`. If only one component uses it, it lives in that component's
sibling `.css` file**, imported at the top of the component.

```tsx
// Foo.tsx
import './Foo.css';
```

For Astro markup blocks that haven't been extracted to a component yet,
import the CSS at the top of the page:

```astro
---
import "../components/TrustStrip.css";
---
```

Never duplicate a class across files. Either lift to global, or rename.

## 2. What `global.css` owns

These categories must stay in `global.css` because they're foundational
or reused on every page:

- **Design tokens** — `@theme {}` and `:root {}` variables
- **Reset & base typography** — `*`, `body`, `a`, `p`, `h1-h4`, `code`,
  `ul/ol`, `img/svg`, `::selection`
- **Layout shell** — `.cmw`, `.cmw-bordered`, `.page-frame`, `.section`,
  `.section.lined`, `.section-num`, `.section-head`, `.curve`
- **Site chrome** — `header.site` + nav, `footer.site` + cols, `.banner`
- **Common primitives** — `.btn` (36px) / `.btn.sm` (32px),
  `.btn.heat`, `.btn.block`, `.icon-btn`, `.eyebrow-pill`, `.head-chip`
- **Hero base** — `.hero`, `.hero h1`, `.hero p.lead`, `.cta-row`
- **Inline utilities** — `.accent` (brand-orange highlight in prose),
  `.fc-thinking` (shimmer), `.fc-pulse` (pulse marker)
- **Inline `code`** styling

If you find yourself adding a new shared utility, put it in `global.css`
under the right section header comment and document it here.

## 3. Design tokens

All colors, fonts, radii, and the cmw container width come from
`@theme {}` (Tailwind v4) and `:root {}`. Never hardcode hex values
inside component CSS — reference the variable.

| Token                                             | Value                             | Use                                           |
| ------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| `--bg` / `--surface`                              | `#ffffff`                         | Page bg, card bg                              |
| `--bg-soft` / `--surface-2`                       | `#fafafa`                         | Soft backgrounds, hover bg                    |
| `--surface-3`                                     | `#f5f5f5`                         | Inline `code` bg                              |
| `--text`                                          | `#0a0a0a`                         | Body text, headlines                          |
| `--text-2`                                        | `#525252`                         | Secondary text, lead p                        |
| `--text-3`                                        | `#737373`                         | Tertiary, captions                            |
| `--text-4`                                        | `#a3a3a3`                         | Disabled, deepest gray                        |
| `--border` / `--border-faint` / `--border-strong` | `#e5e5e5` / `#ececec` / `#d4d4d4` | Most lines use `--border-faint`               |
| `--brand`                                         | `#ff4c00`                         | Single brand color, used sparingly            |
| `--brand-soft`                                    | `#fff1e8`                         | Brand-tinted hover bg                         |
| `--code-bg`                                       | `#f7f7f6`                         | Code panel outer background                   |
| `--syntax-key`                                    | `#5b3da7`                         | Syntax token color (keywords, function names) |
| `--success` / `--danger`                          | `#15803d` / `#b91c1c`             | Status colors                                 |
| `--cmw`                                           | `1144px`                          | Page-frame max width                          |
| `--sans`                                          | Geist                             | Body sans                                     |
| `--mono`                                          | Geist Mono                        | Mono (numbers, eyebrows, code)                |

## 4. Typography scale

Reference from observed Firecrawl-equivalent pages, applied in
`global.css`:

| Element               | Size          | Weight | Line-height | Letter-spacing        |
| --------------------- | ------------- | ------ | ----------- | --------------------- |
| `.hero h1`            | clamp 40–60px | 500    | 1.067       | -0.005em              |
| `.hero p.lead`        | 16px          | 400    | 1.5         | normal                |
| `.section-head h2`    | clamp 32–46px | 500    | 1.1         | -0.01em               |
| `.section-head p`     | 16px          | 400    | 1.55        | normal                |
| `.head-chip` (kicker) | 12px          | 400    | n/a         | -0.005em title-case   |
| `.main-feature h3`    | 20px          | 500    | 1.4         | -0.005em              |
| eyebrow / mono labels | 10.5–11px     | 500    | n/a         | 0.06–0.18em uppercase |
| `.btn`                | 13.5px        | 500    | n/a         | -0.005em              |
| Inline `code`         | 13px          | normal | 1.65        | mono                  |

Don't deviate from this scale without a reason. If you need a new size,
add it to a section here with the rationale.

## 5. Section structure

Every numbered section on the landing follows the same skeleton:

```astro
<section class="section lined">
  <span class="section-num"><span class="num">01</span><span class="label">HOW IT WORKS</span></span>
  <div class="cmw cmw-bordered">
    <Reveal client:visible>
      <div class="section-head">
        <HeadChip label="End-to-end loop" />
        <h2>The whole loop, <span class="accent">one agent</span>.</h2>
        <p>One-line subhead.</p>
      </div>
    </Reveal>
    <Reveal client:visible delay={0.05}>
      <Component />
    </Reveal>
  </div>
</section>
```

Rules:

- Section number annotation is a minimal mono mark at the left
  gutter: `[NN]  LABEL`. Number is brand-orange (with bracket
  delimiters added via CSS `::before/::after` pseudo-elements on
  `.num`, not in the HTML), label is gray, both at 11px mono.
  No slash, dot, rule, or total counter — the whole-page count
  lives in the eyebrow nav, not on every section.
- Headlines are two-color: the framing words in `--text`, the
  emphasis phrase wrapped in `<span class="accent">` (brand-orange).
- One short subhead p, max 12 words.
- Above every h2 sits a `<HeadChip label="…" />` — short title-case
  kicker (2–3 words). No long ·-separated chains; if the section has
  a list of items they go in the body, not the chip label.
- Every section head is centered. Don't introduce alignment variation —
  consistency reads better than rhythm here.
- Wrap everything content-y in `<Reveal>` for stagger reveal on scroll.

## 6. Edge-flush panels

Internal grid panels (Pipeline, StatRow, PricingTable, MainFeatures,
Trust strip, etc.) extend to the page-frame's vertical lines using
`margin: 0 -32px` (and `-16px` under 720px). They have **no
left/right border** — the page-frame already provides that line.
Only top + bottom borders for visual separation.

```css
.foo {
  margin: 0 -32px;
  border-top: 1px solid var(--border-faint);
  border-bottom: 1px solid var(--border-faint);
  /* never set border-left or border-right */
}

@media (max-width: 720px) {
  .foo {
    margin: 0 -16px;
  }
}
```

Internal cell dividers between cells are solid `1px var(--border-faint)`,
**never dashed**.

## 7. Components

### When to use Astro vs React

- **Astro** — static markup, no client state. Section headers, simple
  cells, anything purely declarative.
- **React (`.tsx`) + `client:load` or `client:visible`** — needs
  state (tabs, accordions, animations driven by user input), or motion
  variants beyond CSS.

### Component file layout

```
src/components/Foo.tsx        # behavior + JSX
src/components/Foo.css        # styles, imported at top of Foo.tsx
src/components/Bar.astro      # static markup
src/components/Bar.css        # if used only by Bar (rare)
```

`import "./Foo.css"` goes at the top of the component file, after
React/motion imports, before any local helper definitions.

### Inside a component you may use either

- **Shared global classes** (`.btn`, `.btn.heat`, `.fc-thinking`,
  `.accent`) for any styling that's already named.
- **Tailwind utility classes** for one-off internal layout
  (`flex items-center gap-2 px-3 py-1.5`) — fine for ChatDemo-style
  inline composition.
- **Component-scoped CSS classes** (`.pipe-step`, `.codepanel-tab`)
  when the same custom-named element appears in multiple places
  inside the component.

The mix is fine. Don't migrate one style strategy to another for
its own sake.

## 8. Animation conventions

- Use `motion/react` for component-level entrance/spring animations.
- Use CSS `@keyframes` + `transition` for continuous loops (marquee
  scroll, pulse) and hover effects.
- All looping animations must respect `prefers-reduced-motion: reduce`.

```css
@media (prefers-reduced-motion: reduce) {
  .my-marquee-track {
    animation: none;
  }
}
```

## 9. Copy & IP

- **Always write our own copy.** Never reproduce another site's
  exact headlines, taglines, or numerical claims (e.g. don't say
  "trusted by 80,000+" — that's both a false claim for us and not
  ours to use).
- **Layout patterns are not copyrightable.** It's fine to study and
  match the structural feel of reference sites; just don't copy
  their text or their compiled CSS verbatim.
- **No false metrics.** If we don't have N customers, don't claim it.
  Pick a truthful framing or leave the number out.
- **Two-color headline pattern**: `<text in normal color> <span class="accent">key phrase</span> <rest in normal color>`. Pick one phrase
  per headline as the accent — never two, never the whole thing.
- **eBay ToS hygiene**: never strip listings of `itemWebUrl`, never
  imply affiliation. The non-affiliation disclaimer lives in
  `/legal/terms` .

## 10. Adding a new section

1. Add the `<section class="section lined">` block to the page using
   the skeleton in §5.
2. Renumber the `NN` of every later section so the sequence stays
   contiguous.
3. If the section needs a new visual block:
   - Astro markup → import its CSS at the top of the page.
   - React component → put `Foo.tsx` and `Foo.css` side-by-side in
     `src/components/`, import the CSS in the `.tsx`.
4. Keep panel borders edge-flush per §6.
5. Run `npx astro build` before committing — broken markup fails
   silently in dev sometimes.

## 11. Adding a new design token

Touch `global.css` only:

1. Add to both `@theme {}` (so Tailwind classes generate) and
   `:root {}` (so `var(--…)` works in plain CSS).
2. Document in §3 of this file.
3. Don't introduce a new color outside the existing scale unless
   it's a status color or a one-off needed by the brand.

---

When in doubt: `global.css` for shared, sibling `.css` for one-off,
run the build before committing, and never reproduce someone else's
copy.
