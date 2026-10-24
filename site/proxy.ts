import { NextResponse, type NextRequest } from "next/server";

/** `/` picks a language from Accept-Language: Arabic readers land on /ar, everyone else on /en. */
export function proxy(request: NextRequest) {
  const accept = request.headers.get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().toLowerCase() ?? "";
  const url = request.nextUrl.clone();
  url.pathname = first.startsWith("ar") ? "/ar" : "/en";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/"] };
