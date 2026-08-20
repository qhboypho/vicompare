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

  // Build a minimal header set — forwarding all original headers can
  // include Cloudflare-internal entries that TikTok's gateway rejects
  // with "Unsupported path(Janus)".
  const headers = {};
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  const auth = request.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;
  const cacheControl = request.headers.get("cache-control");
  if (cacheControl) headers["Cache-Control"] = cacheControl;
  const contentRange = request.headers.get("content-range");
  if (contentRange) headers["Content-Range"] = contentRange;

  // Read body fully so Content-Length is set correctly on the outgoing
  // fetch — streaming the original request.body can cause mismatches.
  let body = undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    body = await request.arrayBuffer();
  }

  const upstream = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body
  });

  const responseHeaders = new Headers(upstream.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => responseHeaders.set(key, value));

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}
