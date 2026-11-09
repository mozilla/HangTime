/**
 * Per-hang prevalence over time, as daily bars: daily volume is noisy, and a
 * line reads every wobble as a movement. For a plain signature it's one series.
 * For a bug-merged signature each day's bar is the bug total, stacked from its
 * top contributing stacks plus the rest as "Other", so a regression in one
 * stack shows as its segment growing even when the bug total is flat. (The
 * total is exactly the sum of the members, so the stack adds up.)
 *
 * The legend is rendered as HTML rather than via Chart.js's canvas legend:
 * stack labels are long function signatures, and only DOM text can reliably
 * ellipsize them and expose the full signature on hover.
 */

import { useMemo, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { HangSignature } from "@/processing/types";
import type {
  MemberSeries,
  Metric,
  ResolvedSeries,
  TimeseriesIndex,
} from "@/data/timeseries";
import {
  comparisonSpan,
  computeTrend,
  formatDelta,
  trendBadge,
  trendEvidence,
  trendHeadline,
  type TrendTone,
} from "@/data/trend";
import { formatCount, formatDate, formatSeconds } from "@/format";
import {
  PHASE_META,
  releaseMarkersForDates,
  type ReleaseColumnMarker,
} from "@/data/releases";
import { ChartRangeControls, useChartRange, useDragZoom } from "./ChartRange";
import { useDailyChartWidth } from "./chartWidth";
import {
  BAR_SEPARATOR_COLOR,
  barBorderWidth,
  barGapPlugin,
  topSegmentRadius,
} from "./barStyle";
import { InfoTip } from "./InfoTip";
import { useTheme } from "@/state/theme";

/**
 * Draw a dashed vertical line at each Firefox train milestone that lands in the
 * visible window, so a spike or a newly appeared hang can be read against the
 * release (or the Beta / Nightly that preceded it) that may have caused it. Each
 * day's milestones are stacked as colored "Fx NN Release/Beta/Nightly" labels;
 * the line is colored by the most prominent milestone (release > beta > nightly).
 * Markers come through the chart's plugin options as `releaseMarkers.markers`.
 */
const releaseMarkersPlugin: Plugin<"bar"> = {
  id: "releaseMarkers",
  afterDatasetsDraw(chart) {
    const opts = (chart.options.plugins as Record<string, unknown> | undefined)
      ?.releaseMarkers as { markers?: ReleaseColumnMarker[]; colors?: Record<string, string> } | undefined;
    const markers = opts?.markers;
    if (!markers || markers.length === 0) {
      return;
    }
    const xScale = chart.scales.x;
    if (!xScale) {
      return;
    }
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textBaseline = "top";
    const mid = (chartArea.left + chartArea.right) / 2;
    // Rightmost pixel a label group has claimed, so a dense window (a year of
    // trains) drops whole groups rather than overprinting them into mush.
    let lastLabelEnd = -Infinity;
    for (const marker of markers) {
      const px = xScale.getPixelForValue(marker.index);
      if (px == null || Number.isNaN(px) || marker.events.length === 0) {
        continue;
      }
      // Line colored by the top-ranked milestone on this day (release first).
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = opts?.colors?.[marker.events[0].phase] ?? PHASE_META[marker.events[0].phase].color;
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();

      // Stacked, per-phase colored labels; keep them inside the plot area.
      ctx.setLineDash([]);
      const alignRight = px > mid;
      ctx.textAlign = alignRight ? "right" : "left";
      const labelX = alignRight ? px - 3 : px + 3;
      const labels = marker.events.map(
        (event) => `Fx ${event.version} ${PHASE_META[event.phase].label}`,
      );
      const width = Math.max(...labels.map((text) => ctx.measureText(text).width));
      const startX = alignRight ? labelX - width : labelX;
      if (startX < lastLabelEnd + 6) {
        continue;
      }
      lastLabelEnd = startX + width;
      marker.events.forEach((event, i) => {
        ctx.fillStyle = opts?.colors?.[event.phase] ?? PHASE_META[event.phase].color;
        ctx.fillText(labels[i], labelX, chartArea.top + 1 + i * 12);
      });
    }
    ctx.restore();
  },
};

Chart.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  barGapPlugin,
  releaseMarkersPlugin,
);

/**
 * Member stacks of a bug, in fixed order (blue, orange, aqua, yellow, magenta).
 * Checked with the dataviz palette validator: colorblind-safe between
 * neighbours, but three are under 3:1 against white, so every value is also in
 * the tooltip and the member list.
 */
