import { cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const loader = fileURLToPath(new URL("mock-github.mjs", import.meta.url));

export async function generateFixture({ days = 0, noBreak = false, publicRepos = 7, transformTemplate = (text) => text } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "profile-regression-"));
  try {
    await mkdir(join(temporary, "scripts"));
    await mkdir(join(temporary, "assets"));
    await copyFile(join(root, "scripts/generate-profile.mjs"), join(temporary, "scripts/generate-profile.mjs"));
    await cp(join(root, "assets/fonts"), join(temporary, "assets/fonts"), { recursive: true });
    await writeFile(join(temporary, "assets/stats.template.svg"), transformTemplate(await readFile(join(root, "assets/stats.template.svg"), "utf8")));
    await writeFile(join(temporary, "README.md"), "before\n<!-- PINS:START -->\nold pins\n<!-- PINS:END -->\nafter\n");
    // Stable dates: vacation age is computed from the calendar's most recent
    // day, not the machine clock. Breaks consist of exactly three zero days.
    const calendarDays = Array.from({ length: 366 }, (_, index) => {
      const age = 365 - index;
      return {
        date: new Date(Date.UTC(2026, 9, 15) - age * 86400000).toISOString().slice(0, 10),
        contributionCount: !noBreak && age >= days && age < days + 3 ? 0 : 1,
      };
    });
    const weeks = [];
    for (let i = 0; i < calendarDays.length; i += 7) weeks.push({ contributionDays: calendarDays.slice(i, i + 7) });
    const fixturePath = join(temporary, "fixture.json");
    await writeFile(fixturePath, JSON.stringify({ publicRepos, calendar: {
      totalContributions: calendarDays.reduce((sum, day) => sum + day.contributionCount, 0), weeks,
    } }));
    const result = spawnSync(process.execPath, ["--import", loader, join(temporary, "scripts/generate-profile.mjs")], {
      cwd: temporary,
      // Do not inherit production credentials or NODE_OPTIONS into the child.
      env: { STATS_TOKEN: "offline-test-token", PROFILE_FIXTURE: fixturePath },
      encoding: "utf8", timeout: 10000,
    });
    async function output(name) {
      try { return await readFile(join(temporary, name), "utf8"); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    }
    return {
      status: result.status, error: result.error,
      stdout: result.stdout, stderr: result.stderr,
      dark: await output("assets/stats.svg"), light: await output("assets/stats-light.svg"),
      readme: await output("README.md"),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
