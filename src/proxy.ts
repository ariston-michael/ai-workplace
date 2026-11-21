import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

// Pages that need a signed-in user. API routes enforce sign-in and workspace
// ownership themselves (src/lib/workplace/runtime.server.ts), so they are not
// redirected here; they answer 401 instead.
const PROTECTED_PAGES = ["/", "/office", "/workflow", "/procurement"];

export async function proxy(request: NextRequest) {
  const authResponse = await auth0.middleware(request);
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/auth")) return authResponse;

  if (PROTECTED_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const session = await auth0.getSession(request);
    if (!session) {
      const login = new URL("/auth/login", request.url);
      login.searchParams.set("returnTo", `${pathname}${search}`);
      return NextResponse.redirect(login);
    }
  }
  return authResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
