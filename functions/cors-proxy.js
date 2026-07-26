const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range"
};

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");
  if (!target) {
    return new Response("Missing url", { status: 400, headers: corsHeaders });
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400, headers: corsHeaders });
  }

  if (!["https:", "http:"].includes(targetUrl.protocol)) {
    return new Response("Unsupported protocol", { status: 400, headers: corsHeaders });
  }

  const upstreamHeaders = {};
  const range = request.headers.get("Range");
  if (range) upstreamHeaders.Range = range;

  try {
    const upstream = await fetch(targetUrl.toString(), {
      headers: upstreamHeaders
    });

    const headers = new Headers(corsHeaders);
    const passthroughHeaders = [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Accept-Ranges",
      "Cache-Control",
      "ETag",
      "Last-Modified"
    ];

    for (const header of passthroughHeaders) {
      const value = upstream.headers.get(header);
      if (value) headers.set(header, value);
    }

    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/octet-stream");
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, {
      status: 502,
      headers: corsHeaders
    });
  }
}
