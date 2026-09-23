#!/usr/bin/env node
// generate-profile.mjs — self-hosted GitHub profile stats + pins renderer.
//
// Zero dependencies: uses built-in fetch (Node 20+). Queries the GitHub GraphQL
// API for contribution calendar, repo totals, and pinned items; computes streak
// math locally; renders assets/stats.svg (dark) and assets/stats-light.svg from
// assets/stats.template.svg; and
// rewrites the README's pinned-repo block between PINS markers.
//
// Auth: STATS_TOKEN is a classic PAT with no scopes and no expiration. Every
// query reads public data only; private contributions still count because the
// profile's "Include private contributions" setting puts them in the public
// calendar. Falls back to GITHUB_TOKEN if STATS_TOKEN is absent.

import { readFile, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const LOGIN = process.env.PROFILE_LOGIN || "cameronsjo";
const TOKEN = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;
const USING_PAT = Boolean(process.env.STATS_TOKEN);

// GitHub returns the PAT's expiration in a response header; captured per-call so
// the workflow can warn before it lapses. (GITHUB_TOKEN's ~1h expiry is ignored.)
let tokenExpiry = null;

if (!TOKEN) {
  console.error(
    "No token found. Set STATS_TOKEN (preferred) or GITHUB_TOKEN — GraphQL requires authentication.",
  );
  process.exit(1);
}

const GRAPHQL = "https://api.github.com/graphql";

async function gql(query, variables) {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": `${LOGIN}-profile-generator`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const exp = res.headers.get("github-authentication-token-expiration");
  if (exp) tokenExpiry = exp;
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ── Data fetch ────────────────────────────────────────────────────────────

const PROFILE_QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes {
          ... on Repository {
            name
            description
            url
            stargazerCount
          }
        }
      }
    }
  }
`;

const REPOS_QUERY = `
  query($login: String!, $cursor: String) {
    user(login: $login) {
      repositories(
        ownerAffiliations: OWNER
        privacy: PUBLIC
        isFork: false
        first: 100
        after: $cursor
      ) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { stargazerCount }
      }
    }
  }
