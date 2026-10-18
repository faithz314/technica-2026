import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReferenceFrame, SubmitRunResponse } from "../../src/shared/apiTypes.ts";
import { SEGMENT_COUNT, SEGMENT_VECTOR_LENGTH } from "../../src/shared/poseSegments.ts";
import { computePoints, emptyTierCounts } from "../../src/shared/scoring.ts";
import { createApp } from "./app.ts";
import { MemoryStore } from "./memoryStore.ts";
import { accuracyBounds } from "./validation.ts";

const VIDEO_ID = "3sbjMdCY1S8";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({ store: new MemoryStore(), secureCookies: false });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.close();
});

async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    body: text ? JSON.parse(text) : null,
  };
}

function frames(count: number): ReferenceFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    t: i * 66,
    v: Array.from({ length: SEGMENT_VECTOR_LENGTH }, (_, j) => (j % 2 ? 1 : 0)),
    w: Array.from({ length: SEGMENT_COUNT }, () => 0.9),
  }));
}

async function signup(email: string) {
  const result = await call("POST", "/auth/signup", {
    email,
    displayName: "Tester",
    password: "correct horse",
  });
  expect(result.status).toBe(201);
  return result.cookie!;
}

describe("auth", () => {
  it("signs up, restores the session and logs out", async () => {
    const cookie = await signup("a@example.com");
    const me = await call("GET", "/auth/me", undefined, cookie);
    expect(me.body.user.email).toBe("a@example.com");

    expect((await call("POST", "/auth/logout", undefined, cookie)).status).toBe(204);
    expect((await call("GET", "/auth/me", undefined, cookie)).status).toBe(401);
  });

  it("rejects duplicate emails and wrong passwords", async () => {
    await signup("b@example.com");
    const again = await call("POST", "/auth/signup", {
      email: "B@example.com",
      displayName: "Other",
      password: "another pass",
    });
    expect(again.status).toBe(409);

    const bad = await call("POST", "/auth/login", { email: "b@example.com", password: "nope" });
    expect(bad.status).toBe(401);
    const good = await call("POST", "/auth/login", {
      email: "b@example.com",
      password: "correct horse",
    });
    expect(good.status).toBe(200);
  });
});

describe("references and runs", () => {
  it("requires a reference before a run is accepted, then accumulates totals", async () => {
    const cookie = await signup("c@example.com");
    const counts = { ...emptyTierCounts(), PERFECT: 40, GOOD: 10 };
    const run = {
      videoId: VIDEO_ID,
      accuracy: 0.85,
      maxCombo: 50,
      tierCounts: counts,
      durationMs: 6000,
    };

    expect((await call("POST", "/runs", run, cookie)).status).toBe(409);

    const saved = await call(
      "PUT",
      `/references/${VIDEO_ID}`,
      { sampleRateHz: 15, durationMs: 6000, frames: frames(60) },
      cookie
    );
    expect(saved.status).toBe(200);
    expect(saved.body.frameCount).toBe(60);

    const first = await call("POST", "/runs", run, cookie);
    expect(first.status).toBe(201);
    const result = first.body as SubmitRunResponse;
    expect(result.session.points).toBe(computePoints(counts, 50));
    expect(result.session.grade).toBe("A");

    const second = await call("POST", "/runs", run, cookie);
    expect(second.body.totals.totalPoints).toBe(2 * computePoints(counts, 50));
    expect(second.body.totals.totalPlays).toBe(2);

    const progress = await call("GET", "/progress", undefined, cookie);
    expect(progress.body.songs).toHaveLength(1);
    expect(progress.body.songs[0].plays).toBe(2);
    expect(progress.body.recent).toHaveLength(2);
  });

  it("rejects runs whose numbers do not add up", async () => {
    const cookie = await signup("d@example.com");
    await call(
      "PUT",
      `/references/${VIDEO_ID}`,
      { sampleRateHz: 15, durationMs: 6000, frames: frames(60) },
      cookie
    );
    const tooMany = await call(
      "POST",
      "/runs",
      {
        videoId: VIDEO_ID,
        accuracy: 0.95,
        maxCombo: 10,
        tierCounts: { ...emptyTierCounts(), PERFECT: 10_000 },
        durationMs: 6000,
      },
      cookie
    );
    expect(tooMany.status).toBe(400);

    const inflated = await call(
      "POST",
      "/runs",
      {
        videoId: VIDEO_ID,
        accuracy: 0.99,
        maxCombo: 0,
        tierCounts: { ...emptyTierCounts(), MISS: 50 },
        durationMs: 6000,
      },
      cookie
    );
    expect(inflated.status).toBe(400);
  });

  it("rejects malformed reference frames", async () => {
    const cookie = await signup("e@example.com");
    const bad = frames(60);
    bad[3].v = [1, 2];
    const result = await call(
      "PUT",
      `/references/${VIDEO_ID}`,
      { sampleRateHz: 15, durationMs: 6000, frames: bad },
      cookie
    );
    expect(result.status).toBe(400);
  });
});

describe("accuracyBounds", () => {
  it("brackets a run of a single tier by that tier's thresholds", () => {
    const [low, high] = accuracyBounds({ ...emptyTierCounts(), GREAT: 5 });
    expect(low).toBeCloseTo(0.75);
    expect(high).toBeCloseTo(0.88);
  });
});
