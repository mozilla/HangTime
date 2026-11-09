/**
 * Trend summary for a signature's timeseries, for triage. The question a
 * reviewer asks first is "is this getting worse, by how much, is it new, worth
 * opening?" -- so we reduce a per-day series to a few judgements rather than
 * leave the user to read the chart.
 *
 * A judgement is only as good as the days behind it, and the timeseries has
 * gaps of two different kinds. A day with no artifact at all is *unavailable*:
 * nothing was recorded for any signature. A day where other signatures were
 * recorded but this one wasn't means it fell *below the tracking cut*: the
 * roll-up keeps only each day's top signatures, so it was smaller than the
 * cut, not necessarily zero. A real 0 is an *observed zero*. Treating either
 * gap as zero is how a signature with no recent data used to read as "↓100%".
 *
 * So every trend carries an explicit state, and a percentage is only stated
 * when both windows are well covered and the volume is big enough to mean
 * something. Everything short of that says what is missing instead.
 *
 * Other robustness choices:
 *  - % change compares the 7 days ending at the build in view with the 7 days
 *    before, not today vs yesterday (single days are too noisy), and not the
 *    latest window when an older build is on screen.
 *  - "newly tracked" needs meaningful recent volume, an absent or near-zero
 *    baseline, and no activity in earlier history. A tracking gap or a large
 *    increase in a longstanding hang must not make that hang look new.
 */

import type { Metric, ResolvedSeries } from "./timeseries";
import { formatDateRange } from "@/format";

export type TrendTone = "red" | "amber" | "green" | "blue" | "neutral";

/**
 * What the data can support saying about a signature's change:
 *  - `increase` / `decrease` / `stable`: both windows well covered, with enough
 *    volume for the change to mean something.
 *  - `low-volume`: well covered, but too few hangs either side for a % to mean
 *    anything.
 *  - `spike`: the weekly averages differ, but only because of a day or two;
 *    the typical (median) day didn't move with them.
 *  - `newly-tracked`: absent (or ~zero) through a covered baseline, meaningful
 *    volume now. It may have existed below the tracking cut before.
 *  - `tracked-again`: meaningful volume after a tracking gap or zero baseline,
 *    with activity already recorded earlier in the history window.
 *  - `baseline-unavailable`: the baseline days have no data for anyone, so
 *    there is nothing to compare against.
 *  - `incomplete`: too few observed days in one window to compare.
 *  - `no-recent-data`: the recent days have no data for anyone.
 *  - `below-cut`: recent days were recorded but this signature fell below the
 *    tracking cut on all of them; likely smaller, by an unknown amount.
 *  - `outside-window`: the build in view isn't in the timeseries at all.
 */
export type TrendState =
  | "increase"
  | "decrease"
  | "stable"
  | "low-volume"
  | "spike"
  | "newly-tracked"
  | "tracked-again"
  | "baseline-unavailable"
  | "incomplete"
  | "no-recent-data"
  | "below-cut"
  | "outside-window"
  | "current-build-unmatched";

/** Trend buckets the hang list can be filtered to. */
export type TrendCategory = "increase" | "decrease" | "new" | "other";

/** How well one comparison window is covered, and its average. */
export interface WindowEvidence {
  /** First and last date of the window, or null when it lies outside the series. */
  start: string | null;
  end: string | null;
  /** Days the window spans (fewer than 7 at the start of the series). */
  days: number;
  /** Days this signature has a value, observed zeros included. */
  observed: number;
  /** Days with no data for any signature. */
  unavailable: number;
  /** Days other signatures were recorded but this one fell below the cut. */
  belowCut: number;
  /** Mean of the metric over observed days, or null when none were observed. */
  avg: number | null;
  /** Median over observed days: the typical day, which one spike can't move. */
  median: number | null;
  /** The observed day with the highest value, for naming a spike. */
  maxDate: string | null;
  /** Hang count and ms summed over observed days, for the volume tests. */
  count: number;
  ms: number;
}

