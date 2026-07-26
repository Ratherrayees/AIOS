"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    // Preserve a correlation marker without placing a potentially sensitive
    // server error message in the browser console.
    console.error("AIOS workspace route error", {
      digest: error.digest ?? null,
    });
  }, [error.digest]);

  return (
    <html lang="en">
      <body>
        <main className="recovery-page">
          <section>
            <p>AIOS RECOVERY</p>
            <span aria-hidden="true">!</span>
            <h1>That workspace view needs a fresh start.</h1>
            <small>
              No customer action was sent. You can safely try the view again.
            </small>
            <button type="button" onClick={reset}>
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
