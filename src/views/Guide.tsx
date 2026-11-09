/**
 * The Guide tab: what HangTime shows, where the numbers come from, and a
 * walk-through of each view. Static content, so it reads fine while the day's
 * artifact is still loading behind it.
 *
 * The app runs under a HashRouter, so in-page anchors (#section) would be read
 * as routes; the contents list scrolls to each section instead.
 */

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

const ISSUES_URL = "https://github.com/mozilla/HangTime/issues/new/choose";

const SECTIONS: { id: string; title: string }[] = [
  { id: "about", title: "What is HangTime?" },
  { id: "quick-start", title: "Quick start" },
  { id: "top-hangs-page", title: "The Top Hangs page" },
  { id: "areas-page", title: "The Areas page" },
  { id: "hang-detail", title: "Reading a hang's details" },
  { id: "describing", title: "How a hang is described" },
  { id: "trends", title: "How trends are worked out" },
  { id: "annotations", title: "Hang annotations" },
  { id: "builds", title: "Builds and shareable links" },
  { id: "glossary", title: "Glossary" },
  { id: "help", title: "Questions and feedback" },
];

/**
 * Every hang annotation Firefox can record, found by searching mozilla-central
 * (2026-09-18) for BackgroundHangAnnotator implementations, AddAnnotation
 * calls, and annotations built directly in the hang monitor. The aggregation
 * job passes them through unchanged.
 */
const ANNOTATIONS: {
  name: string;
  where?: string;
  meaning: ReactNode;
  example: ReactNode;
}[] = [
  {
    name: "PaintPending",
    meaning: (
      <>
        A repaint was waiting when the hang started, so the screen stayed frozen
        on its last frame. Most hangs delay a paint, so most carry this; one{" "}
        <em>without</em> it is the unusual case.
      </>
    ),
    example: (
      <>
        A page changes what's on screen, then runs a script for two seconds. The
        change can't be drawn until the script finishes, so the hang carries{" "}
        <code>PaintPending</code>.
      </>
    ),
  },
  {
    name: "UserInteracting",
    meaning: (
      <>
        The user clicked, typed, scrolled or otherwise used Firefox in the 5
        seconds before the hang, so they very likely noticed it. A good signal for
        which hangs hurt most.
      </>
    ),
    example: (
      <>
        Someone is typing in a form. A second after their last key press, Firefox
        freezes for half a second.
      </>
    ),
  },
  {
    name: "BeforeStartupCrashAndHangTrackingEnded",
    where: "Parent process",
    meaning: (
      <>
        Firefox was still starting up: the hang came before Firefox marked
        startup as finished, which happens once the first window has opened and
        settled. Points at slow startup work.
      </>
    ),
    example: (
      <>
        Firefox launches and restores 40 tabs from the last session. It hangs
        while still setting them up.
      </>
    ),
  },
  {
    name: "ShutdownImpending",
    where: "Parent process",
    meaning: <>Firefox was already shutting down when the hang happened.</>,
    example: (
      <>
        The user quits Firefox, and it hangs while closing windows and saving the
        session.
      </>
    ),
  },
  {
    name: "ExternalCPUHigh",
    where: "Windows and macOS only",
    meaning: (
      <>
        Other programs were using nearly all of the computer's processor: more
        than every core but one, and at least half. The hang may say more about an
        overloaded machine than about Firefox's code.
      </>
    ),
    example: (
      <>
        On an 8-core laptop, a video export is using over 87.5% of the processor
        when Firefox hangs.
      </>
    ),
  },
  {
    name: "browser.tabs.opening",
    meaning: (
      <>
        A new tab was being opened. The value gives the stage:{" "}
        <code>initting</code> (the tab was being created), then{" "}
        <code>animated</code> or <code>not-animated</code> (it was opening, with
        or without the tab animation).
      </>
    ),
    example: (
      <>
        The user presses Ctrl+T and the new tab takes 300 ms to appear while it
        slides into the tab strip: <code>browser.tabs.opening = animated</code>.
      </>
    ),
  },
  {
    name: "Unrecovered",
    meaning: (
      <>
        Firefox never recovered: it was still stuck when it was closed or killed.
        The hang monitor saved the report and sent it on the next launch, with the
        duration recorded as the 8-second cap.
      </>
    ),
    example: (
      <>
        A page freezes Firefox completely and the user force-quits it. The next
        time Firefox starts, that hang is reported as <code>Unrecovered</code>.
      </>
    ),
  },
  {
    name: "PendingInput",
    where: "Web-page (content) processes only",
    meaning: (
      <>
        How many clicks, key presses and other input events were waiting to be
        handled when the hang happened. The value is the count.
      </>
    ),
    example: (
      <>
        A page's script blocks its process while the user clicks three times:{" "}
        <code>PendingInput = 3</code>.
      </>
    ),
  },
  {
    name: "PaintWhileInterruptingJS",
    where: "Web-page (content) processes only",
    meaning: (
      <>
        Firefox had paused a page's long-running script so it could draw a tab
        the user had just switched to.
      </>
    ),
    example: (
      <>
        The user switches to a tab whose page is stuck in a heavy script. Firefox
        interrupts the script to show the tab, and hangs while doing so.
      </>
    ),
  },
];