export interface TrendSummary {
  state: TrendState;
  /** Metric the averages and change were computed on. */
  metric: Metric;
  /** The day the recent window ends on (the build in view), when in the series. */
  endDate: string | null;
  recent: WindowEvidence;
  baseline: WindowEvidence;
  /** Signed fraction (0.74 = +74%), only when both windows support it. */
  changePct: number | null;
  /**
   * Absolute change in the metric per day, recent average minus baseline
   * average, when the two windows were well enough covered to compare. A 300%
   * rise on a hang that barely registers matters less than a 30% rise on a big
   * one, so credible increases rank by this.
   */
  deltaPerDay: number | null;
  /** First observed active day, when `newly-tracked`. */
  newSince: string | null;
  peakDate: string;
  /** Null when no day in the series has data. */
  peakValue: number | null;
  /** Number of member stacks behind the series (1 for a plain signature). */
  trackedStacks: number;
}

const WINDOW_DAYS = 7;
/** Observed days each window needs before a change is stated. */
const MIN_OBSERVED_DAYS = 5;
const MEANINGFUL_COUNT = 20;
const MEANINGFUL_MS = 30_000;
const NEW_BASELINE_MAX_COUNT = 3;
const REGRESSION_PCT = 0.5;
const ELEVATED_PCT = 0.2;

function windowEvidence(
  series: ResolvedSeries,
  primary: (number | null)[],
  from: number,
  to: number,
): WindowEvidence {
  const start = Math.max(0, from);
  const days = Math.max(0, to - start + 1);
  const evidence: WindowEvidence = {
    start: days > 0 ? series.dates[start] : null,
    end: days > 0 ? series.dates[to] : null,
    days,
    observed: 0,
    unavailable: 0,
    belowCut: 0,
    avg: null,
    median: null,
    maxDate: null,
    count: 0,
    ms: 0,
  };
  const values: number[] = [];
  let max = -Infinity;
  for (let i = start; i <= to; i++) {
    const value = primary[i];
    if (value != null) {
      evidence.observed++;
      values.push(value);
      if (value > max) {
        max = value;
        evidence.maxDate = series.dates[i];
      }
      evidence.count += series.total.count[i] ?? 0;
      evidence.ms += series.total.ms[i] ?? 0;
    } else if (series.dayHasData[i]) {
      evidence.belowCut++;
    } else {
      evidence.unavailable++;
    }
  }
  if (values.length > 0) {
    evidence.avg = values.reduce((a, b) => a + b, 0) / values.length;
    values.sort((a, b) => a - b);
    const mid = values.length >> 1;
    evidence.median =
      values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }
  return evidence;
}

/** States reached by actually comparing two well-covered windows. */
const COMPARED = new Set<TrendState>([
  "increase",
  "decrease",
  "stable",
  "low-volume",
  "spike",
]);

const meaningful = (w: WindowEvidence) =>
  w.count >= MEANINGFUL_COUNT || w.ms >= MEANINGFUL_MS;

