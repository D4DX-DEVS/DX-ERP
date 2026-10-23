"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#F4F6FB", color: "#10183A" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 22 }}>D4DX ERP is temporarily unavailable</h1>
          <p style={{ color: "#5E6583", fontSize: 14 }}>Please try again in a moment.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
          <button onClick={reset} style={{ marginTop: 12, height: 40, padding: "0 16px", borderRadius: 10, border: 0, background: "#1F3CB3", color: "#fff", fontWeight: 600 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
