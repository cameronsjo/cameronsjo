import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(process.env.PROFILE_FIXTURE, "utf8"));
// Replaces every fetch used by the real generator. Unexpected requests fail;
// neither network access nor a real GitHub credential is needed.
globalThis.fetch = async (url, options) => {
  assert.equal(url, "https://api.github.com/graphql");
  assert.equal(options.headers.Authorization, "bearer offline-test-token");
  const { query } = JSON.parse(options.body);
  if (query.includes("contributionsCollection")) {
    return new Response(JSON.stringify({ data: { user: {
      contributionsCollection: { contributionCalendar: fixture.calendar },
      pinnedItems: { nodes: [{ name: "fixture", description: "offline fixture", url: "https://example.com/fixture", stargazerCount: 2 }] },
    } } }));
  }
  assert.ok(query.includes("repositories("), "unexpected GraphQL query");
  return new Response(JSON.stringify({ data: { user: { repositories: {
    totalCount: fixture.publicRepos,
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [{ stargazerCount: 12 }],
  } } } }));
};
