import { POSE_SEGMENTS } from "../shared/poseSegments";
import type { Landmark } from "./features";
import { POSE_CONNECTIONS } from "./poseTracker";

const GOOD = "#c5ff5b";
const CLOSE = "#ffb52e";
const OFF = "#ff4e91";
const NEUTRAL = "#b18cff";

function colorFor(similarity: number | null | undefined) {
  if (similarity == null) return NEUTRAL;
  if (similarity >= 0.75) return GOOD;
  if (similarity >= 0.45) return CLOSE;
  return OFF;
}

function point(landmarks: Landmark[], indices: readonly number[], width: number, height: number) {
  let x = 0;
  let y = 0;
  for (const index of indices) {
    x += landmarks[index].x;
    y += landmarks[index].y;
  }
  return { x: (x / indices.length) * width, y: (y / indices.length) * height };
}

/**
 * Draws the tracked skeleton. Scored segments are tinted by how well they
 * match the routine, so the player can see which limb is off.
 */
export function drawPose(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[] | null,
  segments: readonly (number | null)[] | null
) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2, width / 240);
  ctx.strokeStyle = "rgba(255,255,255,.28)";
  for (const { start, end } of POSE_CONNECTIONS) {
    const a = landmarks[start];
    const b = landmarks[end];
    if ((a.visibility ?? 0) < 0.5 || (b.visibility ?? 0) < 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
    ctx.stroke();
  }

  ctx.lineWidth = Math.max(4, width / 90);
  POSE_SEGMENTS.forEach((segment, i) => {
    const from = point(landmarks, segment.from, width, height);
    const to = point(landmarks, segment.to, width, height);
    ctx.strokeStyle = colorFor(segments?.[i]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });

  ctx.fillStyle = "#fff";
  const radius = Math.max(3, width / 160);
  for (const landmark of landmarks.slice(11)) {
    if ((landmark.visibility ?? 0) < 0.5) continue;
    ctx.beginPath();
    ctx.arc(landmark.x * width, landmark.y * height, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
