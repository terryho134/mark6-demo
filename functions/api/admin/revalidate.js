function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function unauthorized() {
  return json({ ok: false, error: "Unauthorized" }, 401);
}

function requireAuth(request, env) {
  // 用同一把 token（建議用 ADMIN_TOKEN）
  const token = env.ADMIN_TOKEN || "";
  if (!token) return false;

  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return !!m && m[1] === token;
}

export async function onRequest({ request, env }) {
  if (!requireAuth(request, env)) return unauthorized();
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const cache = caches.default;
  const origin = new URL(request.url).origin;

  // ✅ 精確刪除主站 /api/latest 的 cache
  const latestKey = new Request(origin + "/api/latest", { method: "GET" });
  const deletedLatest = await cache.delete(latestKey);

  return json({
    ok: true,
    deleted: {
      latest: deletedLatest,
    },
  });
}