const MEMBER_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const DARK_MEMBER_COLORS = ["#64a8ff", "#ff9f66", "#65d6b0", "#f2cd70", "#ef9ac3"];
/** The members past the top few, summed: neutral, so it recedes. */
const OTHER_COLOR = "#c2c2cb";
const MAX_MEMBER_LINES = MEMBER_COLORS.length;

interface LegendItem {
  label: string;
  title: string;
  color: string;
}

interface TimeseriesChartProps {
  index: TimeseriesIndex | undefined;
  signature: HangSignature;
  /** The build in view; the trend chips compare the week ending on it. */
  endDate: string;
}

/** Full stack as a multi-line leaf->root list, for a legend item's hover title. */
function stackPath(member: MemberSeries): string {
  return member.frames.map((frame) => frame[0]).join("\n");
}

/** Drop a function signature's argument list so labels stay compact. */
function shortFunc(name: string): string {
  const paren = name.indexOf("(");
  // paren === 0 is a sentinel like "(root)" / "(unresolved)" — leave it intact.
  return paren <= 0 ? name : name.slice(0, paren);
}

/** A real symbol, not an empty or sentinel ("(root)", "(unresolved)") frame. */
function isMeaningful(name: string | undefined): name is string {
  return !!name && !name.startsWith("(");
}

/**
 * Short, scannable label per member: the leaf frame (what's actually stuck),
 * argument list stripped. Bug-merged members usually share a leaf, so when one
 * isn't distinguished at the leaf we append the first meaningful caller above
 * the point where its stack diverges from the others — "what's stuck · where
 * from". The full stack stays in the legend item's hover title.
 */
function memberLabels(members: MemberSeries[]): string[] {
  const names = members.map((m) => m.frames.map((frame) => frame[0]));
  return names.map((mine, idx) => {
    const leaf = shortFunc(mine[0] ?? "(root)");

    // Depth where mine's leaf-rooted prefix first becomes unique among members.
    let divergence = mine.length - 1;
    for (let depth = 0; depth < mine.length; depth++) {
      const unique = names.every((other, j) => {
        if (j === idx) {
          return true;
        }
        for (let i = 0; i <= depth; i++) {
          if (other[i] !== mine[i]) {
            return true; // diverges within the prefix — not a conflict
          }
        }
        return false; // shares mine's whole prefix through `depth`
      });
      if (unique) {
        divergence = depth;
        break;
      }
    }

    if (divergence === 0) {
      return leaf; // the leaf alone already distinguishes this member
    }
    for (let i = divergence; i < mine.length; i++) {
      if (isMeaningful(mine[i])) {
        const context = shortFunc(mine[i]);
        return context === leaf ? leaf : `${leaf} · ${context}`;
      }
    }
    return leaf;
  });
}


