/**
 * The body segments the dance scorer compares, and the weight each one carries.
 *
 * A pose is reduced to one unit direction vector per segment. Unit vectors are
 * invariant to where the dancer stands and how large they appear, so a routine
 * recorded from one spot in the room still matches an attempt made from
 * another. Only `x`/`y` are used: MediaPipe's `z` is a weak monocular estimate
 * and adds more noise than signal.
 *
 * Shared with the API, which validates that uploaded reference frames carry
 * exactly `SEGMENT_COUNT` segments.
 */

/** MediaPipe Pose landmark indices, by name, for the joints we rely on. */
export const LANDMARK = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/**
 * A segment runs `from` one landmark `to` another. `midpointOf` pairs describe
 * virtual joints (the torso runs between hip and shoulder midpoints).
 */
export type PoseSegment = {
  /** Stable key, used in debug overlays and tests. */
  id: string;
  /** Human label for the UI. */
  label: string;
  from: readonly number[];
  to: readonly number[];
  /**
   * Relative importance. Arms read as the most expressive part of a routine,
   * the shoulder line mostly reports body rotation and is weighted lightly.
   */
  weight: number;
};

export const POSE_SEGMENTS: readonly PoseSegment[] = [
  {
    id: "leftUpperArm",
    label: "Left upper arm",
    from: [LANDMARK.leftShoulder],
    to: [LANDMARK.leftElbow],
    weight: 1.25,
  },
  {
    id: "leftForearm",
    label: "Left forearm",
    from: [LANDMARK.leftElbow],
    to: [LANDMARK.leftWrist],
    weight: 1.25,
  },
  {
    id: "rightUpperArm",
    label: "Right upper arm",
    from: [LANDMARK.rightShoulder],
    to: [LANDMARK.rightElbow],
    weight: 1.25,
  },
  {
    id: "rightForearm",
    label: "Right forearm",
    from: [LANDMARK.rightElbow],
    to: [LANDMARK.rightWrist],
    weight: 1.25,
  },
  {
    id: "leftThigh",
    label: "Left thigh",
    from: [LANDMARK.leftHip],
    to: [LANDMARK.leftKnee],
    weight: 1,
  },
  {
    id: "leftShin",
    label: "Left shin",
    from: [LANDMARK.leftKnee],
    to: [LANDMARK.leftAnkle],
    weight: 1,
  },
  {
    id: "rightThigh",
    label: "Right thigh",
    from: [LANDMARK.rightHip],
    to: [LANDMARK.rightKnee],
    weight: 1,
  },
  {
    id: "rightShin",
    label: "Right shin",
    from: [LANDMARK.rightKnee],
    to: [LANDMARK.rightAnkle],
    weight: 1,
  },
  {
    id: "torso",
    label: "Torso",
    from: [LANDMARK.leftHip, LANDMARK.rightHip],
    to: [LANDMARK.leftShoulder, LANDMARK.rightShoulder],
    weight: 0.75,
  },
  {
    id: "shoulderLine",
    label: "Shoulder line",
    from: [LANDMARK.leftShoulder],
    to: [LANDMARK.rightShoulder],
    weight: 0.5,
  },
];

export const SEGMENT_COUNT = POSE_SEGMENTS.length;

/** Number of floats per frame in a serialized reference track (x and y each). */
export const SEGMENT_VECTOR_LENGTH = SEGMENT_COUNT * 2;