function classify(
  recent: WindowEvidence,
  baseline: WindowEvidence,
  previouslyTracked: boolean,
): { state: TrendState; changePct: number | null } {
  if (recent.observed === 0) {
    return { state: recent.belowCut > 0 ? "below-cut" : "no-recent-data", changePct: null };
  }
  const recentCovered = recent.observed >= MIN_OBSERVED_DAYS;
  const baselineAvailable = baseline.days - baseline.unavailable;
  if (baselineAvailable < MIN_OBSERVED_DAYS) {
    // Too little was recorded for anyone in the baseline to say what this
    // signature looked like then. If it was seen on the few days there are,
    // it isn't new, the comparison is just short.
    return {
      state: baseline.observed === 0 ? "baseline-unavailable" : "incomplete",
      changePct: null,
    };
  }

  // Absent on the covered baseline days, or observed at roughly nothing. On
  // medians, so one big recent day can't make a steady hang look new.
  const absentBefore =
    baseline.count < NEW_BASELINE_MAX_COUNT ||
    (baseline.median ?? 0) < 0.05 * (recent.median ?? 0);
  if (absentBefore && recentCovered && meaningful(recent)) {
    if (!previouslyTracked) {
      return { state: "newly-tracked", changePct: null };
    }
    if (baseline.observed < MIN_OBSERVED_DAYS || baseline.avg === 0) {
      return { state: "tracked-again", changePct: null };
    }
    // A small but measured baseline is still a baseline. Compare it normally
    // rather than call a longstanding hang new because its volume rose 20x.
  }
  if (!recentCovered || baseline.observed < MIN_OBSERVED_DAYS) {
    return { state: "incomplete", changePct: null };
  }

  const recentAvg = recent.avg ?? 0;
  const baselineAvg = baseline.avg ?? 0;
  if (baselineAvg === 0) {
    return { state: recentAvg === 0 ? "stable" : "low-volume", changePct: null };
  }
  const changePct = (recentAvg - baselineAvg) / baselineAvg;
  if (Math.abs(changePct) < ELEVATED_PCT) {
    return { state: "stable", changePct };
  }
  if (!meaningful(recent) && !meaningful(baseline)) {
    return { state: "low-volume", changePct };
  }
  // A week's mean follows one bad day. Only call it a change when the typical
  // day moved the same way.
  const recentMedian = recent.median ?? 0;
  const baselineMedian = baseline.median ?? 0;
  const sustained =
    changePct > 0
      ? recentMedian > 0 && recentMedian >= baselineMedian * (1 + ELEVATED_PCT)
      : baselineMedian > 0 && recentMedian <= baselineMedian * (1 - ELEVATED_PCT);
  if (!sustained) {
    return { state: "spike", changePct };
  }
  return { state: changePct > 0 ? "increase" : "decrease", changePct };
}

/**
 * Summarize a series' change as of `endDate` (the build in view). Without an
 * `endDate` the comparison ends on the series' last day.
 */
export function computeTrend(
  series: ResolvedSeries,
  metric: Metric,
  { endDate }: { endDate?: string } = {},
): TrendSummary {
  const primary = metric === "ms" ? series.total.ms : series.total.count;
  const n = primary.length;

  const endIndex = endDate === undefined ? n - 1 : series.dates.indexOf(endDate);
  let peakIndex = -1;
  for (let i = 0; i <= endIndex; i++) {
    const value = primary[i];
    const best = primary[peakIndex];
    if (value != null && (best == null || value > best)) {
      peakIndex = i;
    }
  }
  const peak = {
    peakDate: series.dates[peakIndex] ?? "",
    peakValue: primary[peakIndex] ?? null,
    trackedStacks: series.members.length,
  };

  const recent = windowEvidence(series, primary, endIndex - WINDOW_DAYS + 1, endIndex);
  const baseline = windowEvidence(
    series,
    primary,
    endIndex - 2 * WINDOW_DAYS + 1,
    endIndex - WINDOW_DAYS,
  );
  if (endIndex < 0) {
    return {
      state: "outside-window",
      metric,
      endDate: null,
      recent,
      baseline,
      changePct: null,
      deltaPerDay: null,
      newSince: null,
      ...peak,
    };
  }

  // Apply the same evidence requirements to every hang, with or without a
  // Bugzilla association. A week containing earlier observations cannot
  // establish a current trend when the viewed build has no comparable sample.
  const currentUnmatched = series.coverage?.stacks === 0 ||
    (recent.observed > 0 && primary[endIndex] == null);
  const previouslyTracked = series.total.count.some((count, i) =>
    i < endIndex - WINDOW_DAYS + 1 && ((count ?? 0) > 0 || (series.total.ms[i] ?? 0) > 0),
  );
  const { state, changePct }: {state: TrendState; changePct: number | null} = currentUnmatched
    ? {state: "current-build-unmatched", changePct: null} : classify(recent, baseline, previouslyTracked);
  // Only where the windows were compared at all: a delta off one observed day
  // would read as a measurement it isn't.
  const deltaPerDay =
    COMPARED.has(state) && recent.avg != null && baseline.avg != null
      ? recent.avg - baseline.avg
      : null;

  let newSince: string | null = null;
  if (state === "newly-tracked") {
    const from = Math.max(0, endIndex - 2 * WINDOW_DAYS + 1);
    for (let i = from; i <= endIndex; i++) {
      if ((series.total.count[i] ?? 0) > 0) {
        newSince = series.dates[i];
        break;
      }
    }
  }

  return {
    state,
    metric,
    endDate: series.dates[endIndex],
    recent,
    baseline,
    changePct,
    deltaPerDay,
    newSince,
    ...peak,
  };
}

