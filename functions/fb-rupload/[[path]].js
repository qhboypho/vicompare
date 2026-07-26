const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, offset, file_size"
};

export async function onRequest({ request, params }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`https://rupload.facebook.com/${path}`);
  targetUrl.search = sourceUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");

  const upstream = await fetch(targetUrl.toString(), {
    method: "POST",
    headers,
    body: request.body
  });

  const responseHeaders = new Headers(upstream.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => responseHeaders.set(key, value));

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}
