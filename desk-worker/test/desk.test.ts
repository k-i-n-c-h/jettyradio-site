import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHandler } from "../src/index";
import type { Env } from "../src/types";
import { validateShows, mp3Filename } from "../src/validation.mjs";
import { scheduleFor, overlap, hasAired } from "../src/schedule-rules.mjs";
import { base64Body } from "../src/base64-stream.mjs";
const origin = "https://jettyradio.com",
  issuer = "https://clerk.jettyradio.com";
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_desk.sql", import.meta.url),
      "utf8"
    )
  );
  const binding = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const statement = db.prepare(sql);
          return {
            async first() {
              return statement.get(...(args as never[])) || null;
            },
            async run() {
              const result = statement.run(...(args as never[]));
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
  };
  const env = {
    DB: binding,
    CLERK_JWT_KEY: "test-key",
    CLERK_ISSUER: issuer,
    CLERK_ALLOWED_USER_IDS: "user_admin",
    ALLOWED_ORIGINS: origin,
    AZURACAST_API_KEY: "",
  } as unknown as Env;
  const handler = createHandler(async (token) => {
    if (token === "invalid") throw new Error("invalid");
    return { sub: token, iss: issuer, azp: origin };
  });
  return { env, handler, db };
}
function request(
  path = "/api/desk",
  method = "GET",
  body?: unknown,
  token = "user_admin",
  from = origin
) {
  return new Request("https://desk.example.com" + path, {
    method,
    headers: {
      Origin: from,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const show = {
  id: "test",
  title: "Example",
  artist: "DJ",
  date: "2026-09-20",
  start: "16:00",
  end: "18:00",
  owner: "Mariel",
  audio: "https://drive.google.com/audio",
  art: "https://drive.google.com/art",
  notes: "",
  dateConfirmed: true,
  audioReviewed: true,
  artReviewed: true,
  status: "ready",
};
test("unauthorized origins are rejected without CORS access", async () => {
  const { handler, env } = setup();
  const r = await handler(
    request(
      "/api/desk",
      "GET",
      undefined,
      "user_admin",
      "https://evil.example"
    ),
    env
  );
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
});
test("preflight permits only the configured website", async () => {
  const { handler, env } = setup();
  const r = await handler(request("/api/desk", "OPTIONS"), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), origin);
});
test("a signed-in unapproved account cannot read plans", async () => {
  const { handler, env } = setup();
  assert.equal(
    (await handler(request("/api/desk", "GET", undefined, "user_other"), env))
      .status,
    403
  );
});
test("invalid sessions and absent configuration fail closed", async () => {
  const { handler, env } = setup();
  assert.equal(
    (await handler(request("/api/desk", "GET", undefined, "invalid"), env))
      .status,
    401
  );
  env.CLERK_ALLOWED_USER_IDS = "";
  assert.equal((await handler(request(), env)).status, 503);
});
test("a token from another Clerk issuer is rejected", async () => {
  const { env } = setup();
  const handler = createHandler(async () => ({
    sub: "user_admin",
    iss: "https://other.example",
    azp: origin,
  }));
  assert.equal((await handler(request(), env)).status, 403);
});
test("persisted plans survive reads and reject stale teammate writes", async () => {
  const { handler, env } = setup();
  assert.equal(
    (
      await handler(
        request("/api/desk", "PUT", { shows: [show], revision: 0 }),
        env
      )
    ).status,
    200
  );
  assert.equal(
    (
      await handler(
        request("/api/desk", "PUT", { shows: [], revision: 0 }),
        env
      )
    ).status,
    409
  );
  let data = (await (await handler(request(), env)).json()) as {
    shows: (typeof show)[];
    revision: number;
  };
  assert.equal(data.shows[0].title, "Example");
  assert.equal(data.revision, 1);
  assert.equal(
    (
      await handler(
        request("/api/desk", "PUT", {
          shows: [{ ...show, title: "Updated" }],
          revision: 1,
        }),
        env
      )
    ).status,
    200
  );
  assert.equal(
    (
      await handler(
        request("/api/desk", "PUT", { shows: [], revision: 1 }),
        env
      )
    ).status,
    409
  );
  data = (await (await handler(request(), env)).json()) as typeof data;
  assert.equal(data.shows[0].title, "Updated");
});
test("ready reviews need all checks, and invalid data is not saved", async () => {
  const { handler, env, db } = setup();
  assert.equal(
    (
      await handler(
        request("/api/desk", "PUT", {
          shows: [{ ...show, audioReviewed: false }],
          revision: 0,
        }),
        env
      )
    ).status,
    400
  );
  assert.equal(db.prepare("SELECT count(*) AS n FROM desk").get()?.n, 0);
});
test("concurrent scheduling requests cannot acquire the same station lease", async () => {
  const { handler, env, db } = setup();
  db.prepare("INSERT INTO locks VALUES (?, ?, ?)").run(
    "station",
    "another-user",
    Date.now() + 60000
  );
  assert.equal(
    (await handler(request("/api/azura/schedule", "POST", {}), env)).status,
    409
  );
});
test("unconfigured station connection never returns credentials", async () => {
  const { handler, env } = setup();
  const body = await (await handler(request("/api/azura"), env)).json();
  assert.deepEqual(body, { connected: false, playlists: [], files: [] });
});
test("draft overlap and unsafe asset links are rejected", () => {
  assert.throws(
    () => validateShows([show, { ...show, id: "other", start: "17:00" }]),
    /overlap/
  );
  assert.throws(
    () => validateShows([{ ...show, audio: "javascript:alert(1)" }]),
    /https/
  );
});
test("one-off schedule respects the Sunday date and existing conflicts", () => {
  assert.deepEqual(scheduleFor(show), {
    start_time: 1600,
    end_time: 1800,
    start_date: "2026-09-20",
    end_date: "2026-09-20",
    days: [7],
    loop_once: true,
  });
  assert.equal(
    overlap({ start_time: 1700, end_time: 1900, days: [7] }, show),
    true
  );
  assert.equal(
    overlap(
      { start_time: 1700, end_time: 1900, days: [7], end_date: "2026-09-13" },
      show
    ),
    false
  );
});
test("audio streaming preserves arbitrary chunk boundaries", async () => {
  const bytes = new Uint8Array(40001).map((_, i) => i % 256);
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 101)
        c.enqueue(bytes.slice(i, i + 101));
      c.close();
    },
  });
  const body = JSON.parse(
    await new Response(base64Body(stream, "review/test.mp3")).text()
  );
  assert.deepEqual(Buffer.from(body.file, "base64"), Buffer.from(bytes));
});
test("overnight conflicts include the previous day and respect boundaries", () => {
  const early = { ...show, start: "00:30", end: "02:00" };
  assert.equal(
    overlap(
      {
        start_time: 2300,
        end_time: 100,
        days: [6],
        start_date: "2026-09-19",
        end_date: "2026-09-19",
      },
      early
    ),
    true
  );
  assert.equal(
    overlap({ start_time: 2300, end_time: 30, days: [6] }, early),
    false
  );
  assert.equal(
    overlap({ start_time: 2300, end_time: 100, days: [7] }, early),
    false
  );
});
test("same-day elapsed Pacific slots cannot be scheduled", async () => {
  const { isPast } = await import("../src/schedule-rules.mjs");
  assert.equal(isPast(show, new Date("2026-09-20T23:01:00Z")), true);
  assert.equal(isPast(show, new Date("2026-09-20T22:59:00Z")), false);
});
test("oversized streamed plans fail before they are stored", async () => {
  const { handler, env, db } = setup();
  const r = await handler(
    request("/api/desk", "PUT", { notes: "x".repeat(1000001) }),
    env
  );
  assert.equal(r.status, 413);
  assert.equal(db.prepare("SELECT count(*) AS n FROM desk").get()?.n, 0);
});
test("uploads validate chunk size and forward only server-selected fields", async (t) => {
  const { upload } = await import("../src/upload");
  const { env } = setup();
  env.AZURACAST_API_KEY = "test-secret";
  const calls: { path: string; form?: FormData }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: URL | string, init?: RequestInit) => {
      calls.push({
        path: String(url),
        form: init?.body instanceof FormData ? init.body : undefined,
      });
      return Response.json(
        String(url).endsWith("/files") ? [] : { success: true }
      );
    }
  );
  const query =
    "?name=episode.mp3&uploadId=12345678-1234-1234-1234-123456789abc&size=2097152&chunk=1";
  const bad = await upload(
    new Request("https://desk.test/api/azura/upload" + query, {
      method: "POST",
      body: new Uint8Array(5),
    }),
    env
  );
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
  const response = await upload(
    new Request("https://desk.test/api/azura/upload" + query, {
      method: "POST",
      body: new Uint8Array(1048576),
    }),
    env
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { complete: false, chunk: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].form?.get("currentDirectory"), "");
  assert.equal(calls[1].form?.get("flowTotalChunks"), "2");
  assert.equal(calls[1].form?.get("flowChunkNumber"), "1");
  assert.equal(calls[1].form?.get("searchPhrase"), null);
  assert.equal((calls[1].form?.get("file") as File).size, 1048576);
});

