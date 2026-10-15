# Finish Sploot on the profile card

Status: implementation and verification complete. External PR delivery is
recorded in the chief-of-staff report.

Cameron approved the chief-of-staff Phase 1 plan via go.md: finish profile
PR #7 with offline real-generator regressions and visual verification, then
push its feature ref, update its body, mark ready and watch CI. No merge,
production stats refresh, credential change or deployment is authorized.

- [x] Fetch origin and create the prescribed detached PR worktree.
- [x] Merge current main and preserve its generated assets and README pins.
- [x] Add offline real-generator tests for 0/30/31/90/91-day and no-break moods,
      valid XML, raw sprite markup, escaped text, placeholders and light colors.
- [x] Compare the three sprite grids against the blog's verified implementation.
- [x] Prove regression tests fail against deliberate implementation breaks.
- [x] Render all three moods in both themes and inspect bounds/overlap.
- [x] Independently review the net diff and run final checks.

The generator remains dependency-free; tests use Node's test runner plus
Python 3's standard XML parser. Fetch is stubbed in a child process running a
copy of the actual script, template and fonts in a temporary directory. Only
dummy authentication is supplied, and no generated fixture data is written
into the repository's production assets or README.

Verification: node --check scripts/generate-profile.mjs;
node --test tests/generate-profile.test.mjs; git diff --check. The scheduled
workflow is unchanged. External delivery state is recorded in the
chief-of-staff report, not inferred from this local checklist.

Results: nine offline real-generator tests pass. Six deliberate implementation
breaks each failed (exit 1): both mood boundaries, raw markup, light mapping,
pixel height and ordinary XML escaping. The restored script passed all nine.
The three grids match the blog at 1daae4f. Chromium rendered all six mood/theme
variants over HTTP and as embedded images; bounding boxes stay in the hero
card and clear both its number and label. A fresh read-only Codex review found
no supported remaining defects.

Next action: commit and deliver the feature ref and ready PR; keep the live
stats refresh, merge and deployment excluded.
