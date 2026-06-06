# cameronsjo profile

Self-healing GitHub profile README. A weekly Action regenerates the stats card and re-syncs the pinned-repo list — zero manual upkeep.

## How it works

- `scripts/generate-profile.mjs` (zero-dep, Node 20+) queries the GitHub GraphQL API, renders `assets/stats.svg` from `assets/stats.template.svg` (string-substitutes `{{TOKEN}}` placeholders), and rewrites the README pins block between `<!-- PINS:START -->` / `<!-- PINS:END -->`.
- `.github/workflows/profile.yml` runs it Mondays + on `workflow_dispatch`; commits only if something changed.
- All stats math is local — current streak, `days since last vacation` (= ≥3 consecutive zero-contribution days), contributions, repos, stars. No third-party widget; we own the numbers.

## Gotchas

- **Preview the SVG over HTTP, not `file://`.** The Claude-in-Chrome `navigate` tool mangles `file:///…` into `https://file://…` (broken). Run `python3 -m http.server` in `assets/` and load `http://localhost:PORT/stats.svg`. An infinite CSS animation also makes `document_idle` time out — use `screenshot`, not `zoom`/`read_page`, to capture.
- **Pins are UI-only.** No API or `gh` command sets profile pins — edit them in the GitHub UI ("Customize your pins"). The README block auto-syncs from live `pinnedItems` on the next generator run, so just re-run the script (or wait for Monday) after changing pins. GitHub enforces the 6-pin cap as "0 remaining" in real time — uncheck before checking when swapping.
- **`STATS_TOKEN`** (classic PAT, `repo` + `read:user`) makes private contributions count toward the streak. Set/rotate with `scripts/setup-stats-token.sh`. Missing → public-only fallback; the workflow opens a rotation issue when the PAT is <14 days from expiry (read from the `GitHub-Authentication-Token-Expiration` header, gated to the real PAT).
- **Whimsy in the card is a CSS-only port** — camo strips `<script>` from README SVGs, so `background-clip:text` + `Whimsy.js` don't work. The flow is `@keyframes` on `<linearGradient>` stop-colors; `@media (prefers-reduced-motion)` freezes it. Details in `docs/artificer-adaptations.md`; filed upstream as `cameronsjo/artificer-design-system#133`.
- **`mcparr` is private** (depromoted — its *arr-stack description drew piracy assumptions). Don't re-pin it or reference it on the public profile.