export function TimeseriesChart({ index, signature, endDate }: TimeseriesChartProps) {
  const dark = useTheme() === "dark";
  const memberColors = dark ? DARK_MEMBER_COLORS : MEMBER_COLORS;
  const textColor = dark ? "#b0b0b6" : "#6e6e73";
  const surfaceColor = dark ? "#1c1c1e" : BAR_SEPARATOR_COLOR;
  const [metric, setMetric] = useState<Metric>("ms");
  const [showAll, setShowAll] = useState(false);
  const [showReleases, setShowReleases] = useState(false);
  // A build that is absent from the history must not fall back to future dates.
  const availableDays = index?.dates.filter(date => date <= endDate).length ?? 0;
  const { range, setRange, reset } = useChartRange(availableDays, 30);
  const { chartRef, dragProps, marquee } = useDragZoom(range, setRange);
  const { scrollRef, minWidth } = useDailyChartWidth(range.end - range.start + 1);

  const series = useMemo<ResolvedSeries | null>(
    () => (index ? index.resolveSignature(signature) : null),
    [index, signature],
  );

  if (!index) {
    return null;
  }
  if (!series) {
    return (
      <div className="detail-section" data-section="History">
        <h3>History</h3>
        <p className="muted">
          No history for this hang: none of its stacks is among the stacks the
          history tracks, which are the top few hundred over the window.
        </p>
      </div>
    );
  }

  if (availableDays === 0) {
    return <div className="detail-section" data-section="History"><h3>History</h3>
      <p className="muted">No history is available at or before the selected build.</p></div>;
  }

  const showMembers = series.members.length > 1;
  // Every series is clipped to the visible range; the trend chips stay computed
  // over the whole window, since zooming is a viewing choice, not a filter.
  const clip = <T,>(values: T[]) => values.slice(range.start, range.end + 1);
  const pick = (s: { ms: (number | null)[]; count: (number | null)[] }) =>
    clip(metric === "ms" ? s.ms : s.count);
  const dates = clip(series.dates);
  // Tooltips index into the clipped axis, so the per-day user counts they read
  // have to be clipped to match.
  const affected = series.total.affected && clip(series.total.affected);
  const totalAffected = series.totalAffected && clip(series.totalAffected);

  const trend = computeTrend(series, metric, { endDate });
  const unit = metric === "ms" ? "ms" : "hangs";
  const fmt = (v: number) => Math.round(v).toLocaleString();

  // The claim, then the dates it compares, so the evidence is on screen rather
  // than only in a hover.
  const chips: { text: string; tone: TrendTone; title?: string }[] = [];
  const span = comparisonSpan(trend);
  const delta =
    trend.deltaPerDay != null && (trend.state === "increase" || trend.state === "decrease")
      ? `, ${formatDelta(trend.deltaPerDay, metric)}`
      : "";
  chips.push({
    text:
      trend.state === "increase" || trend.state === "decrease"
        ? `${trendBadge(trend).text}${delta}`
        : trendHeadline(trend),
    tone: trendBadge(trend).tone,
    title: trendEvidence(trend),
  });
  if (span) {
    const { recent, baseline } = trend;
    const coverage =
      baseline.days > 0
        ? `${recent.observed}/${recent.days} and ${baseline.observed}/${baseline.days} days observed`
        : `${recent.observed}/${recent.days} days observed`;
    chips.push({ text: `${span} · ${coverage}`, tone: "neutral", title: trendEvidence(trend) });
  }
  if (trend.peakValue != null) {
    chips.push({
      text: `Peak ${formatDate(trend.peakDate)}`,
      tone: "neutral",
      title: `${fmt(trend.peakValue)} ${unit}`,
    });
  }
  if (showMembers) {
    chips.push({ text: `${trend.trackedStacks} tracked stacks`, tone: "neutral" });
  }

  const datasets: ChartData<"bar">["datasets"] = [];
  const legend: LegendItem[] = [];

  const addBars = (
    label: string,
    title: string,
    data: (number | null)[],
    color: string,
    extra: object = {},
  ) => {
    datasets.push({
      label,
      // A null day is missing data, not zero: it simply has no bar.
      data,
      backgroundColor: color,
      borderRadius: topSegmentRadius,
      borderSkipped: false,
      borderColor: surfaceColor,
      borderWidth: barBorderWidth,
      ...extra,
    });
    legend.push({ label, title, color });
  };

  // Labels are computed across ALL members (not just the charted top-5) so the
  // legend and the "show all" list stay consistent.
  const memberLabelsAll = showMembers ? memberLabels(series.members) : [];

  if (showMembers) {
    const shown = series.members.slice(0, MAX_MEMBER_LINES);
    shown.forEach((member, i) => {
      addBars(
        `#${i + 1} ${memberLabelsAll[i]}`,
        stackPath(member),
        pick(member),
        memberColors[i],
        { stack: "members" },
      );
    });
    const rest = series.members.slice(MAX_MEMBER_LINES);
    if (rest.length > 0) {
      // Whatever the top members don't account for. Null where none of the
      // rest has data that day, so it draws nothing rather than a zero.
      const restTotal = pick(series.total).map((total, day) => {
        let others: number | null = null;
        for (const member of rest) {
          const value = pick(member)[day];
          if (value != null) {
            others = (others ?? 0) + value;
          }
        }
        return total == null ? null : others;
      });
      addBars(
        `Other ${rest.length} stack${rest.length === 1 ? "" : "s"}`,
        `The ${rest.length} smaller stacks merged into this bug, summed`,
        restTotal,
        dark ? "#636366" : OTHER_COLOR,
        { stack: "members" },
      );
    }
  } else {
    const only = series.members[0];
    addBars(shortFunc(only.label), stackPath(only), pick(only), dark ? "#64a8ff" : "#0250bb");
  }
  const dayTotals = pick(series.total);

  const data: ChartData<"bar"> = {
    labels: dates.map(formatDate),
    datasets,
  };

  // Firefox releases that fall inside the visible window, drawn as dashed
  // vertical markers by releaseMarkersPlugin.
  const releaseMarkers = showReleases ? releaseMarkersForDates(dates) : [];
  const markerByIndex = new Map(releaseMarkers.map((m) => [m.index, m]));

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: dark ? "#2c2c2e" : "#1d1d1f",
        titleColor: "#f5f5f7",
        bodyColor: "#f5f5f7",
        footerColor: "#f5f5f7",
        borderColor: dark ? "#48484a" : "#1d1d1f",
        borderWidth: 1,
        // Only the stacks that had something that day.
        filter: (item) => item.raw != null && item.raw !== 0,
        callbacks: {
          // Surface the train milestones on the tooltip title when the hovered
          // day carries one, so the marker is identifiable without a legend.
          title: (items) => {
            const base = items[0]?.label ?? "";
            const marker = markerByIndex.get(items[0]?.dataIndex ?? -1);
            if (!marker) {
              return base;
            }
            const parts = marker.events.map(
              (e) => `Fx ${e.version} ${PHASE_META[e.phase].label}`,
            );
            return `${base}  ·  ${parts.join(", ")}`;
          },
          label: (ctx) => {
            const value = ctx.parsed.y ?? 0;
            return `${ctx.dataset.label}: ${value.toLocaleString()} ${unit}`;
          },
          // A stacked bar's height is the bug total; say it, since no single
          // segment does.
          footer: (items) => {
            if (!showMembers) {
              return "";
            }
            const total = dayTotals[items[0]?.dataIndex ?? -1];
            return total == null ? "" : `Total: ${total.toLocaleString()} ${unit}`;
          },
          // Append that single day's distinct affected clients (and their share
          // of the day's hang-reporting clients) when the artifact carried
          // client metrics.
          afterBody: (items) => {
            if (!affected) {
              return "";
            }
            const i = items[0]?.dataIndex ?? 0;
            const clients = affected[i];
            if (clients == null) {
              return "Clients affected: no data for this day";
            }
            const dayTotal = totalAffected?.[i];
            const share =
              dayTotal != null && dayTotal > 0
                ? ` (${((clients / dayTotal) * 100).toFixed(2)}% of hang-reporting clients)`
                : "";
            const bound = showMembers ? "up to " : "";
            return `Clients affected: ${bound}${clients.toLocaleString()}${share}`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        border: { color: dark ? "#38383a" : "#e8e8ed" },
        ticks: { color: textColor, maxRotation: 0, autoSkip: true, autoSkipPadding: 14, maxTicksLimit: 8 },
      },
      y: {
        grid: { color: dark ? "#38383a" : "#e8e8ed" },
        border: { display: false },
        stacked: true,
        beginAtZero: true,
        // A chart too wide for its box opens scrolled to the newest days, so
        // the axis goes on that side to stay in view.
        position: minWidth ? "right" : "left",
        // The chart is kept short (it's for the shape of the trend and the
        // volume, not reading values off), so: a few ticks, in compact form
        // ("16M"), and no axis title; the ms/count toggle names the unit and the
        // tooltip gives exact values.
        ticks: {
          color: textColor,
          maxTicksLimit: 3,
          callback: (value) =>
            Number(value).toLocaleString(undefined, {
              notation: "compact",
              maximumFractionDigits: 1,
            }),
        },
      },
    },
  };
  // Custom plugin options (not part of Chart.js's typed plugin map).
  (options.plugins as Record<string, unknown>).releaseMarkers = {
    markers: releaseMarkers,
    colors: dark ? { beta: "#f2bd68", nightly: "#64a8ff", release: "#77d99c" } : undefined,
  };

  return (
    <div className="detail-section" data-section="History">
      <div className="ts-header">
        <h3>
          History ({dates.length} days)
          <InfoTip label="History">
            Daily hang time (or count) for this signature across the window, so
            you can see if it’s rising, spiking, or newly appeared. Use the
            ms/count toggle to switch metric, a preset window to narrow the
            range, or drag across the chart to zoom into one. The chips compare
            the 7 days ending on this build with the 7 before, and say how many
            days of each this hang was actually recorded on.
            <span className="eg">
              For a tagged bug, history includes the stored stacks matching its
              current Bugzilla tags, independently of the viewed build’s stacks.
              For other hangs, history is joined by stack shape, ignoring names a
              build can change without changing the code path (a renumbered
              lambda, a moved line in a JS file), so a hang keeps its history
              across those builds.
              Shape matching is heuristic: distinct call sites can share a shape.
            </span>
            <span className="eg">
              For a bug that covers several stacks, each bar sums its tracked stacks,
              split into its biggest stacks (the rest are summed as{" "}
              <em>Other</em>). Untracked stacks are excluded, so this can be a partial
              view of the bug. Tick <em>Fx releases</em> to mark
              the Firefox train milestones (<code>Fx NN</code>) as vertical
              lines, so a spike or a new hang can be lined up against a release:{" "}
              <em style={{ color: "var(--orange)" }}>orange = Release</em>,{" "}
              <em style={{ color: "var(--blue)" }}>blue = Beta</em>,{" "}
              <em style={{ color: "var(--green)" }}>green = Nightly</em>.
              {affected && (
                <>
                  {" "}
                  Hover a day to also see the distinct clients affected that day,
                  out of the clients that sent hang reports.
                </>
              )}
            </span>
          </InfoTip>
        </h3>
        <div className="chart-tools">
          <ChartRangeControls
            length={availableDays}
            range={range}
            onChange={setRange}
            onReset={reset}
          />
          <label
            className="chart-check"
            title="Mark the Firefox Nightly / Beta / Release milestones"
          >
            <input
              type="checkbox"
              checked={showReleases}
              onChange={(e) => setShowReleases(e.target.checked)}
            />
            Fx releases
          </label>
          <div className="ts-toggle">
            <button
              className={metric === "ms" ? "active" : ""}
              onClick={() => setMetric("ms")}
            >
              ms
            </button>
            <button
              className={metric === "count" ? "active" : ""}
              onClick={() => setMetric("count")}
            >
              count
            </button>
          </div>
        </div>
      </div>
      <div className="ts-chips">
        {chips.map((chip, i) => (
          <span key={i} className={`chip ${chip.tone}`} title={chip.title}>
            {chip.text}
          </span>
        ))}
      </div>
      <HistoryNotes series={series} />
      <div ref={scrollRef} className="chart-scroll">
        <div className="ts-chart chart-zoomable" style={{ minWidth }} {...dragProps}>
          <Bar ref={chartRef} data={data} options={options} />
          {marquee}
        </div>
      </div>
      <div className="ts-legend">
        {legend.map((item) => (
          <div className="ts-legend-item" key={item.label} title={item.title}>
            <span
              className="ts-legend-swatch"
              style={{ backgroundColor: item.color }}
            />
            <span className="ts-legend-label">{item.label}</span>
          </div>
        ))}
      </div>
      {showMembers && (
        <div className="member-detail">
          <p className="muted">
            {series.members.length} stacks merged into this bug
            {series.members.length > MAX_MEMBER_LINES && (
              <> · showing the top {MAX_MEMBER_LINES} on the chart</>
            )}
            .
            {series.members.length > MAX_MEMBER_LINES && (
              <>
                {" "}
                <button className="link" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${series.members.length}`}
                </button>
              </>
            )}
          </p>
          {showAll && (
            <ol className="member-list">
              {series.members.map((member, i) => (
                <li key={member.key} title={stackPath(member)}>
                  <span
                    className="member-rank"
                    style={{
                      color:
                        i < MAX_MEMBER_LINES ? memberColors[i] : "var(--muted-2)",
                    }}
                  >
                    #{i + 1}
                  </span>
                  <span className="member-name">{memberLabelsAll[i]}</span>
                  <span className="member-stat">
                    {formatSeconds(member.totalMs)}s ·{" "}
                    {formatCount(member.totalCount)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the bars do and don't include, said up front: a bug folds in many
 * stacks and the history keeps only the top tracked ones. Current-build
 * overlap is reported separately from the historical bug cohort.
 */
function HistoryNotes({ series }: { series: ResolvedSeries }) {
  const { coverage, filledDate, association } = series;
  const partial = coverage.share < 0.95;
  if (!partial && !filledDate && !association) {
    return null;
  }
  const pct = coverage.share.toLocaleString(undefined, {
    style: "percent",
    maximumFractionDigits: coverage.share < 0.1 ? 1 : 0,
  });
  return (
    <div className="ts-notes">
      {association && <p>
        History for Bug {association.bugId} · {association.stacks} stored stacks
        <InfoTip label="Historical bug association">
          Historical stacks are matched using this bug’s current Bugzilla tags,
          independently of which stacks appear on the viewed build.
          <p><code>{association.tags.join(" ")}</code></p>
          <p>This is a tracked subset, not a complete bug total. The tags describe
          today’s association, not a record of past bug ownership. Current-build
          shape overlap is reported separately below.</p>
        </InfoTip>
      </p>}
      {association && coverage.stacks === 0 && <p>
        Historical data retained; this build has no matching stacks. Missing
        values remain gaps, and no current trend is claimed.
      </p>}
      {partial && (
        <p>
          Current-build overlap: {coverage.stacks.toLocaleString()} of this hang&rsquo;s{" "}
          {coverage.totalStacks.toLocaleString()} stacks, {pct} of its time on this
          build. History includes only the stacks retained by the publisher;
          coverage can vary between builds.
        </p>
      )}
      {filledDate && (
        <p>
          {formatDate(filledDate)} is this build&rsquo;s own data: the history has
          these stacks under the names earlier builds gave them (a renumbered lambda,
          a moved JS line) and hasn&rsquo;t recorded this build&rsquo;s yet.
        </p>
      )}
    </div>
  );
}
