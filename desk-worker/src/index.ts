import { episodeTags, updateEpisode } from "./episodes";
import { getDJDirectory } from "./dj-directory";
import { readLimited } from "./body";
import { verifyToken } from "@clerk/backend";
import { validateShows } from "./validation.mjs";
import { station } from "./station";
import { schedule } from "./schedule";
import { reconcile } from "./reconcile";
import { archive } from "./archive";
import { seedWeek } from "./seed";
import { importAudio } from "./import-audio";
import { upload } from "./upload";
import type { Env } from "./types";
const reply = (error: string, status: number) =>
  Response.json({ error }, { status });
const values = (s: string | undefined) =>
  (s || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
export type Verify = (
  token: string,
  env: Env,
  origins: string[]
) => Promise<{ sub: string; iss: string; azp?: string }>;
const verify: Verify = (token, env, origins) =>
  verifyToken(token, { jwtKey: env.CLERK_JWT_KEY, authorizedParties: origins });
export function createHandler(verifySession: Verify = verify) {
  return async function handle(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") || "";
    const origins = values(env.ALLOWED_ORIGINS);
    if (!origin || !origins.includes(origin))
      return reply("Origin is not permitted.", 403);
    const cors = {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Cache-Control": "no-store",
    };
    const finish = (r: Response) => {
      const headers = new Headers(r.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(r.body, { status: r.status, headers });
    };
    if (request.method === "OPTIONS")
      return finish(new Response(null, { status: 204 }));
    if (
      !env.CLERK_JWT_KEY ||
      !env.CLERK_ISSUER ||
      !values(env.CLERK_ALLOWED_USER_IDS).length
    )
      return finish(reply("Team access has not been configured.", 503));
    const token = request.headers
      .get("Authorization")
      ?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return finish(reply("Sign in to Jetty Backstage.", 401));
    let identity;
    try {
      identity = await verifySession(token, env, origins);
    } catch {
      return finish(reply("Your session expired. Sign in again.", 401));
    }
    if (
      identity.iss !== env.CLERK_ISSUER ||
      !identity.azp ||
      !origins.includes(identity.azp) ||
      !values(env.CLERK_ALLOWED_USER_IDS).includes(identity.sub)
    )
      return finish(reply("This account does not have desk access.", 403));
    const path = new URL(request.url).pathname;
    try {
      if (path === "/api/episode-tags" && ["GET", "POST"].includes(request.method))
        return finish(await episodeTags(request, env));
      const episode = path.match(/^\/api\/episodes\/([1-9]\d*)$/);
      if (episode && request.method === "PUT" && Number.isSafeInteger(Number(episode[1])))
        return finish(await updateEpisode(request, env, Number(episode[1])));
      if (path === "/api/djs" && request.method === "GET")
        return finish(await getDJDirectory(env));
      if (path === "/api/desk/seed" && request.method === "POST")
        return finish(await seedWeek(request, env, identity.sub));
      if (path === "/api/desk" && request.method === "GET") {
        const row = await env.DB.prepare(
          "SELECT data, revision FROM desk WHERE id = ?"
        )
          .bind("jetty")
          .first<{ data: string; revision: number }>();
        return finish(
          Response.json({
            ...(row
              ? JSON.parse(row.data)
              : { shows: [], updatedAt: null, updatedBy: null }),
            revision: row?.revision ?? 0,
          })
        );
      }
      if (path === "/api/desk" && request.method === "PUT") {
        if (
          !request.headers.get("Content-Type")?.startsWith("application/json")
        )
          return finish(reply("JSON required.", 415));
        let text;
        try {
          text = new TextDecoder().decode(await readLimited(request, 1000000));
        } catch {
          return finish(reply("Schedule is too large.", 413));
        }
        let body;
        try {
          body = JSON.parse(text);
          validateShows(body.shows);
          if (!Number.isSafeInteger(body.revision) || body.revision < 0)
            throw new Error("Invalid revision.");
        } catch (e) {
          return finish(
            reply(e instanceof Error ? e.message : "Invalid schedule.", 400)
          );
        }
        const data = {
          shows: body.shows,
          updatedAt: new Date().toISOString(),
          updatedBy: identity.sub,
        };
        const result =
          body.revision === 0
            ? await env.DB.prepare(
                "INSERT OR IGNORE INTO desk (id, data, revision) VALUES (?, ?, 1)"
              )
                .bind("jetty", JSON.stringify(data))
                .run()
            : await env.DB.prepare(
                "UPDATE desk SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?"
              )
                .bind(JSON.stringify(data), "jetty", body.revision)
                .run();
        if (result.meta.changes !== 1)
          return finish(
            reply(
              "A teammate saved a newer version. Reload the desk before saving.",
              409
            )
          );
        return finish(Response.json({ ...data, revision: body.revision + 1 }));
      }
      if (path === "/api/azura" && request.method === "GET")
        return finish(await station(request, env));
      if (path === "/api/azura/import" && request.method === "POST")
        return finish(await importAudio(request, env));
      if (path === "/api/azura/upload" && request.method === "POST")
        return finish(await upload(request, env));
      if (
        ["/api/azura/schedule", "/api/azura/archive", "/api/azura/reconcile"].includes(path) &&
        request.method === "POST"
      ) {
        const now = Date.now(),
          owner = crypto.randomUUID();
        const lease = await env.DB.prepare(
          "INSERT INTO locks (id, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE locks.expires_at < ?"
        )
          .bind("station", owner, now + 300000, now)
          .run();
        if (lease.meta.changes !== 1)
          return finish(
            reply(
              "Another scheduling or archiving operation is in progress. Check again shortly.",
              409
            )
          );
        try {
          return finish(
            path === "/api/azura/reconcile"
              ? await reconcile(request, env, identity.sub)
              : path === "/api/azura/archive"
              ? await archive(request, env, identity.sub)
              : await schedule(request, env)
          );
        } finally {
          await env.DB.prepare("DELETE FROM locks WHERE id = ? AND owner = ?")
            .bind("station", owner)
            .run();
        }
      }
      return finish(reply("Not found.", 404));
    } catch {
      return finish(
        reply(
          "The desk service could not complete this request. Check the station before retrying a broadcast change.",
          502
        )
      );
    }
  };
}
export default { fetch: createHandler() };