/** Bucket a trend for list filtering. Only credible changes count. */
export function trendCategory(trend: TrendSummary): TrendCategory {
  switch (trend.state) {
    case "increase":
      return "increase";
    case "decrease":
      return "decrease";
    case "newly-tracked":
      return "new";
    default:
      return "other";
  }
}

/** Compact badge text + color tone for a trend, e.g. list rows. */
export function trendBadge(trend: TrendSummary): { text: string; tone: TrendTone } {
  const pct =
    trend.changePct == null ? "" : `${Math.round(Math.abs(trend.changePct) * 100)}%`;
  switch (trend.state) {
    case "increase":
      return {
        text: `↑${pct}`,
        tone: (trend.changePct ?? 0) >= REGRESSION_PCT ? "red" : "amber",
      };
    case "decrease":
      return { text: `↓${pct}`, tone: "green" };
    case "stable":
      return { text: "stable", tone: "neutral" };
    case "low-volume":
      return { text: "low volume", tone: "neutral" };
    case "spike":
      return { text: "spike", tone: (trend.changePct ?? 0) > 0 ? "amber" : "neutral" };
    case "newly-tracked":
      return { text: "newly tracked", tone: "blue" };
    case "tracked-again":
      return { text: "tracked again", tone: "neutral" };
    case "baseline-unavailable":
      return { text: "no baseline", tone: "neutral" };
    case "incomplete": {
      const short =
        trend.recent.observed < MIN_OBSERVED_DAYS ? trend.recent : trend.baseline;
      return { text: `partial ${short.observed}/${short.days}d`, tone: "neutral" };
    }
    case "no-recent-data":
      return { text: "no recent data", tone: "neutral" };
    case "below-cut":
      return { text: "below cut", tone: "neutral" };
    case "outside-window":
      return { text: "no history", tone: "neutral" };
    case "current-build-unmatched":
      return { text: "history only", tone: "neutral" };
  }
}

/** One-line statement of what the trend means, for chips and bug comments. */
export function trendHeadline(trend: TrendSummary): string {
  const pct =
    trend.changePct == null ? "" : `${Math.round(Math.abs(trend.changePct) * 100)}%`;
  switch (trend.state) {
    case "increase":
      return `Increase of ${pct}`;
    case "decrease":
      return `Decrease of ${pct}`;
    case "stable":
      return "Stable";
    case "low-volume":
      return "Too few hangs to compare";
    case "spike": {
      const rising = (trend.changePct ?? 0) > 0;
      const where = rising ? trend.recent : trend.baseline;
      const when = where.maxDate ? ` on ${shortDate(where.maxDate)}` : "";
      if (rising && where.maxDate === trend.endDate) {
        // The jump is on the build itself; there are no later days to show
        // whether it lasts.
        return `Spike${when}, this build: too soon to call a trend`;
      }
      return rising
        ? `Spike${when}, not sustained`
        : `Earlier spike${when}, typical day unchanged`;
    }
    case "newly-tracked":
      return trend.newSince
        ? `Newly tracked since ${shortDate(trend.newSince)}`
        : "Newly tracked";
    case "baseline-unavailable":
      return "Baseline unavailable";
    case "tracked-again":
      return "Tracked again; activity exists in earlier history";
    case "incomplete":
      return "Incomplete comparison";
    case "no-recent-data":
      return "No recent data";
    case "below-cut":
      return "Below the tracking cut lately";
    case "current-build-unmatched":
      return "Historical data available; this build has no comparable tracked sample";
    case "outside-window":
      return "Build outside the history window";
  }
}

