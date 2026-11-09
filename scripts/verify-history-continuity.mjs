// Offline history invariants for arbitrary tagged and untagged hangs, plus a
// production SessionWriter fixture for the original October/November report.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const uri = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

try {
  const keys = uri(compile("../src/processing/signatureKey.ts"));
  const format = uri(compile("../src/format.ts"));
  const { TimeseriesIndex } = await import(uri(compile("../src/data/timeseries.ts")
    .replace('const DATA_BASE = import.meta.env.VITE_DATA_BASE ?? "data";', 'const DATA_BASE = "data";')
    .replace('"@/processing/signatureKey"', JSON.stringify(keys))));
  const { computeTrend, trendBadge, trendCategory } = await import(uri(compile("../src/data/trend.ts")
    .replace('"@/format"', JSON.stringify(format))));
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/sessionwriter-history.json", import.meta.url), "utf8"));
  const rules = new Map([
    ["SessionWriter", fixture.bug],
    ["IOUtils_Binding::writeJSON", fixture.bug],
  ]);
  const index = new TimeseriesIndex(fixture.artifact);
  index.setBugs(rules);
  const resolve = (profile) => {
    index.bind(profile);
    return index.resolveSignature(profile.signatures[0]);
  };
  const [older, newer] = fixture.profiles;
  const before = resolve(older);
  const after = resolve(newer);
  assert(before && after);
  assert.equal(after.members.length, 6, "each exact stored stack contributes once, even when it matches two tags");
  assert.deepEqual(after.total, before.total, "switching builds must preserve every historical metric");
  assert.deepEqual(after.members, before.members, "composition must use the same historical cohort");
  assert.equal(after.dates.find((_, i) => after.total.ms[i] > 0), "20260820");
  assert.notEqual(computeTrend(after, "ms", { endDate: newer.date }).state, "newly-tracked");
  assert.notEqual(computeTrend(after, "count", { endDate: newer.date }).state, "newly-tracked");
  assert.deepEqual(resolve(older).total, after.total, "returning to the older build must not change stored values");
  const reversed = new TimeseriesIndex(fixture.artifact);
  reversed.setBugs(rules);
  reversed.bind(newer);
  assert.deepEqual(reversed.resolveSignature(newer.signatures[0]).total, before.total, "navigation order must not affect history");

  // Missing values must survive even when the viewed daily profile has the
  // same stack: borrowing its totals made the chart change on navigation.
  const dates = Array.from({ length: 21 }, (_, i) => `202610${String(i + 1).padStart(2, "0")}`);
  const counts = { d7: 3, d28: 5, d365: 8 };
  const historical = new TimeseriesIndex({
    dates, totalUsers: { d7: 30, d28: 50, d365: 80 },
    signatures: [{ frames: [["SessionWriter", ""]], ms: [...Array(20).fill(100), null],
      count: [...Array(20).fill(10), null], totalMs: 2000, totalCount: 200,
      affected: [...Array(20).fill(2), null], affectedUsers: counts }],
  });
  historical.setBugs(rules);
  const signature = { stackKey: "0", duration: 999, count: 99, knownBug: fixture.bug };
  const profile = { date: dates[20], funcNames: ["SessionWriter"], libNames: [""], signatures: [signature] };
  historical.bind(profile);
  const missing = historical.resolveSignature(signature);
  assert.equal(missing.total.ms[20], null, "missing history must not become a build-dependent filled bar");
  assert.equal(missing.total.count[20], null);
  assert.equal(missing.filledDate, null);
  assert.equal(computeTrend(missing, "ms").state, "current-build-unmatched");
  const untagged = { ...signature, knownBug: undefined };
  const untaggedMissing = historical.resolveSignature(untagged);
  assert.equal(untaggedMissing.total.ms[20], null, "untagged histories must also preserve published gaps");
  assert.equal(computeTrend(untaggedMissing, "ms").state, "current-build-unmatched", "untagged hangs need the same current-build evidence as tagged hangs");
  const affected = historical.resolveAffectedSignature(signature);
  historical.bind({ ...profile, funcNames: ["NewWait", "SessionWriter"], libNames: ["xul", ""],
    signatures: [{ ...signature, stackKey: "0,1" }] });
  const changed = { ...signature, stackKey: "0,1" };
  assert.deepEqual(historical.resolveSignature(changed).total, missing.total, "zero current overlap must retain historical data");
  assert.deepEqual(historical.resolveAffectedSignature(changed), affected, "client windows must use the same cohort as the history chart");
  assert.equal(historical.coverageForSignature(changed).share, 0);
  assert.equal(computeTrend(historical.resolveSignature(changed), "ms").changePct, null);
  assert.equal(historical.resolveSignature({ ...changed, knownBug: undefined }), null, "untracked stacks must not borrow another hang's history");
  historical.setBugs(new Map([["DifferentFeature", fixture.bug]]));
  assert.equal(historical.resolveSignature(changed), null, "refreshing bug tags must discard the old association");
  assert.equal(historical.resolveAffectedSignature(changed), null);
  historical.bind(profile);
  assert.equal(historical.resolveSignature(signature), null, "a matching stack shape must not bypass bug ownership");
  assert.equal(historical.coverageForSignature(signature).stacks, 0);

  // A known hang can fall below the publisher's cut for a week. Reappearing
  // in the tracked subset does not make it a newly tracked hang.
  const series = (values) => ({ dates, total: { count: values, ms: values.map(v => v == null ? null : v * 1000) },
    dayHasData: Array(21).fill(true), members: [] });
  for (const gap of [null, 0]) {
    const returning = computeTrend(series([...Array(7).fill(100), ...Array(7).fill(gap), ...Array(7).fill(100)]), "count");
    assert.equal(returning.state, "tracked-again");
    assert.equal(returning.newSince, null);
    assert.equal(returning.changePct, null);
    assert.equal(trendBadge(returning).text, "tracked again");
    assert.equal(trendCategory(returning), "other");
  }
  const largeIncrease = computeTrend(series([...Array(14).fill(100), ...Array(7).fill(10000)]), "count");
  assert.equal(largeIncrease.state, "increase", "a 100x increase in an observed hang is an increase, not a new hang");
  assert.equal(largeIncrease.changePct, 99);
  const genuinelyNew = computeTrend(series([...Array(14).fill(null), ...Array(7).fill(100)]), "count");
  assert.equal(genuinelyNew.state, "newly-tracked");
  assert.equal(genuinelyNew.newSince, dates[14]);
  const future = series([...Array(14).fill(0), ...Array(7).fill(100)]);
  future.dates.push("20261022"); future.total.count.push(999); future.total.ms.push(999000); future.dayHasData.push(true);
  assert.equal(computeTrend(future, "count", { endDate: dates[20] }).state, "newly-tracked", "future activity cannot affect an older build's classification");

  // These invariants do not depend on any particular bug id, function name,
  // library, or build. Check multiple unrelated bugs with disjoint daily stacks.
  const generalDates = dates.slice(0, 21);
  const stored = (frames, values) => ({
    frames, ms: values, count: values.map(value => value == null ? null : value / 10),
    totalMs: values.reduce((sum, value) => sum + (value ?? 0), 0),
    totalCount: values.reduce((sum, value) => sum + (value ?? 0) / 10, 0),
    affectedUsers: { d7: 2, d28: 3, d365: 5 },
  });
  const daily = (date, frames, knownBug, offset = 0) => {
    const funcNames = [...Array(offset).fill("unrelated function"), ...frames.map(([name]) => name)];
    const libNames = [...Array(offset).fill(""), ...frames.map(([, lib]) => lib)];
    const stackKey = frames.map((_, i) => i + offset).join(",");
    return { date, funcNames, libNames, signatures: [{ stackKey, duration: 900, count: 90, knownBug }] };
  };
  const allBugs = new Map();
  const storedStacks = [];
  const examples = [];
  for (let i = 0; i < 12; i++) {
    const tag = `Subsystem${i}::Run()`;
    const bug = { id: 810000 + i, summary: `Unrelated issue ${i}`, status: "NEW", signatures: [`[bhr:${tag}]`] };
    allBugs.set(tag, bug);
    const oldFrames = [[`OldWait${i}`, "old-platform"], [tag, "xul"]];
    const newFrames = [[`NewWait${i}`, "new-platform"], ["ChangedCaller", "libxul"], [tag, "libxul"]];
    storedStacks.push(stored(oldFrames, [...Array(14).fill(100 + i * 10), ...Array(7).fill(null)]));
    storedStacks.push(stored(newFrames, [...Array(14).fill(null), ...Array(7).fill(120 + i * 10)]));
    examples.push([daily(generalDates[13], oldFrames, bug), daily(generalDates[20], newFrames, bug, 3)]);
  }
  const genericArtifact = { dates: generalDates, signatures: storedStacks, totalUsers: { d7: 30, d28: 50, d365: 80 } };
  const originalArtifact = JSON.stringify(genericArtifact);
  const generalIndex = new TimeseriesIndex(genericArtifact);
  generalIndex.setBugs(allBugs);
  for (const [oldProfile, newProfile] of examples) {
    generalIndex.bind(oldProfile);
    const oldSeries = generalIndex.resolveSignature(oldProfile.signatures[0]);
    const oldClients = generalIndex.resolveAffectedSignature(oldProfile.signatures[0]);
    generalIndex.bind(newProfile);
    const newSeries = generalIndex.resolveSignature(newProfile.signatures[0]);
    assert.equal(newSeries.members.length, 2, "each bug must select its own history, excluding all unrelated bugs");
    assert.deepEqual(newSeries.total, oldSeries.total, "every bug must retain the same cohort across structural changes");
    assert.deepEqual(generalIndex.resolveAffectedSignature(newProfile.signatures[0]), oldClients);
    for (const metric of ["ms", "count"]) {
      assert.notEqual(computeTrend(newSeries, metric).state, "newly-tracked");
    }
  }
  assert.equal(JSON.stringify(genericArtifact), originalArtifact, "resolution must never modify the published history");

  // Untagged signatures use normalized full stack identity. Changing table
  // indices, JS line numbers, lambda numbers or Rust closure numbers must not
  // drop history. Different callers/libraries must remain separate.
  const renames = [
    ["read /modules/Feature.js:10", "read /modules/Feature.js:900", ""],
    ["Task::<lambda_7>::operator()", "Task::<lambda_a>::operator()", "xul"],
    ["Worker::{closure#12}", "Worker::{closure#15}", "libxul.so"],
  ];
  for (const [oldName, newName, lib] of renames) {
    const oldFrames = [[oldName, lib], ["Caller", "xul"]];
    const newFrames = [[newName, lib], ["Caller", "xul"]];
    const untaggedIndex = new TimeseriesIndex({ dates: generalDates, signatures: [
      stored(oldFrames, [...Array(14).fill(100), ...Array(7).fill(null)]),
      stored(newFrames, [...Array(14).fill(null), ...Array(7).fill(120)]),
      stored([[oldName, lib], ["DifferentCaller", "xul"]], Array(21).fill(5000)),
      stored([[oldName, "different library"], ["Caller", "xul"]], Array(21).fill(6000)),
    ], totalUsers: { d7: 30, d28: 50, d365: 80 } });
    const oldProfile = daily(generalDates[13], oldFrames, undefined);
    const newProfile = daily(generalDates[20], newFrames, undefined, 5);
    untaggedIndex.bind(oldProfile);
    const oldSeries = untaggedIndex.resolveSignature(oldProfile.signatures[0]);
    const oldClients = untaggedIndex.resolveAffectedSignature(oldProfile.signatures[0]);
    untaggedIndex.bind(newProfile);
    const newSeries = untaggedIndex.resolveSignature(newProfile.signatures[0]);
    assert.equal(newSeries.members.length, 2, "normalization must not borrow history from a different caller or library");
    assert.deepEqual(newSeries.total, oldSeries.total, "untagged signatures must retain history across harmless renames");
    assert.deepEqual(untaggedIndex.resolveAffectedSignature(newProfile.signatures[0]), oldClients);
    assert.equal(newSeries.association, undefined);
    assert.equal(newSeries.total.ms[0], 100);
    assert.equal(newSeries.total.ms[20], 120);
    assert.equal(computeTrend(newSeries, "ms").state, "increase");
    assert.equal(computeTrend(newSeries, "ms").changePct, 0.2);
    untaggedIndex.setBugs(new Map());
    assert.deepEqual(untaggedIndex.resolveSignature(newProfile.signatures[0]).total, oldSeries.total, "untagged history must not depend on bug-list availability");
    const unknown = daily(generalDates[20], [["UnknownWait", lib], ["DifferentContext", "xul"]], undefined);
    untaggedIndex.bind(unknown);
    assert.equal(untaggedIndex.resolveSignature(unknown.signatures[0]), null, "unknown identity must remain unavailable rather than invent a historical match");
  }
  console.log("History continuity: 12 unrelated bugs, untagged JS/C++/Rust renames, caller/library isolation, navigation, missing samples, client metrics, new/returning trends and production regression passed.");
} catch (error) {
  // Data-URL imports otherwise dump the entire bundled source on failure.
  console.error(error.message);
  process.exitCode = 1;
}
