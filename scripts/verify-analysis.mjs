import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const uri = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
function compile(path, transform = (source) => source) {
  return ts.transpileModule(transform(readFileSync(new URL(path, import.meta.url), "utf8")), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

try {
  const format = uri(compile("../src/format.ts"));
  const keys = uri(compile("../src/processing/signatureKey.ts"));
  const { computeTrend } = await import(uri(compile("../src/data/trend.ts").replace('"@/format"', JSON.stringify(format))));
  const { TimeseriesIndex } = await import(uri(compile("../src/data/timeseries.ts", (source) =>
    source.replace('const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "data";', 'const DATA_BASE = "data";'),
  ).replace('"@/processing/signatureKey"', JSON.stringify(keys))));

  const make = (count, dayHasData) => ({
    dates: Array.from({ length: 14 }, (_, i) => `202610${String(i + 1).padStart(2, "0")}`),
    total: { count, ms: count.map((value) => value === null ? null : value * 1000) },
    dayHasData, members: [],
  });
  assert.equal(computeTrend(make([...Array(7).fill(100), ...Array(7).fill(null)], Array(14).fill(true)), "count").state, "below-cut");
  assert.equal(computeTrend(make([...Array(7).fill(null), ...Array(7).fill(100)], [...Array(7).fill(false), ...Array(7).fill(true)]), "count").state, "baseline-unavailable");
  assert.equal(computeTrend(make([...Array(7).fill(100), 200, ...Array(6).fill(null)], Array(14).fill(true)), "count").state, "current-build-unmatched");

  const laterSpike = make([...Array(13).fill(100), 9999], Array(14).fill(true));
  assert.equal(computeTrend(laterSpike, "count", {endDate: "20261013"}).peakValue, 100, "future builds cannot determine the peak of an older view");

  // A bug with one tracked member must contribute that member's time, not all its time.
  const signature = {
    stackKey: "0,1", memberStackKeys: ["0,1", "2,1"], memberStackMs: [70, 30],
    memberStackCounts: [7, 3], duration: 100, count: 10,
  };
  const index = new TimeseriesIndex({
    dates: ["20261010"], signatures: [{ frames: [["read Foo.js:20", ""], ["root", ""]], ms: [70], count: [7], totalMs: 70, totalCount: 7 }],
  });
  index.bind({ date: "20261010", funcNames: ["read Foo.js:10", "root", "other"], libNames: ["", "", ""], signatures: [signature] });
  assert.equal(index.coverageForSignature(signature).share, 0.7);
  assert.equal(index.resolveSignature(signature).coverage.share, 0.7);
  assert.equal(index.coverageForSignature({ stackKey: "2,1", duration: 30, count: 3 }).share, 0);
  const merged = { stackKey: "0,1", memberStackKeys: ["0,1", "0,2"], memberStackMs: [60,40], duration:100,count:20 };
  const clients = new TimeseriesIndex({ dates: ["20261010"], usageHoursByDate:{"20261010":5}, buildCompleteByDate:{"20261010":false}, signatures:[
    {frames:[["work",""],["caller1",""]],ms:[60],count:[12],totalMs:60,totalCount:12,affected:[3]},
    {frames:[["work",""],["caller2",""]],ms:[40],count:[8],totalMs:40,totalCount:8},
  ]});
  clients.bind({date:"20261010",funcNames:["work","caller1","caller2"],libNames:["","",""],signatures:[merged]});
  assert.deepEqual(clients.resolveSignature(merged).total.affected,[null], "partial client metrics must not look like complete reach");
  // Yesterday and today use entirely different stacks, but share a tagged bug.
  const bug = {id:42,summary:"Same issue",status:"NEW",signatures:["[bhr:Feature::Run]"]};
  const historical = new TimeseriesIndex({dates:["20261023","20261024","20261025"],signatures:[
    {frames:[["OldWait","win"],["Feature::Run","xul"]],ms:[100,150,null],count:[10,15,null],totalMs:250,totalCount:25},
  ]});
  historical.setBugs(new Map([["Feature::Run",bug]]));
  const yesterday={stackKey:"0,1",frameKeys:[0,1],duration:150,count:15,knownBug:bug};
  historical.bind({date:"20261024",funcNames:["OldWait","Feature::Run"],libNames:["win","xul"],signatures:[yesterday]});
  const prior=historical.resolveSignature(yesterday);
  const today={stackKey:"0,1,2",frameKeys:[0,1,2],duration:200,count:20,knownBug:bug};
  historical.bind({date:"20261025",funcNames:["NewWait","NewCaller","Feature::Run"],libNames:["linux","libxul","libxul"],signatures:[today]});
  const restored=historical.resolveSignature(today);
  assert.deepEqual(restored.total.ms,prior.total.ms,"same bug keeps its historical cohort despite changed current stacks");
  assert.equal(restored.coverage.stacks,0); assert.equal(restored.association.bugId,42);
  assert.equal(restored.total.ms[2],null,"do not insert new-platform totals into an unrelated historical stack");
  assert.equal(restored.filledDate,null);
  assert.equal(computeTrend(restored,"ms",{endDate:"20261025"}).state,"current-build-unmatched");
  assert.equal(computeTrend(restored,"ms",{endDate:"20261025"}).changePct,null);
  assert.equal(historical.resolveSignature({...today,knownBug:undefined}),null,"no guessed history for untracked different stacks");
  const enoughPriorDays = {...make([...Array(13).fill(100),null],Array(14).fill(true)),association:{bugId:42},coverage:{stacks:0,totalStacks:2,share:0}};
  assert.equal(computeTrend(enoughPriorDays,"count").state,"current-build-unmatched","six recent days must not imply a current trend when today's cohort is absent");
  historical.setBugs(new Map());
  assert.equal(historical.resolveSignature(today),null,"bug association cache invalidates when tags change");
  console.log("Analysis checks: missing-data states and weighted history coverage passed (20 assertions).");
} catch (error) {
  // Avoid dumping data-URL module source into diagnostics.
  console.error(error.message);
  process.exitCode = 1;
}
