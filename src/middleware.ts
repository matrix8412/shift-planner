import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/setup", "/api/auth", "/api/health", "/offline", "/manifest.webmanifest", "/sw.js", "/icons"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public paths and static assets
  if (isPublicPath(pathname) || pathname.startsWith("/_next") || pathname.includes(".")) {
    // Inject pathname header for the layout
    const response = NextResponse.next();
    response.headers.set("x-next-pathname", pathname);
    return response;
  }

  const sessionCookie = request.cookies.get("pohotovosti.session");

  if (!sessionCookie?.value) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set("x-next-pathname", pathname);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
