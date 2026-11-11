"use client";

import { useState, type FormEvent } from "react";
import { PageHeader, fmtDate } from "@/components/ui";
import { QrCode } from "@/components/QrCode";
import { useApi, useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import type { MfaSetup as Setup } from "@/lib/adminApi";
import { useToast } from "@/lib/toast";

const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

export default function SecurityPage() {
  const { me, refreshMe, adoptTokens } = useAuth();
  const api = useApi();
  const toast = useToast();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = !!me?.mfa_enabled_at;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const start = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSetup(await api.mfaSetup(password));
      setPassword("");
    });
  };

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      // Confirming ends every earlier session; continue with the fresh two-factor session it returns.
      adoptTokens(await api.mfaConfirm(code));
      setSetup(null);
      setCode("");
      await refreshMe();
      toast.success("Two-factor authentication is on. You'll need a code each time you sign in.");
    });
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.mfaDisable(code, password);
      setCode("");
      setPassword("");
      await refreshMe();
      toast.success("Two-factor authentication is off.");
    });
  };

  return (
    <>
      <PageHeader title="Account security" description="Protect your staff account with an authenticator app (TOTP)." />
      <section className="card stack gap-md" aria-labelledby="mfa-h">
        <div className="row between">
          <h2 id="mfa-h">Two-factor authentication</h2>
          <span className={enabled ? "badge badge-success" : "badge badge-warning"}>{enabled ? "On" : "Off"}</span>
        </div>

        {enabled && !setup && (
          <>
            <p className="muted">Enabled {fmtDate(me?.mfa_enabled_at)}. Sign-in asks for a code from your authenticator app.</p>
            <form className="stack gap-md" onSubmit={disable} aria-label="Turn off two-factor authentication">
              <p className="small">
                To turn it off, confirm with your password and a current code. Your organization may require it to stay on.
              </p>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="disable-password">Password</label>
                  <input id="disable-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="disable-code">Authentication code</label>
                  <input id="disable-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(onlyDigits(e.target.value))} />
                </div>
              </div>
              <div>
                <button type="submit" className="btn btn-danger" disabled={busy || !password || code.length !== 6}>
                  Turn off
                </button>
              </div>
            </form>
          </>
        )}

        {!enabled && !setup && (
          <>
            <p>Use an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Authy.</p>
            <form className="stack gap-md" onSubmit={start} aria-label="Start two-factor setup">
              <div className="field">
                <label htmlFor="setup-password">Confirm your password</label>
                <input id="setup-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div>
                <button type="submit" className="btn btn-primary" disabled={busy || !password}>
                  {busy ? "Preparing…" : "Set up two-factor authentication"}
                </button>
              </div>
            </form>
          </>
        )}

        {setup && (
          <form className="stack gap-md" onSubmit={confirm} aria-label="Confirm two-factor setup">
            <ol className="stack gap-md">
              <li>
                Scan this QR code with your authenticator app.
                <div className="qr-wrap">
                  <QrCode value={setup.otpauth_uri} label="QR code for your authenticator app" />
                </div>
              </li>
              <li>
                Can&apos;t scan? Enter this key manually (time-based, 6 digits):
                <div>
                  <code className="mono secret" aria-label="Setup key">
                    {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
                  </code>
                </div>
              </li>
              <li>
                <div className="field">
                  <label htmlFor="confirm-code">Enter the 6-digit code shown in the app</label>
                  <input id="confirm-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(onlyDigits(e.target.value))} />
                </div>
              </li>
            </ol>
            <p className="muted small">This key is shown only now. If you leave this page before confirming, start again.</p>
            <div className="row gap-xs">
              <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
                {busy ? "Checking…" : "Turn on"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { setSetup(null); setCode(""); setError(null); }} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
      </section>
    </>
  );
}

