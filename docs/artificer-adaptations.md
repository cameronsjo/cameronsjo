# Artificer adaptations

How this project bends the Artificer design system, and why. Each entry mirrors a
feedback issue filed upstream.

## 2026-06-05 — Whimsy ported to a JS-stripped embedded SVG

**Surface:** document (profile stats card, `assets/stats.template.svg`) rendered on github.com.

**Pivot:** Applied `.whimsy--brand` to the `cameronsjo` wordmark, but GitHub serves
README SVGs through a camo `<img>` proxy that strips `<script>`. So neither
`Whimsy.js` (hydrate/observe/celebrate) nor the CSS `background-clip: text`
technique (an HTML-element trick — inert on SVG `<text>`) ports. The flow was
rebuilt from SVG primitives.

| type | token/rule | what we did + why | upstream? | lane |
|---|---|---|---|---|
| gap | `Whimsy.js`, `.whimsy` `background-clip:text` | Reimplemented the flow as `@keyframes` animating `<linearGradient>` `<stop>` `stop-color` through the brand sequence (gold→rose→purple→steel→green→gold), phase-shifted across 5 stops via negative `animation-delay`; no JS, no `background-clip`. | yes | 3 |
| misfit | reduced-motion (JS-toggled in canonical Whimsy) | Gated the flow with `@media (prefers-reduced-motion: reduce){ animation:none }` *inside* the SVG `<style>`, static stop-colors as the frozen burnished fallback. The media query **does** evaluate in camo img-SVG (same as `prefers-color-scheme`), so non-negotiable #7 holds with zero JS. | yes | 3 |
| override | `--brand-purple` `#5a3a9a`, `--success` `#4a8a5e` | Swapped `#5a3a9a`→`#b095e0` (brand-purple-bright) and lightened `#4a8a5e`→`#6aa67d`; the documented brand stops assume text where lighter stops co-exist, but the darkest stops fall below legible contrast for a 15px wordmark on the `#292c33` card. | maybe | 1 |

**Don't upstream:** the 5-stop / negative-delay phase arithmetic and the card
geometry (640×200, 640×244 since 2026-09-23) (product-specific); the `#6aa67d` one-off lightening unless a general
dark-surface whimsy variant is wanted.

## 2026-09-23 — Weekly bar strip and Deco ornament in the stats card

**Surface:** document (profile stats card, `assets/stats.template.svg`) rendered on github.com.

**Pivot:** Added a weekly-contributions bar strip and Deco ornament to the
camo-proxied `<img>` SVG. Upstream: cameronsjo/artificer-design-system#495.

| type | token/rule | what we did + why | upstream? | lane |
|---|---|---|---|---|
| gap | none existed (mini bar chart for img SVG) | 53 generated `<rect>` bars with a square-root height scale, because weekly totals span 0–1933 and a linear scale drew quiet weeks at 1–3px. No axis, so it shows shape only. | maybe | 3 |
| extension | motion, reduced-motion | One-shot rise (`transform-box: fill-box` + `scaleY`, 12ms per-bar `animation-delay`), turned off in the same `prefers-reduced-motion` block as the whimsy wordmark. | yes | 3 |
| extension | `--accent`, `--steel-fill` | Current partial week in gold; other bars `#5a7a8a`. | no | 3 |
| extension | none existed (Deco rule) | Double rule (`--border` plus gold inset at 0.18) and a gold header rule (0.35) with a center diamond. | maybe | 3 |
| extension | `--accent-bright` → `--accent-fill` | Vertical gold gradient on the hero number. | maybe | 3 |
| confusion | SVG class vs attribute | A `.rule` class `stroke-opacity: 0.35` overrode an element's `stroke-opacity="0.18"` attribute, because CSS outranks presentation attributes. Fixed with a separate `.rule-faint` class. | yes | 3 |

**Retire when:** Artificer ships an img-embedded SVG recipe (token hexes,
reduced motion in `<style>`, a mini-chart pattern).
