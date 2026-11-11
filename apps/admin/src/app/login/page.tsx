"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "@darna/api-client";
import { brand } from "@darna/design-tokens";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { safeNextPath } from "@/lib/safeRedirect";

export default function LoginPage() {
  const { login, status } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Second factor: shown after the API answers `mfa_required`.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  const next = () => safeNextPath(new URLSearchParams(window.location.search).get("next"), window.location.origin);

  useEffect(() => {
    if (status === "authenticated") router.replace(next());
  }, [status, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password, needsCode ? code : undefined);
      router.replace(next());
    } catch (err) {
      if (err instanceof ApiError && err.code === "mfa_required") {
        setNeedsCode(true);
        setError(null);
        setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        setError(errorMessage(err));
        if (needsCode) setCode("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card login-card stack gap-md" onSubmit={onSubmit} noValidate>
        <div>
          <div className="brand">
            {brand.name} <span className="brand-sub">Operations</span>
          </div>
          <h1>Staff sign in</h1>
          <p className="muted">For Darna reviewers, support and administrators only.</p>
        </div>
        {needsCode ? (
          <div className="field">
            <label htmlFor="totp">Authentication code</label>
            <input
              id="totp"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              aria-describedby="totp-help"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <span id="totp-help" className="muted small">
              Enter the 6-digit code from your authenticator app for {email.trim()}.
            </span>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        )}
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy || !email || !password || (needsCode && code.length !== 6)}>
          {busy ? "Signing in…" : needsCode ? "Verify" : "Sign in"}
        </button>
        {needsCode && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setNeedsCode(false);
              setCode("");
              setError(null);
            }}
          >
            Use a different account
          </button>
        )}
      </form>
    </main>
  );
}
