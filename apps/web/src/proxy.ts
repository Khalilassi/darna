import { NextResponse, type NextRequest } from "next/server";

/** Redirects "/" to the visitor's preferred language (Arabic if preferred, else English). */
export function proxy(request: NextRequest) {
  const accept = request.headers.get("accept-language") ?? "";
  const prefersArabic = /^\s*ar\b/i.test(accept);
  return NextResponse.redirect(new URL(prefersArabic ? "/ar" : "/en", request.url), 307);
}

export const config = { matcher: ["/"] };
