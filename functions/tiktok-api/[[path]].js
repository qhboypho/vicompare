const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control, Content-Range"
};

export async function onRequest({ request, params }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`https://open.tiktokapis.com/${path}`);
  targetUrl.search = sourceUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");

  const upstream = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body
  });

  const responseHeaders = new Headers(upstream.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => responseHeaders.set(key, value));

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}
