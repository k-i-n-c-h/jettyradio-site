import { readLimited } from "./body";
import { driveDownloadUrl } from "./import-audio";
import type { Env } from "./types";

const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const json64 = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));

export async function googleToken(env: Env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT) throw new Error("Google submission access is not configured.");
  let account: { client_email: string; private_key: string };
  try {
    account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
    if (typeof account.client_email !== "string" || typeof account.private_key !== "string") throw new Error();
  } catch {
    throw new Error("The Google service-account secret must contain client_email and private_key.");
  }
  const pem = account.private_key.replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${json64({ alg: "RS256", typ: "JWT" })}.${json64({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${encode(new Uint8Array(signature))}` }),
  });
  if (!response.ok) throw new Error("Google authentication failed. Check the service-account secret.");
  const result = await response.json() as { access_token?: string };
  if (!result.access_token) throw new Error("Google did not return an access token.");
  return result.access_token;
}

export async function responseRows(env: Env, token: string) {
  if (!env.SUBMISSIONS_SHEET_ID || !env.SUBMISSIONS_SHEET_TAB) throw new Error("Configure the response sheet and tab.");
  const range = `'${env.SUBMISSIONS_SHEET_TAB.replace(/'/g, "''")}'!A:I`;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SUBMISSIONS_SHEET_ID)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("Cannot read the response sheet. Share it with the service account as Viewer.");
  const result = JSON.parse(new TextDecoder().decode(await readLimited(response, 2_000_000)));
  if (!Array.isArray(result.values)) throw new Error("The response sheet is empty.");
  return result.values as string[][];
}

export async function driveFile(link: string, token: string, range?: string) {
  const publicUrl = driveDownloadUrl(link);
  const id = publicUrl.searchParams.get("id")!;
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (range) headers.set("Range", range);
  const resourceKey = publicUrl.searchParams.get("resourcekey");
  if (resourceKey) headers.set("X-Goog-Drive-Resource-Keys", `${id}/${resourceKey}`);
  return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
    headers, redirect: "error", signal: AbortSignal.timeout(20000),
  });
}

export async function driveVersion(link: string, token: string) {
  const url = driveDownloadUrl(link);
  const id = url.searchParams.get("id")!;
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const resourceKey = url.searchParams.get("resourcekey");
  if (resourceKey) headers.set("X-Goog-Drive-Resource-Keys", `${id}/${resourceKey}`);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=version,size,md5Checksum&supportsAllDrives=true`, {
    headers, redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("Cannot read the MP3 in Drive. Share it with the service account as Viewer.");
  const metadata = await response.json() as { version?: string; size?: string; md5Checksum?: string };
  if (!metadata.version || !metadata.size || !metadata.md5Checksum) throw new Error("The Drive file is not a downloadable MP3.");
  return JSON.stringify([metadata.version, metadata.size, metadata.md5Checksum]);
}
