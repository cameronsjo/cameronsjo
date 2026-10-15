import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { generateFixture } from "./fixtures/profile.mjs";

// Python's standard XML parser verifies the emitted document, rather than
// treating a regex match or successful generator exit as valid SVG.
/** Parse emitted SVG with the standard XML parser and return its accessible label/geometry. */
function parseSvg(svg) {
  const result = spawnSync("python3", ["-c", `
import json, sys, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.read())
assert root.tag == "{http://www.w3.org/2000/svg}svg"
ns = {"s": "http://www.w3.org/2000/svg"}
sprite = root.find("s:g[@transform='translate(204, 90)']", ns)
assert sprite is not None, "missing sprite markup"
rects = [{k: float(rect.attrib[k]) for k in ["x", "y", "width", "height"]} for rect in sprite.findall("s:rect", ns)]
print(json.dumps({"label": root.attrib["aria-label"], "role": root.attrib["role"], "fill": sprite.attrib["fill"], "rects": rects, "texts": [node.text for node in sprite.findall("s:text", ns)]}))
`], { input: svg, encoding: "utf8" });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return JSON.parse(result.stdout);
}

const sprites = new Map();
for (const [name, options, mood, expectedDays] of [
  ["on vacation", { days: 0 }, "perky", 0],
  ["30-day boundary", { days: 30 }, "perky", 30],
  ["31-day boundary", { days: 31 }, "drooping", 31],
  ["90-day boundary", { days: 90 }, "drooping", 90],
  ["91-day boundary", { days: 91 }, "asleep", 91],
  ["no break all year", { noBreak: true }, "asleep", 366],
]) {
  test(`real generator: ${name} renders ${mood} in both SVG themes`, async () => {
    const result = await generateFixture(options);
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, new RegExp(`"DAYS_SINCE_VACATION":${expectedDays}\\b`));
    for (const [theme, svg] of [["dark", result.dark], ["light", result.light]]) {
      assert.ok(svg, `${theme} output is missing`);
      assert.doesNotMatch(svg, /\{\{\w+\}\}/, "unsubstituted placeholder");
      const parsed = parseSvg(svg);
      assert.equal(parsed.role, "img");
      assert.match(parsed.label, new RegExp(`${expectedDays} days since last vacation \\(Sploot the corgi is ${mood}\\)`));
      assert.equal(parsed.fill, theme === "dark" ? "#dbbb6f" : "#7a5a10");
      assert.ok(parsed.rects.length > 0, "sprite must be raw rects, not escaped text");
      for (const rect of parsed.rects) {
        assert.equal(rect.x % 3, 0);
        assert.equal(rect.y % 6, 0);
        assert.equal(rect.width % 3, 0);
        assert.equal(rect.height, 6);
        assert.ok(rect.x >= 0 && rect.x + rect.width <= 90);
        assert.ok(rect.y >= 0 && rect.y + rect.height <= 48);
      }
      assert.deepEqual(parsed.texts, mood === "asleep" ? ["z", "z"] : []);
      if (theme === "light") {
        assert.doesNotMatch(svg, /#dbbb6f|#c5c8c6/i, "unmapped dark sprite colors");
        assert.match(svg, /#4a3f2a/i, "secondary text needs its light color");
      }
      const shape = JSON.stringify(parsed.rects);
      if (sprites.has(mood)) assert.equal(shape, sprites.get(mood));
      sprites.set(mood, shape);
    }
    assert.match(result.readme, /\[fixture\]\(https:\/\/example.com\/fixture\)/);
    assert.match(result.readme, /^before\n/);
    assert.match(result.readme, /\nafter\n$/);
  });
}

test("all three moods emit distinct sprite geometry", () => {
  assert.equal(sprites.size, 3);
  assert.equal(new Set(sprites.values()).size, 3);
});

test("the new raw sprite placeholder does not bypass ordinary XML escaping", async () => {
  const unsafe = '7<&"';
  const result = await generateFixture({ publicRepos: unsafe });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  for (const svg of [result.dark, result.light]) {
    assert.match(svg, /7&lt;&amp;&quot;/);
    assert.ok(parseSvg(svg).label.includes(`${unsafe} public repos`));
  }
});

test("an unmapped template color fails before any generated asset is written", async () => {
  const result = await generateFixture({
    transformTemplate: (text) => text.replace('fill="#dbbb6f"', 'fill="#010203"'),
  });
  assert.equal(result.status, 1, result.error?.message ?? result.stderr);
  assert.match(result.stderr, /LIGHT_THEME has no light value.*#010203/);
  assert.equal(result.dark, null);
  assert.equal(result.light, null);
  assert.match(result.readme, /old pins/);
});
