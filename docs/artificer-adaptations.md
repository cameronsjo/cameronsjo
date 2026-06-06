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

**Don't upstream:** the 5-stop / negative-delay phase arithmetic and the 640×200
card geometry (product-specific); the `#6aa67d` one-off lightening unless a general
dark-surface whimsy variant is wanted.
