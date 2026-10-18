import { useState } from "react";
import { api } from "../api";
import type { PublicUser } from "../shared/apiTypes";

type Props = {
  storage: "memory" | "postgres" | null;
  onSignedIn(user: PublicUser): void;
};

export function AuthScreen({ storage, onSignedIn }: Props) {
  const [isSignup, setIsSignup] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!email.includes("@")) {
      setError("Enter a valid email address to continue.");
      return;
    }
    if (isSignup && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (isSignup && displayName.trim().length < 2) {
      setError("Add a player name (at least 2 characters).");
      return;
    }
    setSubmitting(true);
    try {
      const user = isSignup
        ? await api.signup({ email, password, displayName })
        : await api.login({ email, password });
      onSignedIn(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-copy">
        <div className="eyebrow">
          <span className="eyebrow-star">✦</span> JUST DANCE @ HOME
        </div>
        <h1>
          TECHNICA
          <br />
          <span className="gradient-text">2026</span>
          <br />
          MOVE!
          <br />
        </h1>
        <p className="hero-description">
          Turn your space into a dance floor. Pick a Just Dance track, follow the coach, and your
          webcam scores every move.
        </p>
        <div className="hero-stats">
          <div>
            <strong>01</strong>
            <span>CHOOSE A BEAT</span>
          </div>
          <div>
            <strong>02</strong>
            <span>MATCH THE MOVES</span>
          </div>
          <div>
            <strong>03</strong>
            <span>CHASE YOUR SCORE</span>
          </div>
        </div>
      </section>
      <section className="auth-panel">
        {/* <div className="panel-kicker">LET'S GET MOVING</div> */}
        <h2>{isSignup ? "JOIN THE PARTY" : "READY TO PLAY?"}</h2>
        <p className="muted">
          {isSignup ? "Create your player profile." : "Your next favorite dance is waiting."}
        </p>
        <form className="auth-form" onSubmit={handleSubmit}>
          {isSignup && (
            <label className="field-label">
              PLAYER NAME
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="What should we call you?"
                autoComplete="nickname"
                maxLength={40}
              />
            </label>
          )}
          <label className="field-label">
            EMAIL ADDRESS
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="field-label">
            PASSWORD
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder={isSignup ? "At least 8 characters" : "Your password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button full-button" type="submit" disabled={submitting}>
            {submitting ? "ONE SEC…" : isSignup ? "CREATE PLAYER PROFILE" : "LET'S DANCE"} <span>↗</span>
          </button>
        </form>
        <div className="auth-switch">
          {isSignup ? "Already on the floor?" : "New to the dance floor?"}{" "}
          <button
            onClick={() => {
              setIsSignup(!isSignup);
              setError("");
            }}
          >
            {isSignup ? "Sign in" : "Create an account"}
          </button>
        </div>
        {storage === "memory" && (
          <p className="demo-note">DEMO STORAGE · ACCOUNTS RESET WHEN THE SERVER RESTARTS</p>
        )}
      </section>
      <div className="auth-decoration deco-star">✳</div>
      <div className="auth-decoration deco-circle" />
      {/* <div className="auth-bottom-note">
        TURN IT UP <span>↗</span>
      </div> */}
    </main>
  );
}
