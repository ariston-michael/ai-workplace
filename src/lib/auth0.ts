import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Reads AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET and
// APP_BASE_URL from the environment (.env.local; never committed).
// Mounts /auth/login, /auth/logout, /auth/callback and /auth/profile via src/proxy.ts.
export const auth0 = new Auth0Client();