test("scheduling rejects a changed plan before contacting the station", async (t) => {
  const { handler, env } = setup();
  await handler(
    request("/api/desk", "PUT", { shows: [show], revision: 0 }),
    env
  );
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Unexpected station call");
  });
  const result = await handler(
    request("/api/azura/schedule", "POST", {
      showId: show.id,
      playlistId: 1,
      mediaId: 1,
      expectedSchedule: "[]",
      expectedRevision: 0,
    }),
    env
  );
  assert.equal(result.status, 400);
  assert.match(
    ((await result.json()) as { error: string }).error,
    /plan changed/
  );
  assert.equal(calls, 0);
});

test("AzuraCast empty chunk acknowledgments do not fail JSON parsing", async (t) => {
  const { client } = await import("../src/azura");
  const { env } = setup();
  env.AZURACAST_API_KEY = "test-secret";
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 200 })
  );
  assert.deepEqual(await client(env)("/files/upload", { method: "POST" }), {
    success: true,
  });
  await assert.rejects(client(env)("/files"));
});

test("uploaded file lookup preserves the chosen name and uses a unique lowercase suffix", async (t) => {
  const { upload } = await import("../src/upload");
  const { env } = setup();
  env.AZURACAST_API_KEY = "test-secret";
  const id = "12345678-1234-1234-1234-123456789abc";
  const path = `my-mix-${id}.mp3`;
  let uploaded = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/files/upload")) {
        assert.equal((init?.body as FormData).get("flowFilename"), path);
        uploaded = true;
        return Response.json({ success: true });
      }
      return Response.json(
        uploaded ? [{ id: 99, path, title: "Example", playlists: [] }] : []
      );
    }
  );
  const result = await upload(
    new Request(
      `https://desk.test/api/azura/upload?name=My%20Mix.MP3&uploadId=${id}&size=3&chunk=1`,
      { method: "POST", body: new Uint8Array(3) }
    ),
    env
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    id: 99,
    title: "Example",
    path,
    complete: true,
  });
});

