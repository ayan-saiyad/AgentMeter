"use client";

import { useState, type FormEvent } from "react";

export function Login() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: form.get("token") }),
    });
    if (response.ok) window.location.reload();
    else {
      setError("The admin token is not valid.");
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div className="brand-mark">AM</div>
        <p className="eyebrow">OPERATIONS CONSOLE</p>
        <h1>AgentMeter</h1>
        <p className="muted">Enter the configured admin token to continue.</p>
        <label htmlFor="token">Admin token</label>
        <input
          id="token"
          name="token"
          type="password"
          autoComplete="current-password"
          required
        />
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" disabled={loading}>
          {loading ? "Verifying…" : "Open console"}
        </button>
      </form>
    </main>
  );
}
