import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import bhrLogo from "@/assets/bhr-logo.png";
import { setTheme, useTheme } from "@/state/theme";

interface Tab {
  id: string;
  label: string;
  /** Route path for an enabled tab; omitted for planned (disabled) tabs. */
  to?: string;
}

const TABS: Tab[] = [
  { id: "top-hangs", label: "Top Hangs", to: "/top-hangs" },
  { id: "areas", label: "Areas", to: "/areas" },
  { id: "guide", label: "Guide", to: "/guide" },
];

const FEEDBACK_URL = "https://github.com/mozilla/HangTime/issues";

interface HeaderProps {
  thread: string;
}

export function Header({ thread }: HeaderProps) {
  const location = useLocation();
  const theme = useTheme();
  const [tabsAnimated, setTabsAnimated] = useState(false);
  const activeTab = Math.max(0, TABS.findIndex(tab => tab.to === location.pathname));

  return (
    <header className="top">
      <div className="brand">
        <img className="logo" src={bhrLogo} alt="" aria-hidden="true" />
        HangTime
        <span className="subtitle">Background Hang Reporter Dashboard</span>
      </div>
      <nav className="tabs" aria-label="Main navigation">
        <span className="tab-selection" aria-hidden="true"
          style={{ transform: `translateX(calc(${activeTab * 100}% + var(--tab-gap) * ${activeTab}))` }}>
          <span key={activeTab} className="tab-glass-surface" data-animate={tabsAnimated || undefined} />
        </span>
        {TABS.map((tab) =>
          tab.to ? (
            // Preserve the current query string (thread/date/…) across tabs.
            <Link
              key={tab.id}
              to={{ pathname: tab.to, search: location.search }}
              className={location.pathname === tab.to ? "active" : ""}
              aria-current={location.pathname === tab.to ? "page" : undefined}
              onClick={() => setTabsAnimated(true)}
            >
              {tab.label}
            </Link>
          ) : (
            <button key={tab.id} disabled title="Planned">
              {tab.label}
            </button>
          ),
        )}
      </nav>
      <div className="header-right">
        <button type="button" className="theme-toggle"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <svg className="theme-icon theme-icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
          </svg>
          <svg className="theme-icon theme-icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.9 13.05A9 9 0 0 1 10.95 3.1a9 9 0 1 0 9.95 9.95Z" />
          </svg>
        </button>
        <a
          className="pill feedback-link"
          href={FEEDBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Feedback ↗
        </a>
        <span className="pill">{thread === "child" ? "Child process" : "Main thread"}</span>
        <span className="version">V1.2.2</span>
      </div>
    </header>
  );
}