test("MP3 names stay readable without allowing paths or overwriting another upload", () => {
  const name = "DJ Café — September Mix.MP3";
  assert.equal(mp3Filename(name, "first"), "dj-cafe-september-mix-first.mp3");
  assert.notEqual(mp3Filename(name, "first"), mp3Filename(name, "second"));
  for (const invalid of [
    "",
    "../episode.mp3",
    "folder\\episode.mp3",
    "bad\u0000name.mp3",
    "💿",
    "a".repeat(181),
  ]) {
    assert.throws(() => mp3Filename(invalid, "upload"));
    assert.throws(() => validateShows([{ ...show, uploadName: invalid }]));
  }
});

test("linked audio imports reject arbitrary hosts and non-audio Drive responses", async (t) => {
  const { driveDownloadUrl, importAudio } = await import("../src/import-audio");
  assert.throws(
    () => driveDownloadUrl("https://127.0.0.1/audio.mp3"),
    /Google Drive/
  );
  assert.throws(
    () =>
      driveDownloadUrl("https://drive.google.com.evil.test/file/d/abcdefghijk"),
    /Google Drive/
  );
  const { handler, env } = setup();
  await handler(
    request("/api/desk", "PUT", {
      shows: [
        { ...show, audio: "https://drive.google.com/file/d/abcdefghijk/view" },
      ],
      revision: 0,
    }),
    env
  );
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("<html>Sign in</html>", {
        headers: { "Content-Type": "text/html" },
      })
  );
  const response = await importAudio(
    request("/api/azura/import", "POST", {
      showId: show.id,
      revision: 1,
      chunk: 1,
      uploadId: "12345678-1234-1234-1234-123456789abc",
    }),
    env
  );
  assert.equal(response.status, 400);
  assert.match(
    ((await response.json()) as { error: string }).error,
    /did not allow/
  );
});

