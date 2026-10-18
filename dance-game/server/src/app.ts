import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type {
  ApiErrorBody,
  PlaylistMeta,
  PublicUser,
} from "../../src/shared/apiTypes.ts";
import { PLAYLISTS, isValidVideoId } from "../../src/shared/playlists.ts";
import { computePoints, gradeForAccuracy, totalFrames } from "../../src/shared/scoring.ts";
import {
  DUMMY_PASSWORD_HASH,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  hashSessionToken,
  newSessionToken,
  verifyPassword,
} from "./auth.ts";
import { playlistTitle, videoMeta } from "./oembed.ts";
import type { Store, UserRecord } from "./store.ts";
import {
  loginSchema,
  saveReferenceSchema,
  signupSchema,
  submitRunSchema,
  videoIdSchema,
} from "./validation.ts";

const MAX_VIDEO_IDS = 50;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type AuthedRequest = Request & { user: UserRecord };

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    throw new HttpError(400, "invalid_request", `${where}${issue.message}`);
  }
  return result.data;
}

export type AppOptions = {
  store: Store;
  /** Marks the session cookie `Secure`. On whenever the site is served over HTTPS. */
  secureCookies: boolean;
  /** Built client to serve, if present. */
  staticDir?: string;
};

export function createApp({ store, secureCookies, staticDir }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  // Reference tracks run to a few hundred kilobytes of JSON.
  app.use(express.json({ limit: "4mb" }));

  function sessionToken(req: Request): string | undefined {
    const header = req.headers.cookie;
    return header ? parseCookie(header)[SESSION_COOKIE] : undefined;
  }

  async function startSession(res: Response, user: UserRecord) {
    const { token, tokenHash } = newSessionToken();
    await store.createSession(tokenHash, user.id, new Date(Date.now() + SESSION_TTL_MS));
    res.setHeader(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        path: "/",
        maxAge: SESSION_TTL_MS / 1000,
      })
    );
  }

  async function currentUser(req: Request): Promise<UserRecord | null> {
    const token = sessionToken(req);
    return token ? store.findSessionUser(hashSessionToken(token)) : null;
  }

  async function requireUser(req: Request, _res: Response, next: NextFunction) {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
    (req as AuthedRequest).user = user;
    next();
  }

  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({ ok: true, storage: store.kind });
  });

  api.post("/auth/signup", async (req, res) => {
    const input = parseBody(signupSchema, req.body);
    const user = await store.createUser({
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
    });
    if (!user) {
      throw new HttpError(409, "email_taken", "That email already has a player profile.");
    }
    await startSession(res, user);
    res.status(201).json({ user: toPublicUser(user) });
  });

  api.post("/auth/login", async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    const user = await store.findUserByEmail(input.email);
    const valid = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH
    );
    if (!user || !valid) {
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    await startSession(res, user);
    res.json({ user: toPublicUser(user) });
  });

  api.post("/auth/logout", async (req, res) => {
    const token = sessionToken(req);
    if (token) await store.deleteSession(hashSessionToken(token));
    res.setHeader(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        path: "/",
        maxAge: 0,
      })
    );
    res.status(204).end();
  });

  api.get("/auth/me", requireUser, (req, res) => {
    res.json({ user: toPublicUser((req as AuthedRequest).user) });
  });

  api.get("/playlists", async (_req, res) => {
    const playlists = await Promise.all(
      PLAYLISTS.map(
        async (playlist): Promise<PlaylistMeta> => ({
          id: playlist.id,
          name: (await playlistTitle(playlist.id)) ?? playlist.fallbackName,
          blurb: playlist.blurb,
          accent: playlist.accent,
          symbol: playlist.symbol,
        })
      )
    );
    res.json(playlists);
  });

  api.get("/videos", async (req, res) => {
    const raw = typeof req.query.ids === "string" ? req.query.ids : "";
    const ids = [...new Set(raw.split(",").filter(Boolean))];
    if (ids.length === 0 || ids.length > MAX_VIDEO_IDS || !ids.every(isValidVideoId)) {
      throw new HttpError(
        400,
        "invalid_request",
        `Pass 1–${MAX_VIDEO_IDS} comma-separated video ids as ?ids=.`
      );
    }
    res.json(await videoMeta(ids));
  });

  api.get("/references", async (_req, res) => {
    res.json(await store.listReferenceTracks());
  });

  api.get("/references/:videoId", async (req, res) => {
    const videoId = parseBody(videoIdSchema, req.params.videoId);
    const track = await store.getReferenceTrack(videoId);
    if (!track) {
      throw new HttpError(404, "no_reference", "No routine has been recorded for this video yet.");
    }
    res.json(track);
  });

  api.put("/references/:videoId", requireUser, async (req, res) => {
    const videoId = parseBody(videoIdSchema, req.params.videoId);
    const input = parseBody(saveReferenceSchema, req.body);
    const summary = await store.saveReferenceTrack({
      videoId,
      playlistId: input.playlistId,
      title: input.title,
      sampleRateHz: input.sampleRateHz,
      durationMs: input.durationMs,
      frames: input.frames,
      recordedBy: (req as AuthedRequest).user.id,
    });
    res.json(summary);
  });

  api.post("/runs", requireUser, async (req, res) => {
    const input = parseBody(submitRunSchema, req.body);
    if (!(await store.hasReferenceTrack(input.videoId))) {
      throw new HttpError(409, "no_reference", "This video has no routine to score against.");
    }
    const result = await store.recordRun({
      userId: (req as AuthedRequest).user.id,
      videoId: input.videoId,
      playlistId: input.playlistId,
      title: input.title,
      // Derived here, never taken from the client.
      points: computePoints(input.tierCounts, input.maxCombo),
      grade: gradeForAccuracy(input.accuracy),
      accuracy: input.accuracy,
      maxCombo: input.maxCombo,
      scoredFrames: totalFrames(input.tierCounts),
      tierCounts: input.tierCounts,
      durationMs: input.durationMs,
    });
    res.status(201).json(result);
  });

  api.get("/progress", requireUser, async (req, res) => {
    res.json(await store.getProgress((req as AuthedRequest).user.id));
  });

  api.use(() => {
    throw new HttpError(404, "not_found", "No such endpoint.");
  });

  app.use("/api", api);

  if (staticDir && existsSync(path.join(staticDir, "index.html"))) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  // Express recognises error handlers by their four-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
      res.status(error.status).json(body);
      return;
    }
    // Malformed JSON and oversized bodies surface from express.json().
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 413) {
      const body: ApiErrorBody = {
        error: {
          code: status === 413 ? "too_large" : "invalid_json",
          message: status === 413 ? "Request body is too large." : "Request body is not valid JSON.",
        },
      };
      res.status(status).json(body);
      return;
    }
    console.error(error);
    const body: ApiErrorBody = {
      error: { code: "internal", message: "Something went wrong on our side." },
    };
    res.status(500).json(body);
  });

  return app;
}
