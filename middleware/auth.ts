/**
 * Auth Middleware Stub — Prepared for future login integration.
 * Currently passes all requests through (local AgentDB mode).
 *
 * Upgrade path:
 * 1. Replace LOCAL_MODE with a real session check (e.g., Supabase, Clerk, NextAuth)
 * 2. Update matcher to protect all /api/* and dashboard routes
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const LOCAL_MODE = true; // Set to false when auth is implemented

export function middleware(request: NextRequest) {
  if (LOCAL_MODE) {
    // Pass through — no auth required in local/MVP mode
    return NextResponse.next();
  }

  // TODO: Check session token from cookie / header
  // const session = request.cookies.get('session')?.value;
  // if (!session) {
  //   return NextResponse.redirect(new URL('/login', request.url));
  // }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
