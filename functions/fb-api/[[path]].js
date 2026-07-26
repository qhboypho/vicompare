const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export async function onRequest({ request, params }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`https://graph.facebook.com/${path}`);
  targetUrl.search = sourceUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");

  const init = {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body
  };

  const upstream = await fetch(targetUrl.toString(), init);
  const responseHeaders = new Headers(upstream.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => responseHeaders.set(key, value));

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}
