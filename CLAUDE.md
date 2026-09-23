# cameronsjo profile

Self-healing GitHub profile README. A weekly Action regenerates the stats card and re-syncs the pinned-repo list — zero manual upkeep.

## How it works

- `scripts/generate-profile.mjs` (zero-dep, Node 20+) queries the GitHub GraphQL API, renders `assets/stats.svg` from `assets/stats.template.svg` (string-substitutes `{{TOKEN}}` placeholders), and rewrites the README pins block between `<!-- PINS:START -->` / `<!-- PINS:END -->`.
- `.github/workflows/profile.yml` runs it Mondays + on `workflow_dispatch`; commits only if something changed.
- All stats math is local — current and longest streak, `days since last vacation` (= ≥3 consecutive zero-contribution days), contributions, repos, stars, and a weekly-contributions bar strip. No third-party widget; we own the numbers.
- Template values are XML-escaped by `renderSvg`; only keys in `RAW_PLACEHOLDERS` (`WEEK_BARS`, generated from numbers) are inserted as markup. The bar strip uses a square-root scale so quiet weeks stay visible beside a busy peak.

## Gotchas

- **Preview the SVG over HTTP, not `file://`.** The Claude-in-Chrome `navigate` tool mangles `file:///…` into `https://file://…` (broken). Run `python3 -m http.server` in `assets/` and load `http://localhost:PORT/stats.svg`. An infinite CSS animation also makes `document_idle` time out — use `screenshot`, not `zoom`/`read_page`, to capture.
- **Pins are UI-only.** No API or `gh` command sets profile pins — edit them in the GitHub UI ("Customize your pins"). The README block auto-syncs from live `pinnedItems` on the next generator run, so just re-run the script (or wait for Monday) after changing pins. GitHub enforces the 6-pin cap as "0 remaining" in real time — uncheck before checking when swapping.
- **`STATS_TOKEN`** is a classic PAT with **no scopes and no expiration** (rotated 2026-09-23 after the old `repo` + `read:user` token expired and failed three runs). Every query reads public data; private contributions still count because the profile's "Include private contributions" setting puts them in the public calendar — turn that setting off and the totals drop. Set/rotate with `scripts/setup-stats-token.sh`. The workflow's rotation-issue step (<14 days to expiry, from the `GitHub-Authentication-Token-Expiration` header) stays in place for a future expiring token but never fires for this one.
- **Whimsy in the card is a CSS-only port** — camo strips `<script>` from README SVGs, so `background-clip:text` + `Whimsy.js` don't work. The flow is `@keyframes` on `<linearGradient>` stop-colors; `@media (prefers-reduced-motion)` freezes it. Details in `docs/artificer-adaptations.md`; filed upstream as `cameronsjo/artificer-design-system#133`.
- **`mcparr` is private** (depromoted — its *arr-stack description drew piracy assumptions). Don't re-pin it or reference it on the public profile.
