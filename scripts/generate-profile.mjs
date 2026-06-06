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
  const vacation = daysSinceLastVacation(calendar);
  const pins = profile.user.pinnedItems.nodes.filter(Boolean);

  const updated = new Date().toISOString().slice(0, 10);

  const values = {
    DAYS_SINCE_VACATION: vacation.days,
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
