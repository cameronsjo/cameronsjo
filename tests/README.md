# Offline profile regressions

Requirements: Node 20+ and Python 3 (its standard XML parser is used to check
the generated SVG documents). No npm packages or real GitHub token are needed.

```sh
node --check scripts/generate-profile.mjs
node --test tests/generate-profile.test.mjs
```

The fixtures copy the actual generator, SVG template and committed fonts into
a temporary directory. A preload replaces fetch, accepts only the expected
GraphQL requests and dummy authorization, and supplies a fixed contribution
calendar. Generated cards and pins stay in that temporary directory, which is
removed after the run. The child does not inherit production credentials or
NODE_OPTIONS.

Coverage includes the 0/30/31/90/91-day boundaries and no qualifying break,
three distinct poses, actual raw rectangle markup, 3×6 pixel geometry,
sleeping z's, both SVG themes, XML escaping, complete placeholder substitution,
and failure before writes when a template color has no light mapping.

Production assets remain owned by the existing scheduled/manual workflow;
these tests do not dispatch it or refresh the tracked stats cards.