for (const reviewed of [true, false]) {
  test(`linked audio imports preserve the saved source and ranges for a ${reviewed ? "reviewed" : "draft"} episode`, async (t) => {
    const { importAudio } = await import("../src/import-audio");
    const { handler, env } = setup();
    env.AZURACAST_API_KEY = "test-secret";
    const id = "12345678-1234-1234-1234-123456789abc",
      path = `${reviewed ? "dj-cafe-september-mix" : "example-2026-09-20"}-${id}.mp3`;
    await handler(
      request("/api/desk", "PUT", {
        shows: [
          {
            ...show,
            ...(reviewed ? { uploadName: "DJ Café — September Mix.mp3" } : {}),
            audio: "https://drive.google.com/file/d/abcdefghijk/view",
            art: reviewed ? show.art : "",
            dateConfirmed: reviewed,
            audioReviewed: reviewed,
            artReviewed: reviewed,
            status: reviewed ? "ready" : "draft",
          },
        ],
        revision: 0,
      }),
      env
    );
    let uploaded = false;
    t.mock.method(
      globalThis,
      "fetch",
      async (url: string | URL, init?: RequestInit) => {
        if (String(url).startsWith("https://drive.usercontent.google.com/")) {
          assert.equal(
            new URL(String(url)).searchParams.get("id"),
            "abcdefghijk"
          );
          assert.equal(
            new Headers(init?.headers).get("Range"),
            "bytes=0-1048575"
          );
          return new Response(new Uint8Array([73, 68, 51]), {
            status: 206,
            headers: {
              "Content-Type": "audio/mpeg",
              "Content-Range": "bytes 0-2/3",
              "Last-Modified": "Mon, 14 Sep 2026 10:00:00 GMT",
            },
          });
        }
        if (String(url).endsWith("/files/upload")) {
          assert.equal((init?.body as FormData).get("flowFilename"), path);
          uploaded = true;
          return Response.json({ success: true });
        }
        return Response.json(
          uploaded ? [{ id: 99, path, title: "Example", playlists: [] }] : []
        );
      }
    );
    const response = await importAudio(
      request("/api/azura/import", "POST", {
        showId: show.id,
        revision: 1,
        chunk: 1,
        uploadId: id,
      }),
      env
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      id: number;
      complete: boolean;
      size: number;
    };
    assert.equal(result.id, 99);
    assert.equal(result.complete, true);
    assert.equal(result.size, 3);
  });
}