/** "Apr 24" from "20260424". */
function shortDate(date: string): string {
  return formatDateRange(date, date);
}

/** A per-day change in the metric's unit: "+12.3 s/day", "-40 hangs/day". */
export function formatDelta(delta: number, metric: Metric): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const magnitude = Math.abs(delta);
  if (metric === "ms") {
    const seconds = magnitude / 1000;
    const digits = seconds >= 100 ? 0 : 1;
    return `${sign}${seconds.toLocaleString(undefined, { maximumFractionDigits: digits })} s/day`;
  }
  return `${sign}${Math.round(magnitude).toLocaleString()} hangs/day`;
}

function describeWindow(label: string, w: WindowEvidence, unit: string): string {
  if (!w.start || !w.end) {
    return `${label}: before the history window`;
  }
  const gaps: string[] = [];
  if (w.belowCut > 0) {
    gaps.push(`${w.belowCut} below the tracking cut`);
  }
  if (w.unavailable > 0) {
    gaps.push(`${w.unavailable} with no data`);
  }
  const avg =
    w.avg == null || w.median == null
      ? ""
      : `, avg ${Math.round(w.avg).toLocaleString()} ${unit}/day` +
        ` (median ${Math.round(w.median).toLocaleString()})`;
  return (
    `${label} ${formatDateRange(w.start, w.end)}: ${w.observed}/${w.days} days observed` +
    (gaps.length ? ` (${gaps.join(", ")})` : "") +
    avg
  );
}

/**
 * The evidence behind a trend, as hover text: which days were compared, how
 * many of them were actually observed, the averages, and the absolute change.
 */
export function trendEvidence(trend: TrendSummary): string {
  if (trend.state === "outside-window") {
    return "This build isn't in the history window, so there is nothing to compare.";
  }
  const unit = trend.metric === "ms" ? "ms" : "hangs";
  const lines = [
    trendHeadline(trend),
    describeWindow("Recent", trend.recent, unit),
    describeWindow("Baseline", trend.baseline, unit),
  ];
  if (trend.deltaPerDay != null) {
    const pct =
      trend.changePct == null
        ? ""
        : ` (${trend.changePct >= 0 ? "+" : "-"}${Math.round(Math.abs(trend.changePct) * 100)}%)`;
    lines.push(`Change: ${formatDelta(trend.deltaPerDay, trend.metric)}${pct}`);
  }
  if (trend.state === "incomplete") {
    lines.push(`A change is stated once both windows have ${MIN_OBSERVED_DAYS} observed days.`);
  }
  return lines.join("\n");
}

/** The comparison as a single line: "Apr 24-30 vs Apr 17-23". */
export function comparisonSpan(trend: TrendSummary): string | null {
  const { recent, baseline } = trend;
  if (!recent.start || !recent.end) {
    return null;
  }
  const recentSpan = formatDateRange(recent.start, recent.end);
  return baseline.start && baseline.end
    ? `${recentSpan} vs ${formatDateRange(baseline.start, baseline.end)}`
    : recentSpan;
}

/**
 * A one-line note for a bug comment: the claim, the dates it compares, and the
 * coverage behind it, so a reader can judge it without the dashboard.
 */
export function trendSentence(trend: TrendSummary): string {
  const span = comparisonSpan(trend);
  const coverage =
    `recent ${trend.recent.observed}/${trend.recent.days} days observed, ` +
    (trend.baseline.days > 0
      ? `baseline ${trend.baseline.observed}/${trend.baseline.days}`
      : "baseline before the history window");
  const delta =
    trend.deltaPerDay != null &&
    (trend.state === "increase" || trend.state === "decrease")
      ? `, ${formatDelta(trend.deltaPerDay, trend.metric)}`
      : "";
  if (trend.state === "outside-window") {
    return trendHeadline(trend);
  }
  return `${trendHeadline(trend)} (${span ? `${span}; ` : ""}${coverage}${delta})`;
}
