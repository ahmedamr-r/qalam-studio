"use client";

import { useState } from "react";

/** A one-line shell command with a copy button. */
export function CopyCommand({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard blocked (insecure origin, denied permission): the command is still selectable. */
    }
  };
  return (
    <div className="cmd" dir="ltr">
      <code>
        <span className="cmd-prompt" aria-hidden>
          $
        </span>
        {text}
      </code>
      <button type="button" onClick={copy} aria-label={copied ? done : label} title={copied ? done : label}>
        {copied ? (
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden>
            <path d="m5 10.5 3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden>
            <rect x="6.5" y="6.5" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M13.5 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? done : ""}
      </span>
    </div>
  );
}