for (const {
  label,
  length,
  error,
  artworkStatus = 200,
  artworkType = "image/jpeg",
  artworkLocation,
  localArtwork,
  savedArtworkName,
} of [
  { label: "audio within the slot", length: 45 },
  { label: "a 12-second overrun", length: 7212 },
  { label: "a 15-second overrun", length: 7215 },
  {
    label: "an overrun beyond 15 seconds",
    length: 7215.1,
    error: /16 seconds longer than the slot.*Up to 15 seconds is allowed/,
  },
  {
    label: "a missing duration",
    length: undefined,
    error: /valid audio duration/,
  },
  { label: "a zero duration", length: 0, error: /valid audio duration/ },
  { label: "a negative duration", length: -1, error: /valid audio duration/ },
  {
    label: "a non-finite duration",
    length: NaN,
    error: /valid audio duration/,
  },
  {
    label: "artwork requiring Google sign-in",
    length: 7212,
    artworkStatus: 302,
    artworkType: "application/binary",
    artworkLocation: "https://accounts.google.com/ServiceLogin?service=wise",
    error: /artwork requires Google sign-in.*Drop the reviewed JPEG or PNG/,
  },
  {
    label: "denied artwork access",
    length: 7212,
    artworkStatus: 403,
    error: /Google Drive denied the artwork download/,
  },
  {
    label: "an unavailable artwork file",
    length: 7212,
    artworkStatus: 503,
    error: /Google Drive could not return the artwork/,
  },
  {
    label: "an artwork link returning a web page",
    length: 7212,
    artworkType: "text/html",
    error: /artwork link did not return a JPEG or PNG image/,
  },
  {
    label: "a JPEG with mixed-case content type",
    length: 7212,
    artworkType: "Image/JPEG; charset=binary",
  },
  {
    label: "a dropped JPEG without a Drive link",
    length: 7212,
    localArtwork: {
      name: "cover.jpg",
      type: "image/jpeg",
      bytes: new Uint8Array([255, 216, 255]),
    },
  },
  {
    label: "a dropped PNG without a Drive link",
    length: 7212,
    localArtwork: {
      name: "cover.png",
      type: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  },
  {
    label: "an unsupported dropped image type",
    length: 7212,
    localArtwork: {
      name: "cover.gif",
      type: "image/gif",
      bytes: new Uint8Array([71, 73, 70]),
    },
    error: /Choose a JPEG or PNG artwork image/,
  },
  {
    label: "a file disguised as a JPEG",
    length: 7212,
    localArtwork: {
      name: "cover.jpg",
      type: "image/jpeg",
      bytes: new Uint8Array([60, 104, 116, 109, 108]),
    },
    error: /not a valid JPEG or PNG/,
  },
  {
    label: "a dropped image over 10 MB",
    length: 7212,
    localArtwork: {
      name: "cover.jpg",
      type: "image/jpeg",
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
    },
    error: /up to 10 MB/,
  },
  {
    label: "a saved image that was not reselected",
    length: 7212,
    savedArtworkName: "cover.jpg",
    error: /reviewed artwork is missing or changed/,
  },
  {
    label: "an image different from the saved review",
    length: 7212,
    savedArtworkName: "original.jpg",
    localArtwork: {
      name: "replacement.jpg",
      type: "image/jpeg",
      bytes: new Uint8Array([255, 216, 255]),
    },
    error: /reviewed artwork is missing or changed/,
  },
]) {
  test(`SOP scheduling handles ${label} and preserves the recurring slot`, async (t) => {
    const { handler, env, db } = setup();
    env.AZURACAST_API_KEY = "test-secret";
    const date = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10),
      day = new Date(date + "T12:00:00Z").getUTCDay() || 7;
    const episode = {
      ...show,
      date,
      audio: "https://drive.google.com/file/d/abcdefghijk/view",
      art:
        localArtwork || savedArtworkName
          ? ""
          : "https://drive.google.com/file/d/artabcdefghijk/view",
      ...(localArtwork || savedArtworkName
        ? { artUploadName: savedArtworkName || localArtwork?.name }
        : {}),
      tracklist: "Track one",
      mediaId: 99,
      mediaPath: "jettydeskreview-test.mp3",
      audioImportedFrom: "https://drive.google.com/file/d/abcdefghijk/view",
      directory: "Example Show",
      playlistId: 5,
    };
    await handler(
      request("/api/desk", "PUT", { shows: [episode], revision: 0 }),
      env
    );
    const playlist = {
      id: 5,
      name: "Example Show",
      source: "songs",
      is_enabled: false,
      schedule_items: [
        {
          start_time: 1600,
          end_time: 1800,
          days: [day],
          start_date: "2020-01-01",
          end_date: "2020-01-01",
        },
      ],
    };
    const expected = JSON.stringify(playlist.schedule_items),
      file: any = {
        id: 99,
        path: episode.mediaPath,
        title: "Original",
        artist: "",
        length,
        playlists: [],
        lyrics: "",
        custom_fields: {},
      };
    let artSaved = false;
    const writes: string[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (url: string | URL, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        if (init?.method && init.method !== "GET") writes.push(path);
        if (String(url).startsWith("https://drive.usercontent.google.com/")) {
          assert.equal(
            episode.artUploadName,
            undefined,
            "Dropped artwork must not be fetched from Drive"
          );
          return new Response(new Uint8Array([255, 216, 255]), {
            status: artworkStatus,
            headers: {
              "Content-Type": artworkType,
              ...(artworkLocation ? { Location: artworkLocation } : {}),
            },
          });
        }
        if (path.endsWith("/playlists")) return Response.json([playlist]);
        if (path.endsWith("/files/directories"))
          return Response.json({ rows: [{ path: "Example Show" }] });
        if (path.endsWith("/files")) return Response.json([file]);
        if (path.endsWith("/file/99")) {
          if (init?.method === "PUT") {
            const update = JSON.parse(init.body as string);
            Object.assign(file, update, {
              playlists: update.playlists.map((id: number) => ({ id })),
            });
          }
          return Response.json(file);
        }
        if (path.endsWith("/art/99")) {
          if (localArtwork) {
            const image = (init?.body as FormData).get("file") as File;
            assert.equal(image.type, localArtwork.type);
            assert.deepEqual(
              new Uint8Array(await image.arrayBuffer()),
              localArtwork.bytes
            );
          }
          artSaved = true;
          return Response.json({ success: true });
        }
        if (path.endsWith("/files/batch")) {
          const body = JSON.parse(init?.body as string);
          assert.deepEqual(body.files, [episode.mediaPath]);
          assert.equal(body.do, "move");
          file.path = "Example Show/" + episode.mediaPath;
          return Response.json({ errors: [] });
        }
        if (path.endsWith("/playlist/5")) {
          if (init?.method === "PUT") {
            assert.equal(artSaved, true);
            Object.assign(playlist, JSON.parse(init.body as string));
          }
          return Response.json(playlist);
        }
        throw new Error("Unexpected station operation " + path);
      }
    );
    const payload = {
      showId: episode.id,
      playlistId: 5,
      expectedRevision: 1,
      expectedSchedule: expected,
    };
    let submission = request("/api/azura/schedule", "POST", payload);
    if (localArtwork) {
      const body = new FormData();
      body.set("payload", JSON.stringify(payload));
      body.set(
        "artwork",
        new Blob([localArtwork.bytes], { type: localArtwork.type }),
        localArtwork.name
      );
      submission = new Request("https://desk.example.com/api/azura/schedule", {
        method: "POST",
        headers: { Origin: origin, Authorization: "Bearer user_admin" },
        body,
      });
    }
    const result = await handler(submission, env);
    if (error) {
      assert.equal(result.status, 400);
      assert.match(((await result.json()) as { error: string }).error, error);
      assert.deepEqual(writes, []);
      assert.equal(artSaved, false);
      assert.equal(playlist.is_enabled, false);
      assert.equal(
        (db.prepare("SELECT revision FROM desk").get() as { revision: number })
          .revision,
        1
      );
      return;
    }
    assert.equal(
      result.status,
      200,
      JSON.stringify(await result.clone().json())
    );
    assert.equal(playlist.is_enabled, true);
    assert.equal(playlist.schedule_items[0].start_date, null);
    assert.equal(playlist.schedule_items[0].end_date, null);
    assert.deepEqual(playlist.schedule_items[0].days, [day]);
    assert.equal(file.title, show.title);
    assert.equal(file.lyrics, "Track one");
    assert.equal(
      file.custom_fields.air_date,
      `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`
    );
    const stored = JSON.parse(
      (db.prepare("SELECT data FROM desk").get() as { data: string }).data
    );
    assert.ok(stored.shows[0].scheduledAt);
  });
}

