/**
 * Tests for contrib-cards.mjs.
 *
 * The generator replaced two third-party services that had been silently
 * feeding the profile wrong data, so the streak arithmetic and the SVG output
 * are worth pinning. Uses node:test so it runs with no dependencies.
 *
 *   node --test .github/scripts/
 */

import test from "node:test";
import assert from "node:assert/strict";
import { computeStreaks, streakCard, activityGraph } from "./contrib-cards.mjs";

/** Builds a calendar of `n` days from `start`, filling counts via `fn(i)`. */
const calendar = (start, n, fn) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), count: fn(i) };
  });

test("totals every contribution", () => {
  const days = calendar("2026-01-01", 10, () => 3);
  assert.equal(computeStreaks(days).total, 30);
});

test("finds the longest run and its date range", () => {
  // 19-day run starting at index 10
  const days = calendar("2026-05-01", 60, (i) => (i >= 10 && i < 29 ? 3 : 0));
  const { longest } = computeStreaks(days);
  assert.equal(longest.len, 19);
  assert.equal(longest.start, "2026-05-11");
  assert.equal(longest.end, "2026-05-29");
});

test("counts the current streak up to the final day", () => {
  const days = calendar("2026-05-01", 30, (i) => (i >= 26 ? 2 : 0));
  const { current } = computeStreaks(days);
  assert.equal(current.len, 4);
  assert.equal(current.end, "2026-05-30");
});

test("a day with nothing yet today does not break the streak", () => {
  // active through the second-to-last day, nothing logged today
  const days = calendar("2026-05-01", 30, (i) => (i >= 26 && i < 29 ? 2 : 0));
  assert.equal(computeStreaks(days).current.len, 3);
});

test("an earlier zero does break the streak", () => {
  const days = calendar("2026-05-01", 30, (i) => (i === 28 ? 0 : 1));
  assert.equal(computeStreaks(days).current.len, 1);
});

test("handles a calendar with no contributions at all", () => {
  const s = computeStreaks(calendar("2026-05-01", 30, () => 0));
  assert.equal(s.total, 0);
  assert.equal(s.current.len, 0);
  assert.equal(s.longest.len, 0);
});

test("handles an unbroken calendar", () => {
  const days = calendar("2026-05-01", 30, () => 1);
  const s = computeStreaks(days);
  assert.equal(s.longest.len, 30);
  assert.equal(s.current.len, 30);
});

test("streak card renders at 495x195 with no placeholder values", () => {
  const days = calendar("2026-05-01", 40, (i) => (i > 30 ? 2 : 0));
  const svg = streakCard(computeStreaks(days));
  assert.match(svg, /width="495" height="195"/);
  assert.doesNotMatch(svg, /NaN|undefined|null/);
  assert.match(svg, /Total Contributions/);
  assert.match(svg, /Current Streak/);
  assert.match(svg, /Longest Streak/);
});

test("activity graph renders one point per day with no placeholders", () => {
  const days = calendar("2026-05-01", 60, (i) => i % 5);
  const svg = activityGraph(days, 31);
  assert.match(svg, /width="820" height="320"/);
  assert.doesNotMatch(svg, /NaN|undefined|null/);
  assert.equal(svg.match(/<circle/g).length, 31);
});

test("activity graph survives an all-zero window without dividing by zero", () => {
  const svg = activityGraph(calendar("2026-05-01", 31, () => 0), 31);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test("activity graph handles a window shorter than requested", () => {
  const svg = activityGraph(calendar("2026-05-01", 3, () => 1), 31);
  assert.doesNotMatch(svg, /NaN|undefined/);
  assert.equal(svg.match(/<circle/g).length, 3);
});

test("counts are escaped into the SVG safely", () => {
  const days = calendar("2026-05-01", 5, () => 1);
  assert.doesNotMatch(streakCard(computeStreaks(days)), /<script/i);
});
