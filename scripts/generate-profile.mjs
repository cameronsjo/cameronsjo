#!/usr/bin/env node
// generate-profile.mjs — self-hosted GitHub profile stats + pins renderer.
//
// Zero dependencies: uses built-in fetch (Node 20+). Queries the GitHub GraphQL
// API for contribution calendar, repo totals, and pinned items; computes streak
// math locally; renders assets/stats.svg from assets/stats.template.svg; and
// rewrites the README's pinned-repo block between PINS markers.
//
// Auth: STATS_TOKEN (classic PAT with repo + read:user) makes private
// contributions count toward the streak. Falls back to GITHUB_TOKEN
// (public-only contributions) if STATS_TOKEN is absent.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const LOGIN = process.env.PROFILE_LOGIN || "cameronsjo";
const TOKEN = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;

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

// ── SVG render ──────────────────────────────────────────────────────────────

function renderSvg(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in values) return String(values[key]);
    return match; // leave unknown placeholders intact
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
  const pins = profile.user.pinnedItems.nodes.filter(Boolean);

  const updated = new Date().toISOString().slice(0, 10);

  const values = {
    CURRENT_STREAK: current,
    LONGEST_STREAK: longest,
    TOTAL_CONTRIB: calendar.totalContributions,
    PUBLIC_REPOS: repoTotals.publicRepos,
    TOTAL_STARS: repoTotals.totalStars,
    UPDATED: updated,
  };

  console.log("Stats:", JSON.stringify(values));
  console.log("Pins:", pins.map((p) => p.name).join(", "));

  const template = await readFile(join(ROOT, "assets/stats.template.svg"), "utf8");
  const svg = renderSvg(template, values);
  await writeFile(join(ROOT, "assets/stats.svg"), svg);

  const readmePath = join(ROOT, "README.md");
  const readme = await readFile(readmePath, "utf8");
  await writeFile(readmePath, rewritePins(readme, pins));

  console.log("Wrote assets/stats.svg and updated README pins block.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