test("a recurring playlist cannot be enabled before the intended episode occurrence", async () => {
  const { isNextOccurrence } = await import("../src/schedule-rules.mjs");
  const now = new Date("2026-09-14T21:00:00Z");
  assert.equal(isNextOccurrence({ ...show, date: "2026-09-20" }, now), true);
  assert.equal(isNextOccurrence({ ...show, date: "2026-09-27" }, now), false);
  assert.equal(isNextOccurrence({ ...show, date: "2026-09-21" }, now), false);
});

test("archiving waits for the Pacific end time and the audio allowance, including winter time", () => {
  for (const [date, endUtc] of [
    ["2026-09-20", "2026-09-21T01:00:00Z"],
    ["2026-12-20", "2026-12-21T02:00:00Z"],
  ]) {
    const end = new Date(endUtc).getTime();
    assert.equal(hasAired({ ...show, date }, new Date(end - 1)), false);
    assert.equal(hasAired({ ...show, date }, new Date(end + 14000)), false);
    assert.equal(hasAired({ ...show, date }, new Date(end + 15000)), true);
  }
});

test("archiving uses the scheduling lease and rejects unapproved accounts", async () => {
  const { handler, env, db } = setup();
  assert.equal(
    (
      await handler(
        request("/api/azura/archive", "POST", {}, "user_other"),
        env
      )
    ).status,
    403
  );
  db.prepare("INSERT INTO locks VALUES (?, ?, ?)").run(
    "station",
    "scheduler",
    Date.now() + 60000
  );
  assert.equal(
    (await handler(request("/api/azura/archive", "POST", {}), env)).status,
    409
  );
});

