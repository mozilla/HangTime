/**
 * Where a build's hang time goes: by area of the browser (fonts, the startup
 * cache, the OS shell, navigation...), by mechanism (file I/O, lock waits,
 * synchronous IPC...), and by when it happens (startup, while the user was
 * interacting). Each row opens Top Hangs narrowed to it. Above them, the
 * saved investigations as a queue, and a note of what the data does and
 * doesn't cover.
 *
 * Replaces the old Overview page, whose summaries repeated the hang list and
 * whose volume chart summed only the signatures the timeseries happens to
 * retain, so a change in coverage looked like a change in browser health.
 */

import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useBugs, useProcessedProfile, useTimeseries, useTrendById } from "@/queries/hooks";
import { useViewState } from "@/state/useViewState";
import type { ThreadKind } from "@/data/dataSource";
import type { HangSignature } from "@/processing/types";
import { byArea, byContext, byMechanism, type BreakdownRow } from "@/data/areaBreakdown";
import { NO_AREA } from "@/data/hangAreas";
import { PLATFORMS, platformLabel, type Platform } from "@/data/platforms";
import { formatCount, formatDateRange, formatSeconds, formatShare } from "@/format";
import { narrowSignatures } from "@/processing/select";
import { INVESTIGATIONS, investigationNarrowing } from "@/data/investigations";
import { formatDelta, type TrendSummary } from "@/data/trend";
import type { TimeseriesIndex } from "@/data/timeseries";
import type { ProcessedProfile } from "@/processing/types";
import { BuildBar } from "@/components/BuildBar";
import { InfoTip } from "@/components/InfoTip";
import { LoadingProgress } from "@/components/LoadingProgress";

/** Enough to scan the largest contributors, with the full breakdown one click away. */
const TOP_ROWS = 8;

