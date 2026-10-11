import { useEffect, useRef, useState } from "react";
import { href } from "../lib/router";
import { Close, Menu } from "./Icons";

/** Two rows: wordmark and menu, then the full edition line (never truncated). */
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

  const close = () => setOpen(false);

  return (
    <header className="topbar">
      <div className="topbar-row">
        <a className="brand" href={href.deck()} aria-label="penpost, today's paper">penpost</a>
        <button className="icon-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Menu />
        </button>
      </div>
      <p className="topbar-date">
        {dateLabel}
        {sub ? <span className="topbar-sub"> · {sub}</span> : null}
      </p>
      {open ? (
        <div className="sheet-backdrop" onClick={close}>
          <nav className="sheet" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <span className="sheet-title">penpost</span>
              <button ref={closeRef} className="icon-btn" aria-label="Close menu" onClick={close}>
                <Close />
              </button>
            </div>
            <a href={href.deck()} onClick={close}>Today's paper</a>
            <a href={href.papers()} onClick={close}>Past papers</a>
            <a href={href.settings()} onClick={close}>Your places and settings</a>
            <a href={href.about()} onClick={close}>About</a>
            <a href={href.account()} onClick={close}>Create an account or log in</a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