for (const scenario of [
  "complete",
  "ISO date",
  "short date",
  "missing date",
  "partly archived",
  "retry",
  "future",
  "stale plan",
  "different date",
  "different file",
  "other episode",
  "missing destination",
  "ambiguous destination",
  "new episode during archive",
  "file write failure",
  "unconfirmed file",
  "disable failure",
  "concurrent plan save",
] as const) {
  test(`archiving handles ${scenario} without disturbing other media or playlist settings`, async (t) => {
    const { handler, env, db } = setup();
    env.AZURACAST_API_KEY = "test-secret";
    const episode = {
      ...show,
      date: scenario === "future" ? "2099-09-20" : "2020-09-20",
      mediaId: 99,
      mediaPath: "Example/episode.mp3",
      playlistId: 5,
      audioImportedFrom: show.audio,
      scheduledAt: "2020-09-19T12:00:00Z",
    };
    await handler(
      request("/api/desk", "PUT", { shows: [episode], revision: 0 }),
      env
    );
    const playlist = {
      id: 5,
      name: "Example Show",
      source: "songs",
      is_enabled: scenario !== "partly archived",
      schedule_items: [{ start_time: 1600, end_time: 1800, days: [7] }],
    };
    const originalSchedule = structuredClone(playlist.schedule_items);
    const destinations = [
      { id: 8, name: "Archives", source: "songs" },
      { id: 12, name: "heavy rotation", source: "songs" },
    ];
    const file: any = {
      id: 99,
      title: "Episode",
      path: scenario === "different file" ? "another.mp3" : episode.mediaPath,
      custom_fields: {
        air_date:
          scenario === "ISO date"
            ? "2020-09-20"
            : scenario === "short date"
              ? "9/20/2020"
              : scenario === "missing date"
                ? ""
                : scenario === "different date"
                  ? "09/27/2020"
                  : "09/20/2020",
        other: "keep",
      },
      playlists: [{ id: 5 }, { id: 17 }],
    };
    if (scenario === "partly archived")
      file.playlists = [{ id: 8 }, { id: 17 }];
    if (scenario === "retry")
      file.playlists = [{ id: 8 }, { id: 12 }, { id: 17 }];
    const others: any[] =
      scenario === "other episode" ? [{ id: 100, playlists: [{ id: 5 }] }] : [];
    let fileReads = 0;
    const writes: string[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (url: string | URL, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        if (init?.method === "PUT") writes.push(path);
        if (path.endsWith("/playlists"))
          return Response.json([
            playlist,
            ...(scenario === "missing destination"
              ? destinations.slice(0, 1)
              : destinations),
            ...(scenario === "ambiguous destination"
              ? [{ ...destinations[1], id: 13 }]
              : []),
          ]);
        if (path.endsWith("/files")) {
          if (++fileReads === 2 && scenario === "new episode during archive")
            others.push({ id: 100, playlists: [{ id: 5 }] });
          return Response.json([file, ...others]);
        }
        if (path.endsWith("/file/99")) {
          if (init?.method === "PUT") {
            if (scenario === "file write failure")
              return new Response("failed", { status: 500 });
            const update = JSON.parse(init.body as string);
            assert.deepEqual(Object.keys(update).sort(), [
              "custom_fields",
              "playlists",
            ]);
            if (scenario !== "unconfirmed file")
              Object.assign(file, update, {
                playlists: update.playlists.map((id: number) => ({ id })),
              });
          }
          return Response.json(file);
        }
        if (path.endsWith("/playlist/5")) {
          if (init?.method === "PUT") {
            assert.deepEqual(JSON.parse(init.body as string), {
              is_enabled: false,
            });
            assert.equal(file.custom_fields.air_date, "09/20/2020");
            assert.deepEqual(
              file.playlists
                .map((p: { id: number }) => p.id)
                .sort((a: number, b: number) => a - b),
              [8, 12, 17]
            );
            if (scenario === "disable failure")
              return new Response("failed", { status: 500 });
            playlist.is_enabled = false;
            if (scenario === "concurrent plan save") {
              db.prepare("UPDATE desk SET data = ?, revision = 2").run(
                JSON.stringify({
                  shows: [{ ...episode, notes: "Teammate edit" }],
                })
              );
            }
          }
          return Response.json(playlist);
        }
        throw new Error("Unexpected request " + path);
      }
    );
    const response = await handler(
      request("/api/azura/archive", "POST", {
        showId: episode.id,
        expectedRevision: scenario === "stale plan" ? 0 : 1,
      }),
      env
    );
    const result = (await response.json()) as any;
    const stored = JSON.parse(
      (db.prepare("SELECT data FROM desk").get() as { data: string }).data
    );
    assert.deepEqual(playlist.schedule_items, originalSchedule);
    assert.equal(file.custom_fields.other, "keep");
    assert.equal(file.title, "Episode");
    assert.equal(db.prepare("SELECT count(*) AS n FROM locks").get()?.n, 0);
    if (
      [
        "complete",
        "ISO date",
        "short date",
        "missing date",
        "partly archived",
        "retry",
        "concurrent plan save",
      ].includes(scenario)
    ) {
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(playlist.is_enabled, false);
      assert.equal(file.custom_fields.air_date, "09/20/2020");
      assert.deepEqual(
        file.playlists
          .map((p: { id: number }) => p.id)
          .sort((a: number, b: number) => a - b),
        [8, 12, 17]
      );
      if (scenario === "concurrent plan save") {
        assert.equal(result.planUpdated, false);
        assert.equal(stored.shows[0].notes, "Teammate edit");
        assert.equal(stored.shows[0].status, "ready");
      } else {
        assert.equal(stored.shows[0].status, "archived");
        assert.equal(stored.shows[0].scheduledAt, episode.scheduledAt);
        const beforeRetry = writes.length;
        const retry = await handler(
          request("/api/azura/archive", "POST", {
            showId: episode.id,
            expectedRevision: 2,
          }),
          env
        );
        assert.equal(retry.status, 200);
        assert.equal(writes.length, beforeRetry);
      }
    } else {
      assert.equal(response.status, 400, scenario);
      assert.equal(stored.shows[0].status, "ready");
      assert.equal(playlist.is_enabled, true);
      if (
        [
          "new episode during archive",
          "file write failure",
          "unconfirmed file",
          "disable failure",
        ].includes(scenario)
      )
        assert.match(result.error, /Some changes may already be saved/);
      else assert.deepEqual(writes, []);
    }
  });
}

