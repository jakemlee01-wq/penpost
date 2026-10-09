import { useEffect, useRef, useState } from "react";
import { href } from "../lib/router";
import { Close, Menu } from "./Icons";

/** Compact Penpost label + edition date, with a small menu for settings and about. */
export function TopBar({ dateLabel, sub }: { dateLabel: string; sub?: string }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="topbar">
      <a className="brand" href={href.deck()}>Penpost</a>
      <span className="topbar-date">
        {dateLabel}
        {sub ? <span className="topbar-sub"> · {sub}</span> : null}
      </span>
      <button className="icon-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <Menu />
      </button>
      {open ? (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <nav className="sheet" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <span className="sheet-title">Penpost</span>
              <button ref={closeRef} className="icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
                <Close />
              </button>
            </div>
            <a href={href.deck()} onClick={() => setOpen(false)}>Today's paper</a>
            <a href={href.today()} onClick={() => setOpen(false)}>All of today's stories</a>
            <a href={href.settings()} onClick={() => setOpen(false)}>Your towns and settings</a>
            <a href={href.about()} onClick={() => setOpen(false)}>About Penpost and our AI writers</a>
            <p className="sheet-note">Penpost is written by AI writers. Every story links to its sources.</p>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
