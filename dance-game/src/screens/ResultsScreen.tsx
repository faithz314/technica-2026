import { gradeForAccuracy, TIERS } from "../shared/scoring";
import type { RunResult } from "./DanceScreen";

type Props = {
  result: RunResult;
  accent: string;
  onAgain(): void;
  onLibrary(): void;
  onStats(): void;
};

export function ResultsScreen({ result, accent, onAgain, onLibrary, onStats }: Props) {
  const { track, snapshot, saved, saveError } = result;
  const points = saved?.session.points ?? snapshot.points;
  const grade = saved?.session.grade ?? gradeForAccuracy(snapshot.accuracy);
  const title = track.title ?? `Track ${track.index + 1}`;

  return (
    <main className="results-screen page-wrap">
      <div className="results-confetti confetti-one">✦</div>
      <div className="results-confetti confetti-two">✳</div>
      <div className="results-confetti confetti-three">✷</div>
      <div className="eyebrow">
        <span className="eyebrow-star">✦</span> THAT WAS A VIBE
      </div>
      <h1>
        YOU OWNED
        <br />
        <span className="gradient-text">THE FLOOR.</span>
      </h1>
      <p className="muted results-subtitle">Every move counts. Here's how your session went.</p>

      <section className="result-card">
        <div className="result-song-art" style={{ "--accent": accent } as React.CSSProperties}>
          <img className="youtube-thumbnail" src={track.thumbnailUrl} alt="" />
          <span>{title}</span>
          <b className="grade-letter">{grade}</b>
        </div>
        <div className="result-details">
          <span className="eyebrow small-eyebrow">FINAL SCORE</span>
          <strong className="score-number">{points.toLocaleString()}</strong>
          <span className="score-caption">
            {Math.round(snapshot.accuracy * 100)}% ACCURACY · {snapshot.maxCombo} BEST COMBO
          </span>
          <div className="result-divider" />
          <ul className="tier-breakdown">
            {TIERS.map((tier) => (
              <li key={tier} className={`tier-${tier.toLowerCase()}`}>
                <span>{tier}</span>
                <b>{snapshot.tierCounts[tier]}</b>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {saved ? (
        <section className="totals-strip" aria-label="Your account totals">
          <div>
            <strong>{saved.totals.totalPoints.toLocaleString()}</strong>
            <span>CAREER POINTS</span>
          </div>
          <div>
            <strong>{saved.totals.totalPlays}</strong>
            <span>DANCES</span>
          </div>
          <div>
            <strong>{saved.totals.bestPoints.toLocaleString()}</strong>
            <span>PERSONAL BEST</span>
          </div>
        </section>
      ) : (
        <p className="form-error result-save-error" role="alert">
          This run wasn't saved to your account: {saveError}
        </p>
      )}

      <div className="result-actions">
        <button className="primary-button" onClick={onAgain}>
          DANCE AGAIN <span>↻</span>
        </button>
        <button className="secondary-button" onClick={onLibrary}>
          CHOOSE ANOTHER TRACK ↗
        </button>
        <button className="secondary-button" onClick={onStats}>
          MY STATS ↗
        </button>
      </div>
    </main>
  );
}