`;

async function fetchRepoTotals() {
  let cursor = null;
  let totalCount = 0;
  let totalStars = 0;
  do {
    const data = await gql(REPOS_QUERY, { login: LOGIN, cursor });
    const repos = data.user.repositories;
    totalCount = repos.totalCount;
    for (const node of repos.nodes) totalStars += node.stargazerCount;
    cursor = repos.pageInfo.hasNextPage ? repos.pageInfo.endCursor : null;
  } while (cursor);
  return { publicRepos: totalCount, totalStars };
}

// ── Streak math ─────────────────────────────────────────────────────────────
// Flatten the contribution calendar into a chronological list of days, then
// derive current/longest runs of days with at least one contribution. This is
// the same computation streak-stats.demolab.com performs — we just own it now.

function computeStreaks(calendar) {
  const days = calendar.weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));

  let longest = 0;
  let run = 0;
  for (const day of days) {
    if (day.contributionCount > 0) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  // Current streak: walk backwards from the most recent day. Today counting 0
  // does not break the streak (the day isn't over), but any earlier 0 does.
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) {
      current += 1;
    } else if (i === days.length - 1) {
      // Most recent day has no contributions yet — skip, don't reset.
      continue;
    } else {
      break;
    }
  }

  return { current, longest };
}

// ── "Days since last vacation" ───────────────────────────────────────────────
// The deadpan inverse of the workshop "days since last accident" sign. A
// "vacation" is a real break, not a quiet day: >= 3 consecutive zero-contribution
// days (the daily calendar's stand-in for ">= 72h of no activity"). The stat is
// the number of days since the most recent such break ended.

const VACATION_MIN_DAYS = 3;

function daysSinceLastVacation(calendar) {
  const days = calendar.weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return { days: 0 };

  // Scan backwards for the end (most recent day) of a zero-run >= VACATION_MIN_DAYS.
  let endIdx = -1;
  let i = days.length - 1;
  while (i >= 0) {
    if (days[i].contributionCount === 0) {
      let j = i;
      while (j >= 0 && days[j].contributionCount === 0) j -= 1;
      if (i - j >= VACATION_MIN_DAYS) {
        endIdx = i;
        break;
      }
      i = j; // skip this too-short run and keep looking earlier
    } else {
      i -= 1;
    }
  }

  // No qualifying break in the window — they haven't taken 3 days off all year.
  if (endIdx === -1) return { days: days.length, none: true };

  // The break runs to today → currently on vacation.
  if (endIdx === days.length - 1) return { days: 0, onVacation: true };

  const ms = 86400000;
  const end = new Date(`${days[endIdx].date}T00:00:00Z`);
  const today = new Date(`${days[days.length - 1].date}T00:00:00Z`);
  return { days: Math.round((today - end) / ms) };
}

// ── SVG render ──────────────────────────────────────────────────────────────

// 19141 → "19.1K", 1200000 → "1.2M"; below 10k keeps every digit.
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function formatCompact(n) {
  return n < 10000 ? n.toLocaleString("en-US") : COMPACT.format(n);
}

// One bar per calendar week. Heights use a square-root scale so quiet weeks
// stay visible next to a busy peak; the chart has no axis, so it shows shape,
// not exact values.
const BARS_WIDTH = 592;
const BARS_HEIGHT = 32;
const BARS_GAP = 2;
const BARS_STAGGER_MS = 12;

function renderWeekBars(calendar) {
  const totals = calendar.weeks.map((w) =>
    w.contributionDays.reduce((sum, d) => sum + d.contributionCount, 0),
  );
  const max = Math.max(1, ...totals);
  const step = BARS_WIDTH / totals.length;
  const width = (step - BARS_GAP).toFixed(2);
  return totals
    .map((count, i) => {
      const h = Math.max(1.5, Math.sqrt(count / max) * BARS_HEIGHT);
      const cls = i === totals.length - 1 ? "bar bar-now" : "bar";
      return `<rect class="${cls}" x="${(i * step).toFixed(2)}" y="${(BARS_HEIGHT - h).toFixed(2)}" width="${width}" height="${h.toFixed(2)}" rx="1" style="animation-delay: ${i * BARS_STAGGER_MS}ms"/>`;
    })
    .join("\n    ");
}

// JetBrains Mono subsets (ASCII + middle dot, OFL — see assets/fonts/OFL.txt),
// inlined as data URIs: GitHub's camo <img> proxy blocks external font URLs.
// Regenerate a subset with:
//   uvx --from 'fonttools[woff]' pyftsubset JetBrainsMono-Bold.ttf \
//     --unicodes='U+0020-007E,U+00B7' --flavor=woff2 --layout-features='' \
//     --no-hinting --desubroutinize --output-file=assets/fonts/jetbrains-mono-700.woff2
const FONT_WEIGHTS = [400, 600, 700];

async function renderFontFaces() {
  const faces = await Promise.all(
    FONT_WEIGHTS.map(async (weight) => {
      const data = await readFile(join(ROOT, `assets/fonts/jetbrains-mono-${weight}.woff2`));
      return `@font-face { font-family: "JetBrains Mono"; font-weight: ${weight}; src: url(data:font/woff2;base64,${data.toString("base64")}) format("woff2"); }`;
    }),
  );
  return faces.join("\n    ");
}

// The template is written in Artificer's dark palette. The light copy (paper
// stock) swaps each dark hex for its light-theme token; README's <picture>
// picks one per the viewer's GitHub theme. Every template hex must be mapped,
// so a new color fails the run instead of staying dark on ivory.
const LIGHT_THEME = new Map([
  ["#292c33", "#f5ead0"], // --bg
  ["#313540", "#eddcc0"], // --bg-raised
  ["#4a4f5c", "#cbb88a"], // --border
  ["#c5c8c6", "#4a3f2a"], // --fg-secondary
  ["#b8cad4", "#2e4a5a"], // --steel
  ["#5a7a8a", "#5a7a8a"], // --steel-fill (bars): same in both themes, 3.84:1 on ivory (graphics floor 3:1)
  ["#dbbb6f", "#7a5a10"], // --accent
  ["#e3c885", "#866010"], // --accent-bright (hero gradient top)
  ["#c4932a", "#7a5a10"], // --accent-fill → --accent (hero gradient base; fill gold is too light on ivory)
  ["#c4808a", "#7a5a10"], // whimsy rose stop → --accent; light --attention (#8a6618) is 4.40:1, under AA for the 15px wordmark
  ["#b095e0", "#5a35b0"], // --brand-purple-bright (whimsy)
  ["#6aa67d", "#2a5a3a"], // --success (whimsy green stop)
  ["#4a8a5e", "#2a5a3a"], // --success (status dot)
]);

// Any #rgb … #rrggbbaa form, so a shorthand or alpha hex fails the check
// instead of slipping past a six-digit-only pattern and staying dark.
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function toLightTheme(svg) {
  const unmapped = [...new Set(svg.match(HEX) ?? [])].filter(
    (h) => !LIGHT_THEME.has(h.toLowerCase()),
  );
  if (unmapped.length) {
    throw new Error(`LIGHT_THEME has no light value for color(s): ${unmapped.join(", ")}`);
  }
  return svg.replace(HEX, (h) => LIGHT_THEME.get(h.toLowerCase()));
}

// Placeholders whose value is generated markup. Every other value is
// XML-escaped, so a string with <, & or " cannot break the SVG.
const RAW_PLACEHOLDERS = new Set(["WEEK_BARS", "FONT_FACES"]);

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderSvg(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) return match; // leave unknown placeholders intact
    const v = String(values[key]);
    return RAW_PLACEHOLDERS.has(key) ? v : escapeXml(v);
  });
}

// ── README pins block ─────────────────────────────────────────────────────────

const PINS_START = "<!-- PINS:START -->";
const PINS_END = "<!-- PINS:END -->";

function renderPins(pins) {
  const lines = pins.map((p) => {
    const desc = p.description ? ` — ${p.description}` : "";
    const star = p.stargazerCount > 0 ? ` ★ ${p.stargazerCount}` : "";
    return `- [${p.name}](${p.url})${desc}${star}`;
  });
  return [
    PINS_START,
    "<!-- generated weekly — do not edit by hand -->",
    ...lines,
    PINS_END,
  ].join("\n");
}

function rewritePins(readme, pins) {
  const startIdx = readme.indexOf(PINS_START);
  const endIdx = readme.indexOf(PINS_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`PINS markers not found in README (need ${PINS_START} / ${PINS_END})`);
  }
  const before = readme.slice(0, startIdx);
  const after = readme.slice(endIdx + PINS_END.length);
  return before + renderPins(pins) + after;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [profile, repoTotals] = await Promise.all([
    gql(PROFILE_QUERY, { login: LOGIN }),
    fetchRepoTotals(),
  ]);

  const calendar = profile.user.contributionsCollection.contributionCalendar;
  const { current, longest } = computeStreaks(calendar);
  const vacation = daysSinceLastVacation(calendar);
  const pins = profile.user.pinnedItems.nodes.filter(Boolean);

  const updated = new Date().toISOString().slice(0, 10);

  const values = {
    DAYS_SINCE_VACATION: vacation.days,
    CURRENT_STREAK: current,
    LONGEST_STREAK: longest,
    TOTAL_CONTRIB: calendar.totalContributions,
    TOTAL_CONTRIB_SHORT: formatCompact(calendar.totalContributions),
    PUBLIC_REPOS: repoTotals.publicRepos,
    TOTAL_STARS: repoTotals.totalStars,
    UPDATED: updated,
    WEEK_BARS: renderWeekBars(calendar),
    FONT_FACES: await renderFontFaces(),
  };

  const { WEEK_BARS, FONT_FACES, ...stats } = values;
  console.log("Stats:", JSON.stringify(stats));
  console.log("Pins:", pins.map((p) => p.name).join(", "));

  const template = await readFile(join(ROOT, "assets/stats.template.svg"), "utf8");
  const svg = renderSvg(template, values);
  const lightSvg = toLightTheme(svg); // throws before any write on an unmapped color
  await writeFile(join(ROOT, "assets/stats.svg"), svg);
  await writeFile(join(ROOT, "assets/stats-light.svg"), lightSvg);

  const readmePath = join(ROOT, "README.md");
  const readme = await readFile(readmePath, "utf8");
  await writeFile(readmePath, rewritePins(readme, pins));

  console.log("Wrote assets/stats.svg, assets/stats-light.svg, and updated README pins block.");

  // Token-expiry reminder: only meaningful for a real PAT (the GITHUB_TOKEN
  // fallback expires hourly). Surface days-remaining so the workflow can warn.
  if (USING_PAT && tokenExpiry) {
    const m = tokenExpiry.match(/\d{4}-\d{2}-\d{2}/);
    if (m) {
      const daysLeft = Math.round(
        (new Date(`${m[0]}T00:00:00Z`) - new Date(`${updated}T00:00:00Z`)) / 86400000,
      );
      console.log(`STATS_TOKEN expires in ${daysLeft} days (${m[0]}).`);
      if (process.env.GITHUB_OUTPUT) {
        appendFileSync(
          process.env.GITHUB_OUTPUT,
          `token_expiry_days=${daysLeft}\ntoken_expiry_at=${m[0]}\n`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
