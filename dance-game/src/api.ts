/**
 * Typed client for the game API. Requests are same-origin (Vite proxies
 * `/api` to the server in development), so the session cookie rides along.
 */

import type {
  ApiErrorBody,
  LoginRequest,
  PlaylistMeta,
  ProgressResponse,
  PublicUser,
  ReferenceTrack,
  ReferenceTrackSummary,
  SaveReferenceTrackRequest,
  SignupRequest,
  SubmitRunRequest,
  SubmitRunResponse,
  VideoMeta,
} from "./shared/apiTypes";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach the game server. Is it running?");
  }

  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "http_error",
      error?.message ?? `The server answered ${response.status}.`
    );
  }
  return data as T;
}

/** Splits id lists into chunks the `/videos` endpoint accepts. */
const VIDEO_BATCH = 50;

export const api = {
  health: () => request<{ ok: boolean; storage: "memory" | "postgres" }>("GET", "/health"),

  /** The signed-in user, or `null` when there is no valid session. */
  async me(): Promise<PublicUser | null> {
    try {
      return (await request<{ user: PublicUser }>("GET", "/auth/me")).user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  signup: async (body: SignupRequest) =>
    (await request<{ user: PublicUser }>("POST", "/auth/signup", body)).user,
  login: async (body: LoginRequest) =>
    (await request<{ user: PublicUser }>("POST", "/auth/login", body)).user,
  logout: () => request<void>("POST", "/auth/logout"),

  playlists: () => request<PlaylistMeta[]>("GET", "/playlists"),

  async videos(ids: string[]): Promise<VideoMeta[]> {
    const batches: Promise<VideoMeta[]>[] = [];
    for (let i = 0; i < ids.length; i += VIDEO_BATCH) {
      const batch = ids.slice(i, i + VIDEO_BATCH);
      batches.push(request("GET", `/videos?ids=${batch.map(encodeURIComponent).join(",")}`));
    }
    return (await Promise.all(batches)).flat();
  },

  references: () => request<ReferenceTrackSummary[]>("GET", "/references"),

  /** `null` when nobody has recorded this video's routine yet. */
  async reference(videoId: string): Promise<ReferenceTrack | null> {
    try {
      return await request<ReferenceTrack>("GET", `/references/${videoId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  saveReference: (videoId: string, body: SaveReferenceTrackRequest) =>
    request<ReferenceTrackSummary>("PUT", `/references/${videoId}`, body),

  submitRun: (body: SubmitRunRequest) => request<SubmitRunResponse>("POST", "/runs", body),
  progress: () => request<ProgressResponse>("GET", "/progress"),
};
