function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function unauthorized() {
  return json({ ok: false, error: "Unauthorized" }, 401);
}

/**
 * ✅ Accept BOTH:
 * 1) Authorization: Bearer <token>
 * 2) X-Admin-Key: <token>
 *
 * Token source priority:
 * - env.ADMIN_TOKEN (recommended)
 * - env.ADMIN_KEY   (legacy, your current "123456")
 */
function requireAuth(request, env) {
  const token = (env.ADMIN_TOKEN || env.ADMIN_KEY || "").trim();
  if (!token) return false;

  const auth = (request.headers.get("authorization") || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1] === token) return true;

  const xKey = (request.headers.get("x-admin-key") || "").trim();
  if (xKey && xKey === token) return true;

  return false;
}

export async function onRequest({ request, env }) {
  if (!requireAuth(request, env)) return unauthorized();
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const cache = caches.default;
  const origin = new URL(request.url).origin;

  // ✅ 精確刪除主站 /api/latest 的 cache（無 query）
  const latestKey = new Request(origin + "/api/latest", { method: "GET" });
  const deletedLatest = await cache.delete(latestKey);

  // ✅ 兼容：如果你將來會用 /api/latest?v=xxx 呢類 query 做 cacheKey
  // Cloudflare Cache API delete 係「key 完全匹配」先會刪到，所以呢度只能盡量刪常見 variant。
  const candidates = [
    origin + "/api/latest?v=1",
    origin + "/api/latest?v=123",
    origin + "/api/latest?ts=1",
  ];

  const deletedVariants = {};
  for (const u of candidates) {
    deletedVariants[u] = await cache.delete(new Request(u, { method: "GET" }));
  }

  return json({
    ok: true,
    deleted: {
      latest: deletedLatest,
      variants: deletedVariants,
    },
  });
}