const calendarFixture = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test-calendar
SUMMARY:Example w/ DJ
DTSTART:20260920T230000Z
DTEND:20260921T010000Z
END:VEVENT
END:VCALENDAR`;

test("weekly seeding is authenticated, uses the fixed public feed, and is idempotent", async (t) => {
  const { handler, env } = setup();
  const { calendarUrl } = await import("../src/calendar");
  let requests = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, init?: RequestInit) => {
      requests++;
      assert.equal(url, calendarUrl);
      assert.ok(!init?.method || init.method === "GET");
      return new Response(calendarFixture);
    }
  );
  assert.equal(
    (
      await handler(
        request("/api/desk/seed", "POST", { week: "2026-09-14" }, "user_other"),
        env
      )
    ).status,
    403
  );
  assert.equal(requests, 0);
  assert.equal(
    (
      await handler(
        request("/api/desk/seed", "POST", { week: "2026-02-30" }),
        env
      )
    ).status,
    400
  );
  assert.equal(requests, 0);
  const first = await handler(
    request("/api/desk/seed", "POST", { week: "2026-09-14" }),
    env
  );
  assert.equal(first.status, 200);
  const seeded: any = await first.json();
  assert.equal(seeded.added, 1);
  assert.equal(seeded.shows[0].date, "2026-09-20");
  assert.equal(seeded.shows[0].audio, "");
  const again: any = await (
    await handler(
      request("/api/desk/seed", "POST", { week: "2026-09-14" }),
      env
    )
  ).json();
  assert.equal(again.added, 0);
  assert.equal(again.revision, seeded.revision);
  assert.deepEqual(again.shows, seeded.shows);
});

test("calendar failures preserve the saved plan", async (t) => {
  const { handler, env } = setup();
  await handler(
    request("/api/desk", "PUT", { shows: [show], revision: 0 }),
    env
  );
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("unavailable", { status: 503 })
  );
  assert.equal(
    (
      await handler(
        request("/api/desk/seed", "POST", { week: "2026-09-14" }),
        env
      )
    ).status,
    502
  );
  const saved: any = await (await handler(request(), env)).json();
  assert.deepEqual(saved.shows, [show]);
  assert.equal(saved.revision, 1);
});

test("weekly seeding retries its merge when a teammate saves concurrently", async (t) => {
  const { handler, env, db } = setup();
  await handler(
    request("/api/desk", "PUT", { shows: [show], revision: 0 }),
    env
  );
  t.mock.method(globalThis, "fetch", async () => new Response(calendarFixture));
  const prepare = env.DB.prepare.bind(env.DB);
  let raced = false;
  t.mock.method(env.DB, "prepare", (sql: string) => {
    if (!raced && sql.startsWith("UPDATE desk SET data")) {
      raced = true;
      db.prepare("UPDATE desk SET data = ?, revision = 2").run(
        JSON.stringify({
          shows: [{ ...show, notes: "Teammate edit" }],
          updatedAt: null,
          updatedBy: "teammate",
        })
      );
    }
    return prepare(sql);
  });
  const response = await handler(
    request("/api/desk/seed", "POST", { week: "2026-09-14" }),
    env
  );
  assert.equal(response.status, 200);
  const result: any = await response.json();
  assert.equal(result.shows.length, 1);
  assert.equal(result.shows[0].notes, "Teammate edit");
  assert.equal(result.shows[0].audio, show.audio);
  assert.equal(result.revision, 3);
});
