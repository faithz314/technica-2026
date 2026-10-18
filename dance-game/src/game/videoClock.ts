/**
 * Smooths the YouTube player's position into a per-frame clock.
 *
 * `getCurrentTime()` only advances when the iframe posts a status update, a
 * few times a second, so reading it raw on every animation frame yields a
 * staircase. Between updates we extrapolate from the last reported value.
 */
export class VideoClock {
  private lastReported = -1;
  private reportedAt = 0;

  /** Never extrapolate further than this past the last report. */
  private static readonly MAX_EXTRAPOLATION_S = 0.5;

  /** Current position in milliseconds. */
  read(reportedSeconds: number, playing: boolean, now = performance.now()): number {
    if (reportedSeconds !== this.lastReported) {
      this.lastReported = reportedSeconds;
      this.reportedAt = now;
    }
    if (!playing) return reportedSeconds * 1000;
    const elapsed = Math.min((now - this.reportedAt) / 1000, VideoClock.MAX_EXTRAPOLATION_S);
    return (reportedSeconds + elapsed) * 1000;
  }
}
