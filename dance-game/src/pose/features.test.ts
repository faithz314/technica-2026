import { describe, expect, it } from "vitest";
import { LANDMARK, SEGMENT_COUNT } from "../shared/poseSegments";
import { comparePoses, compactFrame, extractFeatures, matchAt, type Landmark } from "./features";

/** A front-facing figure, arms either hanging down or raised overhead. */
function figure(armsUp: boolean, visibility = 0.95): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility }));
  const set = (index: number, x: number, y: number) => {
    landmarks[index] = { x, y, visibility };
  };
  set(LANDMARK.leftShoulder, 0.6, 0.3);
  set(LANDMARK.rightShoulder, 0.4, 0.3);
  set(LANDMARK.leftHip, 0.57, 0.6);
  set(LANDMARK.rightHip, 0.43, 0.6);
  set(LANDMARK.leftKnee, 0.57, 0.75);
  set(LANDMARK.rightKnee, 0.43, 0.75);
  set(LANDMARK.leftAnkle, 0.57, 0.9);
  set(LANDMARK.rightAnkle, 0.43, 0.9);
  const dy = armsUp ? -0.12 : 0.12;
  set(LANDMARK.leftElbow, 0.62, 0.3 + dy);
  set(LANDMARK.rightElbow, 0.38, 0.3 + dy);
  set(LANDMARK.leftWrist, 0.63, 0.3 + 2 * dy);
  set(LANDMARK.rightWrist, 0.37, 0.3 + 2 * dy);
  return landmarks;
}

describe("extractFeatures", () => {
  it("produces unit vectors and confidences for every segment", () => {
    const { v, w } = extractFeatures(figure(false), 4 / 3);
    expect(v).toHaveLength(SEGMENT_COUNT * 2);
    expect(w).toHaveLength(SEGMENT_COUNT);
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      expect(Math.hypot(v[2 * i], v[2 * i + 1])).toBeCloseTo(1);
    }
  });

  it("is unaffected by where the dancer stands or how big they appear", () => {
    const base = figure(true);
    const moved = base.map((p) => ({ ...p, x: p.x * 0.6 + 0.1, y: p.y * 0.6 + 0.2 }));
    const match = comparePoses(extractFeatures(moved, 1), extractFeatures(base, 1));
    expect(match?.score).toBeCloseTo(1);
  });
});

describe("comparePoses", () => {
  const down = extractFeatures(figure(false), 1);
  const up = extractFeatures(figure(true), 1);

  it("scores an identical pose as a perfect match", () => {
    expect(comparePoses(up, up)?.score).toBeCloseTo(1);
  });

  it("marks a wrong arm position well below a match", () => {
    const match = comparePoses(down, up)!;
    expect(match.score).toBeLessThan(0.6);
    expect(match.segments[0]).toBe(0);
  });

  it("gives nothing when the player isn't detected", () => {
    expect(comparePoses(null, up)?.score).toBe(0);
  });

  it("refuses to judge a reference frame with no visible body", () => {
    expect(comparePoses(up, extractFeatures(figure(true, 0.1), 1))).toBeNull();
  });
});

describe("matchAt", () => {
  const up = extractFeatures(figure(true), 1);
  const down = extractFeatures(figure(false), 1);
  const track = {
    frames: [compactFrame(1000, down), compactFrame(1200, up), compactFrame(3000, down)],
  };

  it("forgives a dancer slightly off the beat", () => {
    expect(matchAt(track, 1050, up)?.score).toBeCloseTo(1, 2);
  });

  it("returns null where the recording has no frames", () => {
    expect(matchAt(track, 2000, up)).toBeNull();
  });
});
