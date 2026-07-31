import { onRequest as __terms_tiktokr3uZgcdxChpIJzZkWVT6IZ5gk6Bp9BZp_txt_js_onRequest } from "D:\\Video So Sanh\\functions\\terms\\tiktokr3uZgcdxChpIJzZkWVT6IZ5gk6Bp9BZp.txt.js"
import { onRequest as __fb_api___path___js_onRequest } from "D:\\Video So Sanh\\functions\\fb-api\\[[path]].js"
import { onRequest as __fb_rupload___path___js_onRequest } from "D:\\Video So Sanh\\functions\\fb-rupload\\[[path]].js"
import { onRequest as __fb_upload___path___js_onRequest } from "D:\\Video So Sanh\\functions\\fb-upload\\[[path]].js"
import { onRequest as __google_token___path___js_onRequest } from "D:\\Video So Sanh\\functions\\google-token\\[[path]].js"
import { onRequest as __tiktok_api___path___js_onRequest } from "D:\\Video So Sanh\\functions\\tiktok-api\\[[path]].js"
import { onRequest as __tiktok_upload___path___js_onRequest } from "D:\\Video So Sanh\\functions\\tiktok-upload\\[[path]].js"
import { onRequest as __youtube_api___path___js_onRequest } from "D:\\Video So Sanh\\functions\\youtube-api\\[[path]].js"
import { onRequest as __cors_proxy_js_onRequest } from "D:\\Video So Sanh\\functions\\cors-proxy.js"

export const routes = [
    {
      routePath: "/terms/tiktokr3uZgcdxChpIJzZkWVT6IZ5gk6Bp9BZp.txt",
      mountPath: "/terms",
      method: "",
      middlewares: [],
      modules: [__terms_tiktokr3uZgcdxChpIJzZkWVT6IZ5gk6Bp9BZp_txt_js_onRequest],
    },
  {
      routePath: "/fb-api/:path*",
      mountPath: "/fb-api",
      method: "",
      middlewares: [],
      modules: [__fb_api___path___js_onRequest],
    },
  {
      routePath: "/fb-rupload/:path*",
      mountPath: "/fb-rupload",
      method: "",
      middlewares: [],
      modules: [__fb_rupload___path___js_onRequest],
    },
  {
      routePath: "/fb-upload/:path*",
      mountPath: "/fb-upload",
      method: "",
      middlewares: [],
      modules: [__fb_upload___path___js_onRequest],
    },
  {
      routePath: "/google-token/:path*",
      mountPath: "/google-token",
      method: "",
      middlewares: [],
      modules: [__google_token___path___js_onRequest],
    },
  {
      routePath: "/tiktok-api/:path*",
      mountPath: "/tiktok-api",
      method: "",
      middlewares: [],
      modules: [__tiktok_api___path___js_onRequest],
    },
  {
      routePath: "/tiktok-upload/:path*",
      mountPath: "/tiktok-upload",
      method: "",
      middlewares: [],
      modules: [__tiktok_upload___path___js_onRequest],
    },
  {
      routePath: "/youtube-api/:path*",
      mountPath: "/youtube-api",
      method: "",
      middlewares: [],
      modules: [__youtube_api___path___js_onRequest],
    },
  {
      routePath: "/cors-proxy",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__cors_proxy_js_onRequest],
    },
  ]