export function Areas() {
  const { state, update } = useViewState();
  const { search } = useLocation();
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);
  const timeseries = useTimeseries(state.thread as ThreadKind);
  const bugs = useBugs();
  const trendById = useTrendById(query.data, timeseries.data, "ms", bugs.data);
  const platform = state.platform;

  // On one platform, every number is that platform's share of each hang.
  const measures = useMemo(
    () =>
      platform
        ? {
            durationOf: (sig: HangSignature) => sig.platformMs[platform] ?? 0,
            countOf: (sig: HangSignature) => sig.platformStats[platform] ?? 0,
          }
        : {
            durationOf: (sig: HangSignature) => sig.duration,
            countOf: (sig: HangSignature) => sig.count,
          },
    [platform],
  );
  const breakdowns = useMemo(() => {
    if (!query.data) {
      return null;
    }
    const sigs = query.data.signatures;
    const areas = byArea(sigs, measures);
    return {
      areas,
      mechanisms: byMechanism(sigs, measures),
      contexts: byContext(sigs, measures),
      total: areas.reduce((sum, row) => sum + row.ms, 0),
      unattributed: areas.find((row) => row.key === NO_AREA)?.ms ?? 0,
    };
  }, [query.data, measures]);

  if (query.isError) {
    return (
      <div className="view-state">
        <BuildBar />
        <div className="state-msg error">
          Failed to load data: {(query.error as Error).message}
        </div>
      </div>
    );
  }
  if (!query.data || !breakdowns) {
    return (
      <div className="view-state">
        <BuildBar />
        <LoadingProgress thread={state.thread} date={state.date} />
      </div>
    );
  }
  const { areas, mechanisms, contexts, total, unattributed } = breakdowns;

  return (
    <div className="areas-page">
      <BuildBar date={query.data.date} />
      <div className="areas-intro">
        <div>
          <span className="eyebrow">Build analysis</span>
          <h1>Areas</h1>
          <p>See where hang time accumulates. Choose a starting point to investigate.</p>
        </div>
        <label className="control">
          Platform
          <select
            value={platform ?? "all"}
            onChange={(e) =>
              update({ platform: e.target.value === "all" ? null : (e.target.value as Platform) })
            }
          >
            <option value="all">All platforms</option>
            {PLATFORMS.map((os) => (
              <option key={os} value={os}>
                {platformLabel(os)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="areas-total">
        <span><strong>{formatSeconds(total)}<small> s</small></strong> observed hang time</span>
        <span>{formatCount(areas.reduce((sum, row) => sum + row.count, 0))} sampled hangs</span>
        <span>Grouped from stacks, not confirmed causes</span>
      </div>
      <div className="areas-grid areas-bento">
        <BreakdownCard
          title="By area"
          info={
            <>
              The part of the browser each hang belongs to: the innermost frame on its
              stack that names one (a font list, the startup cache, the taskbar). Under
              each area, the mechanisms that make up most of its time. The grey figure is
              the share of its time in hangs no bug tracks yet.
              <span className="eg">
                <b>Unattributed</b> hangs have no frame any rule recognises, usually
                because the stack is all event-loop and system code.
              </span>
            </>
          }
          rows={areas}
          total={total}
          param="area"
        />
        <InvestigationQueue
          profile={query.data}
          trendById={trendById}
          hasHistory={!!timeseries.data}
          platform={platform}
          durationOf={measures.durationOf}
          total={total}
        />
        <BreakdownCard
          title="By mechanism"
          info={
            <>
              How the thread was stuck where it was sampled: inside a file operation,
              waiting on a lock, waiting for another process over synchronous IPC, or
              simply running code (CPU work). Under each, the areas it happens in. The
              grey figure is the share of its time in hangs no bug tracks yet.
              <span className="eg">
                A file operation on the stack says where the thread was, not that the
                disk was slow: antivirus, network drives and locks stall there too.
              </span>
            </>
          }
          rows={mechanisms}
          total={total}
          param="mechanism"
        />
        <ContextCard rows={contexts} total={total} />
        <DataCard
          profile={query.data}
          index={timeseries.data}
          bugsFailed={bugs.isError}
          unattributed={unattributed}
          total={total}
        />
      </div>
      <p className="areas-note">
        Areas and mechanisms are read from function and library names, since the hang
        data carries no source paths. See the{" "}
        <Link to={{ pathname: "/guide", search }}>
          Guide
        </Link>{" "}
        for how it works.
      </p>
    </div>
  );
}

/** A Top Hangs link narrowed to one row, keeping the build, thread and platform. */
function useNarrowedLink() {
  const { search } = useLocation();
  return (param: "area" | "mechanism" | "context", value: string) => {
    const next = new URLSearchParams();
    const current = new URLSearchParams(search);
    for (const keep of ["thread", "date", "platform"]) {
      const v = current.get(keep);
      if (v) {
        next.set(keep, v);
      }
    }
    next.set(param, value);
    return { pathname: "/top-hangs", search: `?${next}` };
  };
}

function BreakdownCard<K extends string>({
  title,
  info,
  rows,
  total,
  param,
}: {
  title: string;
  info: React.ReactNode;
  rows: BreakdownRow<K>[];
  total: number;
  param: "area" | "mechanism";
}) {
  const [showAll, setShowAll] = useState(false);
  const linkTo = useNarrowedLink();
  const shown = showAll ? rows : rows.slice(0, TOP_ROWS);
  const max = rows[0]?.ms ?? 0;
  const pct = formatShare;

  return (
    <section className={`ov-card breakdown-card breakdown-${param}`}>
      <div className="ov-card-head">
        <h2>
          {title}
          <InfoTip label={title}>{info}</InfoTip>
        </h2>
        <span className="areas-col-head">Hang time / no bug</span>
      </div>
      <ol className="breakdown">
        {shown.map((row) => (
          <li key={row.key}>
            <Link
              className="breakdown-row"
              to={linkTo(param, row.key)}
              title={
                `${row.label}: ${formatSeconds(row.ms)} s over ${formatCount(row.count)} hangs ` +
                `in ${formatCount(row.signatures)} signatures; ` +
                `${pct(row.untrackedMs, row.ms)} of it in hangs no bug tracks yet`
              }
            >
              <span className="breakdown-label">{row.label}</span>
              <span className="breakdown-track">
                <span
                  className="breakdown-fill"
                  style={{ width: `${max > 0 ? (row.ms / max) * 100 : 0}%` }}
                />
              </span>
              <span className="breakdown-share">{pct(row.ms, total)}</span>
              <span className="breakdown-untracked">{pct(row.untrackedMs, row.ms)}</span>
              <span className="breakdown-parts">
                {row.parts.map((part) => `${part.label} ${pct(part.ms, row.ms)}`).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {rows.length > TOP_ROWS && (
        <button className="link breakdown-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

function ContextCard({
  rows,
  total,
}: {
  rows: { key: string; label: string; ms: number; signatures: number }[];
  total: number;
}) {
  const linkTo = useNarrowedLink();
  return (
    <section className="ov-card context-card">
      <div className="ov-card-head">
        <h2>
          Context
          <InfoTip label="When">
            Hang time in hangs where most reports carry a flag Firefox records with
            the hang: during startup or shutdown, while the user was interacting, with
            a paint pending, or while other applications kept the CPU busy.
            <span className="eg">
              A hang can carry several flags, so these don&rsquo;t add up to 100%. A
              report without a flag is unknown, not &ldquo;no&rdquo;: older builds
              record fewer of them.
            </span>
          </InfoTip>
        </h2>
      </div>
      <p className="card-description">Hang time in signatures where most reports carry each flag. Groups overlap.</p>
      {rows.length === 0 ? (
        <p className="ov-empty">No hang on this build carries a context flag on most reports.</p>
      ) : (
        <ul className="context-tiles">
          {rows.map((row) => (
            <li key={row.key}>
              <Link to={linkTo("context", row.key)} className="context-tile">
                <span className="context-share">{formatShare(row.ms, total)}</span>
                <span className="context-label">{row.label}</span>
                <span className="context-sub">{formatCount(row.signatures)} signatures</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The saved investigations as a queue: how many hangs each finds on this build
 * and how much of the hang time they hold, so the first question to ask is
 * the one with the most behind it.
 */
function InvestigationQueue({
  profile,
  trendById,
  hasHistory,
  platform,
  durationOf,
  total,
}: {
  profile: ProcessedProfile;
  trendById: Map<string, TrendSummary | null>;
  hasHistory: boolean;
  platform: Platform | null;
  durationOf: (sig: HangSignature) => number;
  total: number;
}) {
  const { search } = useLocation();
  const rows = useMemo(
    () =>
      INVESTIGATIONS.map((inv) => {
        const sigs = narrowSignatures(
          profile,
          { ...investigationNarrowing(inv), filter: "", platform },
          trendById,
        );
        let ms = 0;
        let added = 0;
        for (const sig of sigs) {
          ms += durationOf(sig);
          added += trendById.get(sig.id)?.deltaPerDay ?? 0;
        }
        return { inv, signatures: sigs.length, ms, added };
      }),
    [profile, trendById, platform, durationOf],
  );
  const linkTo = (inv: (typeof INVESTIGATIONS)[number]) => {
    const current = new URLSearchParams(search);
    const next = new URLSearchParams();
    for (const keep of ["thread", "date", "platform"]) {
      const v = current.get(keep);
      if (v) {
        next.set(keep, v);
      }
    }
    for (const [key, value] of Object.entries(investigationNarrowing(inv))) {
      if (value !== null && value !== "all") {
        next.set(key, value);
      }
    }
    if (inv.sort && inv.sort !== "time") {
      next.set("sort", inv.sort);
    }
    return { pathname: "/top-hangs", search: `?${next}` };
  };

  return (
    <section className="ov-card investigations-card">
      <div className="ov-card-head">
        <h2>
          Start an investigation
          <InfoTip label="Investigations">
            Common starting points, each a preset of the Top Hangs filters (also under{" "}
            <b>Investigation</b> there). The figures are how many hangs each finds on
            this build and their share of its hang time.
            <span className="eg">
              Credible increases also show the hang time they added per day against the
              week before: a big rise on a small hang matters less than a modest one on
              a heavy hang.
            </span>
          </InfoTip>
        </h2>
      </div>
      <p className="card-description">Focused views, ranked by observed impact.</p>
      <ul className="queue">
        {rows.map(({ inv, signatures, ms, added }) => {
          const unavailable = inv.needsHistory && !hasHistory;
          return (
            <li key={inv.id}>
              {unavailable ? (
                <span className="queue-row disabled" title="Needs the timeseries data">
                  <span className="queue-label">{inv.label}</span>
                  <span className="queue-stat">no history</span>
                </span>
              ) : (
                <Link
                  className={`queue-row${signatures === 0 ? " empty" : ""}`}
                  to={linkTo(inv)}
                  title={inv.blurb}
                >
                  <span className="queue-label">{inv.label}</span>
                  <span className="queue-stat">
                    {formatCount(signatures)} signature{signatures === 1 ? "" : "s"}
                  </span>
                  <span className="queue-stat">{formatShare(ms, total)}</span>
                  <span className="queue-extra">
                    {inv.id === "increases" && added > 0 ? formatDelta(added, "ms") : ""}
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * What the numbers on this build do and don't cover, so a gap in the data
 * isn't read as a change in the browser.
 */
function DataCard({
  profile,
  index,
  bugsFailed,
  unattributed,
  total,
}: {
  profile: ProcessedProfile;
  index: TimeseriesIndex | undefined;
  bugsFailed: boolean;
  unattributed: number;
  total: number;
}) {
  const covered = useMemo(() => {
    if (!index) return 0;
    index.bind(profile);
    let ms = 0;
    for (const sig of profile.signatures) {
      ms += sig.duration * index.coverageForSignature(sig).share;
    }
    return ms;
  }, [index, profile]);
  let history: React.ReactNode = "Not loaded, so trends are unavailable.";
  if (index) {
    const recorded = index.dates.filter((_, i) => index.dayHasData[i]);
    history = recorded.length ? (
      <>
        {formatDateRange(recorded[0], recorded[recorded.length - 1])}, with data on{" "}
        {recorded.length} of {index.dates.length} days. Only each day&rsquo;s top
        hangs are kept. Matching stacks cover {formatShare(covered, profile.totalDuration)} of
        this build&rsquo;s hang time across all platforms. Historical days can be partial;
        a missing stack may have fallen below the cut.
      </>
    ) : (
      "No day in the window has data."
    );
  }
  let tracked = 0;
  for (const sig of profile.signatures) {
    if (sig.knownBug) {
      tracked += sig.duration;
    }
  }

  return (
    <section className="ov-card data-card">
      <div className="ov-card-head">
        <h2>
          Read the data with context
          <InfoTip label="About this data">
            What this build&rsquo;s numbers cover. Counts and hang time depend on how
            many people ran the build and how many reports arrived, so they compare
            within a build better than across builds.
          </InfoTip>
        </h2>
      </div>
      <dl className="data-facts">
        <dt>History</dt>
        <dd>{history}</dd>
        <dt>Bugs</dt>
        <dd>
          {bugsFailed
            ? "The Bugzilla list didn't load, so hangs aren't merged by bug."
            : `${formatShare(tracked, profile.totalDuration)} of hang time is in hangs a bug ` +
              "tracks."}
        </dd>
        <dt>Areas</dt>
        <dd>{formatShare(unattributed, total)} of hang time has no recognised area.</dd>
        <dt>Clients</dt>
        <dd>
          {profile.affectedClientsTotal == null
            ? "Affected-client counts aren't in this build's data."
            : "Affected-client counts are shares of clients that sent hang reports, " +
              "not of all users."}
        </dd>
      </dl>
    </section>
  );
}
