const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Content-Range"
};

export async function onRequest({ request, params }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "PUT") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const sourceUrl = new URL(request.url);
  const trailingSlash = sourceUrl.pathname.endsWith("/") ? "/" : "";

  // TikTok trả upload_url theo region (open-upload-sg, open-upload-eu, ...).
  // Client truyền host thật qua ?__tt_host=; chỉ chấp nhận host *.tiktokapis.com.
  let uploadHost = "open-upload.tiktokapis.com";
  const requestedHost = sourceUrl.searchParams.get("__tt_host");
  if (requestedHost && /^open-upload[a-z0-9-]*\.tiktokapis\.com$/.test(requestedHost)) {
    uploadHost = requestedHost;
  }
  // Xoá param nội bộ trước khi forward
  sourceUrl.searchParams.delete("__tt_host");

  const targetUrl = new URL(`https://${uploadHost}/${path}${trailingSlash}`);
  targetUrl.search = sourceUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");

  const upstream = await fetch(targetUrl.toString(), {
    method: "PUT",
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
