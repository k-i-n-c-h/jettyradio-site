export interface Env {
  DB: D1Database;
  CLERK_JWT_KEY: string;
  CLERK_ISSUER: string;
  CLERK_ALLOWED_USER_IDS: string;
  ALLOWED_ORIGINS: string;
  AZURACAST_API_KEY: string;
  GOOGLE_SERVICE_ACCOUNT?: string;
  SUBMISSIONS_ENABLED?: string;
  SUBMISSIONS_SHEET_ID?: string;
  SUBMISSIONS_SHEET_TAB?: string;
}