function scrollTo(id: string) {
  document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)?.title;
  return (
    <section className="guide-section" id={`guide-${id}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** A labelled definition row, for the per-view walk-throughs. */
function Item({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <div className="guide-item">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Guide() {
  const { search } = useLocation();
  const areas = { pathname: "/areas", search };
  const topHangs = { pathname: "/top-hangs", search };

  return (
    <div className="guide">
      <nav className="guide-toc" aria-label="Guide contents">
        <div className="guide-toc-title">Guide</div>
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => scrollTo(s.id)}>
            {s.title}
          </button>
        ))}
      </nav>

      <article className="guide-body">
        <header className="guide-intro">
          <h1>Using HangTime</h1>
          <p>
            HangTime shows where Firefox stops responding for real users, how often
            it happens, and whether it's getting better or worse. This guide covers
            where the data comes from and how to read each part of the dashboard.
          </p>
        </header>

        <Section id="about">
          <p>
            A <b>hang</b> is a stretch of time when a Firefox thread is busy and
            can't respond: the page won't scroll, clicks do nothing, the window
            feels frozen. Firefox's <b>Background Hang Reporter (BHR)</b> watches
            for these on Firefox Nightly. When one task keeps a thread busy for 128
            ms, BHR captures a <b>stack</b> (the chain of functions running at that
            moment), then records how long the task took to finish, up to 8
            seconds.
          </p>
          <p>
            Every day, an aggregation job in <code>mozilla-central</code> collects
            those reports for one Nightly build, symbolicates the stacks (turns
            memory addresses into function names), and groups identical stacks
            into <b>signatures</b>. HangTime loads that daily result and lets you
            rank, filter and dig into it.
          </p>
          <div className="guide-callout">
            <b>Two things to keep in mind.</b> The data is Nightly users only, so it
            shows problems early rather than measuring release users. And a build
            is aggregated about four days after it ships, so the newest builds
            appear with a short delay.
          </div>
        </Section>

        <Section id="quick-start">
          <p>A first pass through the dashboard, about five minutes:</p>
          <ol className="guide-steps">
            <li>
              <b>Get the big picture.</b> Open <Link to={areas}>Areas</Link> to see
              which parts of the browser, and which kinds of blocking (file I/O,
              lock waits, synchronous IPC), the build&rsquo;s hang time goes to.
              Pick a row to list those hangs.
            </li>
            <li>
              <b>Check what's changed.</b> In <Link to={topHangs}>Top Hangs</Link>,
              set <em>Trend</em> to <em>Increases</em> or <em>Newly tracked</em>.
              These are usually the best place to start triaging.
            </li>
            <li>
              <b>Open a hang.</b> Click any row. Its details open on the right,
              starting with a <em>Summary</em>: which area of the browser it is in,
              how the thread was stuck, when it happens, and the frames that show it.
            </li>
            <li>
              <b>Find the cause.</b> The <em>Stack</em> is next. Frame 0 is where the
              thread was stuck; the frames below it show how it got there. The
              frames the summary points at are tagged.
            </li>
            <li>
              <b>Read its history.</b> Below the stack, the <em>History</em> chart
              shows the hang day by day. Tick <em>Fx releases</em> to see whether a
              jump lines up with a Firefox release, Beta or Nightly milestone.
            </li>
            <li>
              <b>Act on it.</b> If there's no bug yet, use <em>File a bug</em>. It
              opens Bugzilla with the summary, stack and data already filled in.
            </li>
          </ol>
        </Section>

        <Section id="top-hangs-page">
          <p>
            <Link to={topHangs}>Top Hangs</Link> is where HangTime opens: the full
            list of signatures on the left, with the selected hang's details on
            the right.
          </p>
          <dl className="guide-list">
            <Item name="Investigation">
              A common starting question, as one choice: <em>Credible increases</em>,{" "}
              <em>Newly tracked</em>, <em>Biggest hangs with no bug</em>,{" "}
              <em>Main-thread file I/O</em>, <em>Synchronous IPC</em>,{" "}
              <em>Lock waits</em>, <em>Startup</em>, <em>Shutdown</em> and{" "}
              <em>While the user was interacting</em>. Each sets the filters below; change
              any of them and it reads <em>Custom filters</em>.
            </Item>
            <Item name="Area, Mechanism and When">
              Narrow the list by how its hangs are described: the part of the
              browser (<em>Fonts &amp; text</em>, <em>Startup cache</em>), how the
              thread was stuck (<em>File I/O</em>, <em>Lock wait</em>,{" "}
              <em>Synchronous IPC</em>), or when it happens (<em>Startup</em>,{" "}
              <em>User interacting</em>, on most of its reports). Each option shows
              its share of the build&rsquo;s hang time. See{" "}
              <button className="link" onClick={() => scrollTo("describing")}>
                How a hang is described
              </button>
              .
            </Item>
            <Item name="Bug">
              Keep only the hangs no bug tracks yet, or only those one does.
            </Item>
            <Item name="Filter box">
              Type part of a function or library name, for example{" "}
              <code>nsFrame</code> or <code>xul.dll</code>, to keep only the hangs
              whose stack contains it. Matches are highlighted. All-lowercase text
              matches any case; include a capital letter to match case exactly.
            </Item>
            <Item name="Sort">
              Rank by <em>Time</em> (total seconds, the default) or <em>Count</em>{" "}
              (number of hangs). Time favours long hangs; Count favours frequent
              ones.
            </Item>
            <Item name="Platform">
              Show only the hangs seen on Windows, macOS or Linux, with each row's
              time and count on that platform alone, ranked by them. Most hangs
              come from Windows, so this is how to find the top hangs on macOS or
              Linux.
            </Item>
            <Item name="Trend">
              Show only increases, decreases, or newly tracked hangs. Only changes
              with enough data behind them count. <em>Increases</em> are ranked by
              the time (or count) they added per day rather than by their total.
              Trends are worked out across all platforms, so with a platform
              picked the column reads <em>Trend (all platforms)</em>.
            </Item>
            <Item name="Time (s) and Count">
              Seconds of hanging and number of hangs for that signature on this
              build. Hover a time to see its share of the total.
            </Item>
            <Item name="Trend column">
              How the 7 days ending on this build compare with the 7 before. Hover
              a badge for the dates and the days behind it. See{" "}
              <button className="link" onClick={() => scrollTo("trends")}>
                How trends are worked out
              </button>
              .
            </Item>
            <Item name="Hang">
              Tracked hangs use their Bugzilla number and title. Other hangs use
              the original function symbol from frame 0, including arguments.
              No inferred caller is substituted. The second line describes the
              area and mechanism; tracked hangs also show their leaf function.
              Search matches any frame in the stack, not only the title.
            </Item>
          </dl>
          <p className="guide-note">
            The list shows 50 rows at a time. Use <em>Show 50 more</em> at the
            bottom to see more.
          </p>
        </Section>

        <Section id="areas-page">
          <p>
            <Link to={areas}>Areas</Link> shows where one build&rsquo;s hang time goes.
            Every row opens Top Hangs narrowed to it, keeping the build and platform.
          </p>
          <dl className="guide-list">
            <Item name="Investigations">
              The saved investigations from Top Hangs as a queue: how many hangs each
              finds on this build and their share of its hang time.{" "}
              <em>Sustained increases</em> also shows the tracked hang time they added per day.
            </Item>
            <Item name="About this data">
              What the numbers cover: the days the history has data for and how much
              of this build&rsquo;s hang time its top hangs hold, how much is tracked by
              a bug, how much has no recognised area, and whether affected-client
              counts exist for the build.
            </Item>
            <Item name="By area">
              Each part of the browser&rsquo;s share of the hang time, largest first,
              with the mechanisms that make up most of it underneath. The last column
              is how much of that time is in hangs no bug tracks yet.
            </Item>
            <Item name="By mechanism">
              The same hang time split by how the thread was stuck, with the areas
              each mechanism shows up in.
            </Item>
            <Item name="When">
              Hang time in hangs where most reports were flagged as during startup,
              during shutdown, while the user was interacting, and so on. A hang can
              carry several flags, so these don&rsquo;t add up to 100%.
            </Item>
            <Item name="Platform">
              Work everything out from one platform&rsquo;s share of each hang.
            </Item>
          </dl>
        </Section>

        <Section id="hang-detail">
          <p>
            Selecting a hang in Top Hangs fills the right-hand pane. A row of links
            at its top jumps to each section and stays put as the pane scrolls. From
            top to bottom:
          </p>
          <dl className="guide-list">
            <Item name="Copy link">
              Copies a link to this hang on this build, with the list&apos;s filters.
              It names the build, so it keeps working after newer builds arrive.
            </Item>
            <Item name="Bugzilla">
              When a bug tracks the hang, its number and title lead the summary
              and link directly to Bugzilla.
            </Item>
            <Item name="Summary">
              The same Bugzilla title or original leaf function as the list, with a link to its
              leaf frame in Stack. The stack description follows,
              then the platform it mostly comes from and
              the context flags its reports carry, then the evidence: the frame that
              shows the <em>mechanism</em>, the frame that names the <em>area</em>,
              the next area out (<em>during</em>), and the Firefox <em>caller</em>.
              Expand the description to see its supporting frames; click a
              frame to jump to it in the stack, where it is tagged.
            </Item>
            <Item name="Stack">
              Full function signatures, including parameters. <em>Copy stack</em>
              copies all frames, including folded ones. Every frame starts at
              frame 0, where the thread was stuck, and
              ending at the outermost caller. Firefox's own code is in normal text;
              operating system and third-party libraries are dimmed, so the Firefox
              frames stand out. A long stack opens focused: the frames at the leaf
              end, the frames the summary points at, and any the filter matches, with
              each run in between folded into one row saying how many frames it holds
              and what they mostly are (event loop and glue, system libraries, Firefox
              code). Click a folded row to open it, or <em>Show all</em> for every
              frame. Hover a frame for its source links: <em>Searchfox</em> and{" "}
              <em>GitHub</em> open a JavaScript frame&apos;s file at its line; for a
              C++ frame, <em>Searchfox</em> searches for the function, which leads to
              its definition.
            </Item>
            <Item name="History">
              The hang's daily time or count across the window, one bar per day.
              For a bug that covers several stacks, each bar is its tracked subset split
              into its biggest stacks, with the rest summed as <em>Other</em>, so you
              can see which stack is driving a change. Hover a bar for each part and
              the day's total. Tick{" "}
              <em>Fx releases</em> to add Firefox milestones:{" "}
              <span className="guide-swatch" style={{ color: "#d76e00" }}>Release</span>,{" "}
              <span className="guide-swatch" style={{ color: "#0250bb" }}>Beta</span>{" "}
              and <span className="guide-swatch" style={{ color: "#058b00" }}>Nightly</span>.
              The history keeps only the top few hundred stacks over the window, and
              matches them to the build on screen by the shape of each stack: names
              a build changes without changing the code path (a renumbered lambda, a
              moved line in a JS file) are ignored, so a hang keeps its history from
              one build to the next. A note reports how much of this build’s hang
              time overlaps the stored history. Missing historical values remain
              gaps; selecting a build never substitutes its daily totals into a
              historical bar. A hang none of whose
              stacks is tracked has no stack history. For a tracked Bugzilla issue,
              History instead selects stored stacks using its current [bhr:] tags,
              independently of the stacks appearing on the viewed build. Earlier
              history remains visible even with zero current overlap. Such a build
              says “history only”; its missing sample is not zero and has no trend
              claim. Tag association is reconstructed from today’s rules, not a
              historical bug-ownership record.
            </Item>
            <Item name="Near-duplicate group">
              Stacks that share a meaningful frame can be related even when their
              raw stopping frames differ. This grouping is a lead to investigate,
              not proof of a shared cause.{" "}
              <em>Show … stacks in the list</em> narrows the hang list on the left
              to that group, one row per stack, each led by the frame that sets it
              apart from the others, with its own description and its share of the
              group&rsquo;s time; <em>Show all hangs</em> in the banner above the list
              goes back. Clicking a row inspects that exact stack on the right,
              including its own time and count, even if several rows belong to
              one bug. The original is pinned as blue A. Use the left checkboxes
              to add up to three candidates, then <em>Compare stacks</em> to align
              all four. Letters, colors and checkmarks match across the list,
              inspector and comparison. Removing a candidate preserves the
              other colors. Per-stack platform and context breakdowns are not
              available, so the inspector does not reuse the bug’s aggregate data.
              <br />
              Sharing a frame isn&rsquo;t sharing a cause, so a label says how alike
              the stacks are. <em>Same bug</em>: one bug already tracks them all.{" "}
              <em>Similar call paths</em>: mostly one caller and area, so likely
              related, though not confirmed. <em>Shared blocking mechanism</em>: one
              wait (a lock, synchronous IPC, file I/O) reached from different callers
              or areas, possibly several problems that one fix won&rsquo;t all cover.{" "}
              <em>Shared code, different callers</em>: the same non-blocking code (a
              hash-table lookup, say) called from different places, best checked one
              stack at a time. Callers or areas count as different when none of them
              accounts for 60% of the group&rsquo;s hang time.
            </Item>
            <Item name="File a bug">
              Opens a new Bugzilla bug with the summary, what the stack shows, the
              stack, numbers and <code>[bhr:…]</code> whiteboard tag filled in.
              HangTime suggests a component by reading the stack and shows the frame
              it matched; it's right about four times in five, so check it before
              filing, especially when it&apos;s marked <em>broad match</em> or{" "}
              <em>deep in the stack</em>.
              <br />
              The whiteboard tag merges every hang whose stack has a matching
              function into the bug, so HangTime takes it from a frame specific to
              this hang (usually the code that made the blocking call), never from a
              primitive like <code>WaitOnAddress</code> or <code>memcpy</code>. A line
              under it says how many signatures and how much hang time the tag would
              match on this build, with <em>List them</em> to see them, and warns
              when that is shared code or spans several areas. <em>Tag frame</em>{" "}
              picks a different frame from the stack.
              <br />
              For a hang that already has a bug, <em>Copy hang summary</em> copies
              the latest numbers to paste into it.
            </Item>
            <Item name="Platform">
              Whether a platform carries more of this hang than it does of hangs in
              general. Most reports come from Windows, so a hang's raw shares mostly
              say that; instead each platform's share of this hang is set against
              its share of all hangs on the build (the bar against the dark mark),
              as a ratio: <code>1×</code> is in line, <code>2×</code> is twice its
              usual share. A line at the top sums it up, such as{" "}
              <em>More common on Linux</em> or <em>Windows only</em>. A platform is
              only called out at 1.5× or more, with at least 20 reports from it, and
              when the gap is too big to be chance.
            </Item>
            <Item name="Clients affected">
              Roughly how many different clients hit this hang: on this build, or
              over the last 7, 28 or 365 days. It's an estimate: clients are counted
              with a method (HyperLogLog) that never needs their IDs, and a client
              that hangs on many days is counted once. The share is of the clients
              that sent hang reports, not of all Nightly users, so it isn't a rate
              of affected users. A row covering several stacks adds their counts
              together and is shown as <em>up to</em>. A build without client data
              says so instead of showing a number.
            </Item>
            <Item name="Hang annotations">
              Extra context Firefox saved with the hang, summed up in one line such
              as <em>User interacting 82.8% · Startup 100%</em>. For example,{" "}
              <code>UserInteracting</code> means the user was actively using the
              browser when it froze. The percentage is the share of this hang&apos;s
              reports carrying that note; a report without it is unknown rather than
              &ldquo;no&rdquo;. <em>Show all</em> lists every annotation and value.
              See{" "}
              <button className="link" onClick={() => scrollTo("annotations")}>
                Hang annotations
              </button>{" "}
              for the full list.
            </Item>
          </dl>
        </Section>

        <Section id="describing">
          <p>
            HangTime describes each hang three ways, so a list of stacks reads as a
            list of problems. All three are read from the stack&rsquo;s function and
            library names (the hang data carries no source paths) and from the flags
            saved with each report. They say where the thread was, as a starting
            point; they are not a confirmed cause.
          </p>
          <dl className="guide-list">
            <Item name="Mechanism">
              How the thread was stuck where it was sampled, read from the leaf end
              of the stack: <em>File I/O</em> (with the operation: open, read,
              delete, metadata...), <em>Lock wait</em>, <em>Synchronous IPC</em>,{" "}
              <em>COM call</em>, <em>Registry access</em>, <em>Serialization</em>{" "}
              (JSON, structured clone), <em>Garbage collection</em>,{" "}
              <em>Cycle collection</em>, <em>JavaScript execution</em>, a{" "}
              <em>call into</em> a named system library, or plain <em>CPU work</em>.
              A lock or memory copy that a nearby frame explains takes that
              frame&rsquo;s name: a condition-variable wait inside{" "}
              <code>MessageChannel::WaitForSyncNotify</code> is synchronous IPC.
              A file operation says where the thread was, not that the disk was
              slow: antivirus, network drives and locks stall there too.
            </Item>
            <Item name="Area">
              The innermost frame that names a part of the browser: a feature
              (<em>Session restore</em>, <em>Bookmarks &amp; history</em>), a
              subsystem (<em>Fonts &amp; text</em>, <em>Startup cache</em>,{" "}
              <em>Networking</em>, <em>Accessibility</em>), or the OS integration it
              belongs to (<em>OS shell &amp; taskbar</em>, <em>Text input
              (IME)</em>). Glue frames (bindings, XPConnect, the event loop, smart
              pointers) are skipped. Generic layers such as <em>DOM</em> only
              answer when nothing more specific is on the stack. <em>During</em> is
              the next different area further out, such as <em>during JS module
              loading</em>.
            </Item>
            <Item name="When">
              From the annotations: <em>Startup</em>, <em>Shutdown</em>,{" "}
              <em>User interacting</em>, <em>Paint pending</em>,{" "}
              <em>Input waiting</em> and <em>Other apps busy (CPU)</em>, as the share
              of the hang&rsquo;s reports carrying each. A report without a flag is
              unknown rather than &ldquo;no&rdquo;, so the share is a floor.
            </Item>
          </dl>
          <p className="guide-note">
            The rules live in <code>src/data/hangAreas.ts</code>. A hang that reads
            wrong is worth a{" "}
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
              report
            </a>
            : most fixes are one line in a rule table.
          </p>
        </Section>

        <Section id="trends">
          <p>
            A trend compares a hang's average over the <b>7 days ending on the build
            you're looking at</b> with its average over the <b>7 days before</b>.
            Single days are noisy, so a weekly average gives a steadier answer.
            Pick an older build and its trends describe that build, not the latest
            week.
          </p>
          <p>
            The history keeps only each day's top signatures, so a day can be
            missing for two reasons. Either nothing was recorded that day for any
            hang (<b>no data</b>), or other hangs were recorded and this one fell
            under the cut (<b>below the cut</b>: smaller, but not necessarily zero).
            Neither counts as zero. A percentage is only shown when both weeks have
            at least <b>5 observed days</b>, enough hangs to mean something (20
            hangs or 30 seconds in one of them), and the typical day moved along
            with the average, so one bad day can't pass for a trend. Otherwise the
            badge says what's missing.
          </p>
          <table className="guide-table">
            <thead>
              <tr>
                <th>Badge</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="trend-badge red">↑74%</span></td>
                <td>An increase of 50% or more, with enough data behind it.</td>
              </tr>
              <tr>
                <td><span className="trend-badge amber">↑31%</span></td>
                <td>An increase between 20% and 50%. Rising, keep an eye on it.</td>
              </tr>
              <tr>
                <td><span className="trend-badge green">↓42%</span></td>
                <td>A decrease of 20% or more.</td>
              </tr>
              <tr>
                <td><span className="trend-badge neutral">stable</span></td>
                <td>Within 20% either way.</td>
              </tr>
              <tr>
                <td><span className="trend-badge blue">newly tracked</span></td>
                <td>
                  No activity in earlier recorded history, real volume now.
                  It may have existed below the tracking cut before.
                </td>
              </tr>
              <tr>
                <td><span className="trend-badge neutral">tracked again</span></td>
                <td>Activity exists in older history and returns after a tracking gap or zero baseline.</td>
              </tr>
              <tr>
                <td><span className="trend-badge neutral">partial 1/7d</span></td>
                <td>
                  Too few days observed in one week to compare (here 1 of 7). The
                  hover says which week.
                </td>
              </tr>
              <tr>
                <td><span className="trend-badge neutral">no baseline</span></td>
                <td>Seen recently, but the previous week has no data to compare with.</td>
              </tr>
              <tr>
                <td><span className="trend-badge neutral">no recent data</span></td>
                <td>Nothing was recorded for any hang in the recent week.</td>
              </tr>
              <tr>
                <td><span className="trend-badge neutral">below cut</span></td>
                <td>
                  Recorded days in the recent week, but this hang fell under the cut
                  on all of them. Probably smaller, by an unknown amount.
                </td>
              </tr>
              <tr>
                <td><span className="trend-badge amber">spike</span></td>
                <td>
                  The weekly averages differ, but only because of a day or two: the
                  typical (median) day didn't move. The hover names the day. Grey
                  when the spike was in the earlier week.
                </td>
              </tr>
              <tr>
                <td><span className="trend-badge neutral">low volume</span></td>
                <td>Both weeks covered, but too few hangs either side for a percentage.</td>
              </tr>
              <tr>
                <td><span className="trend-badge neutral">no history</span></td>
                <td>The build isn't in the history window.</td>
              </tr>
            </tbody>
          </table>
          <p className="guide-note">
            Hover a badge to see the dates compared, how many days of each week
            were observed, both averages and the change per day. Only red, amber
            and green badges count in the Trend filter, and increases are ranked by
            the time they added per day.
          </p>
          <p className="guide-note">
            Trends need the timeseries data. If it hasn't loaded, trend badges are
            blank and the Trend filter is greyed out.
          </p>
        </Section>

        <Section id="annotations">
          <p>
            When Firefox records a hang, it also notes what else was going on at
            that moment. These notes are <b>annotations</b>. They help tell a hang
            the user felt from one they didn't, or a slow computer from slow
            Firefox code. In a hang's details, each annotation shows the share of
            that hang's reports that carried it, and a hang can carry several.
          </p>
          <p>These are all the annotations Firefox can record:</p>
          <div className="guide-annotations">
            {ANNOTATIONS.map((a) => (
              <div key={a.name} className="guide-annotation">
                <div className="guide-annotation-head">
                  <code>{a.name}</code>
                  {a.where && <span className="chip neutral">{a.where}</span>}
                </div>
                <p>{a.meaning}</p>
                <p className="guide-example">
                  <span>Example</span>
                  {a.example}
                </p>
              </div>
            ))}
          </div>
          <p className="guide-note">
            HangTime shows main-thread hangs, so the two content-process
            annotations rarely or never appear in it. Firefox can also tag a hang
            with any user interaction it's timing, but{" "}
            <code>browser.tabs.opening</code> is the only one defined outside of
            tests.
          </p>
        </Section>

        <Section id="builds">
          <p>
            <b>Build date</b>, at the top of Top Hangs and Areas, shows which
            Nightly build you're looking at. Click the date and pick another to see
            an older build. <em>Latest build</em> next to it means you're following
            the newest one; <em>Back to latest build</em> returns to it. A build only
            exists once the daily job has processed it, about four days after it
            shipped.
          </p>
          <p>
            The rest of the bar says what the numbers cover. First, which
            hangs: the channel, process and thread they were recorded on (for
            example <em>Firefox Nightly · Parent process · Gecko (main thread)</em>).
            Then which reports: <em>reports through Oct 14</em> is the last
            day whose reports count toward the build. <em>Window open</em> in orange
            means the build was processed before that day, so it is missing whole
            days of reports and reads lower than its neighbours.
          </p>
          <p>
            Hang reports can be grouped by <b>build date</b> or by{" "}
            <b>submission date</b>. A build date (the first eight digits of the build
            ID) is the day a Nightly was built, so it identifies the exact code users
            ran. A submission date is the day a report reached Mozilla, and one day's
            reports come from many builds. HangTime groups by build date: each build,
            and each day on the charts, is one Nightly build's hangs, so a change can
            be traced to the code that caused it. A build's reports keep arriving for
            days after it ships; those received within five days of the build date
            are counted.
          </p>
          <p>
            Everything you set (build, filter, sort, trend and selected hang) is
            saved in the page address, so the URL reopens the same view. To share a
            hang, use <b>Copy link</b> at the top of its details: the link names the
            build you're looking at, so it keeps showing that build after newer ones
            arrive, where a plain URL on the latest build moves on with it. The bug
            form's dashboard link is made the same way.
          </p>
          <p>
            The first load downloads about 25 MB and processes it in your browser,
            which takes a few seconds. The loading screen shows progress. Please
            don't refresh while it runs, because that starts the download over.
          </p>
        </Section>

        <Section id="glossary">
          <dl className="guide-list">
            <Item name="BHR">
              Background Hang Reporter, the part of Firefox that detects and reports
              hangs.
            </Item>
            <Item name="Hang">
              A task that kept a thread busy for 128 ms or more, so it couldn't
              respond. Durations are capped at 8 seconds.
            </Item>
            <Item name="Stack">
              The chain of function calls running when the hang happened.
            </Item>
            <Item name="Frame">One function in a stack.</Item>
            <Item name="Leaf frame">
              The innermost frame (frame 0): where the thread actually was.
            </Item>
            <Item name="Signature">
              One distinct stack. All hangs with the same stack, or tracked by the
              same bug, are one signature.
            </Item>
            <Item name="Build">
              A Nightly build, named by its date. Each build's hangs are collected
              and shown separately.
            </Item>
            <Item name="Main thread">
              The thread that runs Firefox's user interface and pages' scripts. A
              hang here freezes the window, which is why HangTime focuses on it.
            </Item>
            <Item name="Event loop">
              Firefox's cycle of picking up and running the next task. Some stacks
              contain nested event loops, which the near-duplicate group counts.
            </Item>
            <Item name={<code>[bhr:…]</code>}>
              The whiteboard tag on a Bugzilla bug that links it to a hang
              signature, so HangTime can show and merge it.
            </Item>
          </dl>
        </Section>

        <Section id="help">
          <p>
            Found something wrong, or want a feature or some data HangTime doesn't
            show yet? Use <b>Bug &amp; Feedback</b> in the top right, or{" "}
            <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
              open an issue on GitHub
            </a>
            . The <em>i</em> buttons next to headings on each page also explain what
            that part shows.
          </p>
        </Section>
      </article>
    </div>
  );
}
