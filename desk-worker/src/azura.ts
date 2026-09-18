import type { Env } from "./types";
export type Schedule = {
  id?: number;
  start_time: number;
  end_time: number;
  start_date?: string | null;
  end_date?: string | null;
  days: number[];
  loop_once?: boolean;
};
export type Playlist = {
  id: number;
  name: string;
  source: string;
  is_enabled: boolean;
  schedule_items: Schedule[];
};
export type Media = {
  id: number;
  title: string;
  artist: string;
  path: string;
  length: number;
  playlists: { id: number; name: string }[];
  lyrics?: string;
  custom_fields?: Record<string, string>;
};
export function client(env: Env) {
  return async function azura(path: string, init: RequestInit = {}) {
    if (!env.AZURACAST_API_KEY)
      throw new Error("The station connection has not been configured.");
    const headers = new Headers(init.headers);
    headers.set("X-API-Key", env.AZURACAST_API_KEY);
    const response = await fetch(
      "https://stream.jettyradio.com/api/station/1" + path,
      {
        ...init,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(
          path === "/files" && init.method === "POST" ? 300000 : 20000
        ),
      }
    );
    if (!response.ok)
      throw new Error(
        `AzuraCast returned ${response.status}. Check the station before retrying a change.`
      );
    const body = await response.text();
    if (!body && path === "/files/upload" && init.method === "POST")
      return { success: true };
    const result = JSON.parse(body);
    if (
      result?.success === false ||
      result?.error ||
      Number(result?.code) >= 400
    )
      throw new Error(
        "AzuraCast did not confirm the requested change. Check the station before retrying."
      );
    return result;
  };
}
