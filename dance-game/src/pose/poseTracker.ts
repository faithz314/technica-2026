/**
 * Webcam capture and MediaPipe pose estimation.
 *
 * The WASM runtime is bundled from the installed package (Vite emits it as an
 * asset) so the runtime always matches the JS API. Only the model weights are
 * fetched from Google's CDN.
 */

import { PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

async function create(delegate: "GPU" | "CPU") {
  return PoseLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }
  );
}

/** Shared across dance sessions: the model takes a few seconds to load. */
export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  landmarkerPromise ??= create("GPU")
    .catch(() => create("CPU"))
    .catch((error: unknown) => {
      landmarkerPromise = null;
      throw error;
    });
  return landmarkerPromise;
}

export async function openWebcam(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser can't access a webcam. Try a recent Chrome, Edge or Safari.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
    });
  } catch (error) {
    const name = (error as DOMException).name;
    if (name === "NotAllowedError") {
      throw new Error("Camera access was blocked. Allow it in the address bar and try again.", {
        cause: error,
      });
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new Error("No webcam was found.", { cause: error });
    }
    if (name === "NotReadableError") {
      throw new Error("The webcam is in use by another app.", { cause: error });
    }
    throw new Error("Couldn't start the webcam.", { cause: error });
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Detects one pose in the current webcam frame. MediaPipe requires
 * strictly increasing timestamps in VIDEO mode, so callers pass
 * `performance.now()`.
 */
export function detectPose(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number
): NormalizedLandmark[] | null {
  const result = landmarker.detectForVideo(video, timestampMs);
  return result.landmarks[0] ?? null;
}
