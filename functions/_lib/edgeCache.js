// functions/_lib/edgeCache.js

// Add this near top of edgeCache.js
export function getDb(env) {
  // Try common binding names
  return (
    env.DB ||
    env.MARK6_DB ||
    env.MARK6DB ||
    env.D1 ||
    env.database ||
    env.db ||
    null
  );
}

/** Sort query params + remove nocache params for stable cache key */
export function canonicalizeUrl(url) {
  const u = new URL(url);
  // Remove these from cache key
  ["nocache", "_", "__ts"].forEach((k) => u.searchParams.delete(k));

  // Sort params
  const entries = Array.from(u.searchParams.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  u.search = "";
  for (const [k, v] of entries) u.searchParams.append(k, v);
  return u;
}

async function sha1Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function withHeader(resp, extraHeaders = {}) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(extraHeaders)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, headers: h });
}

/**
 * SWR cache for JSON Responses on Cloudflare edge.
 *
 * - ttl: seconds considered fresh
 * - swr: seconds allowed stale while revalidating
 * - version: appended into cache key so new draw => instant bust
 * - cacheKeyNamespace: separate caches per endpoint
 */
export async function edgeCacheJsonResponse({
  request,
  ctx,
  cacheKeyNamespace,
  version = "v0",
  ttl = 60,
  swr = 300,
  computeJson, // () => any
  cacheControlMaxAge = 0, // browser max-age
  cacheControlSMaxAge = ttl, // edge s-maxage
}) {
  const url = canonicalizeUrl(request.url);

  // Allow bypass
  if (url.searchParams.get("nocache") === "1") {
    const data = await computeJson();
    return jsonResponseWithEtag(data, request, {
      cacheControl: `no-store`,
      edgeStatus: "BYPASS",
    });
  }

  // Build internal cache key URL (NOT the public URL)
  const keyUrl = new URL("https://edgecache.local/" + cacheKeyNamespace);
  keyUrl.search = url.search; // canonicalized
  keyUrl.searchParams.set("__v", String(version));

  const cache = caches.default;
  const cacheReq = new Request(keyUrl.toString(), { method: "GET" });

  const cached = await cache.match(cacheReq);
  if (cached) {
    const created = Number(cached.headers.get("x-cache-created") || "0");
    const ageSec = created ? Math.floor((Date.now() - created) / 1000) : 0;

    // Fresh
    if (created && ageSec <= ttl) {
      return withHeader(cached, { "x-edge-cache": "HIT" });
    }

    // Stale but within SWR => serve stale, refresh in background
    if (created && ageSec <= ttl + swr) {
      ctx.waitUntil(
        (async () => {
          const data = await computeJson();
          const resp = await jsonResponseWithEtag(data, request, {
            cacheControl: buildCacheControl(cacheControlMaxAge, cacheControlSMaxAge, swr),
            edgeStatus: "REFRESH",
          });
          await cache.put(cacheReq, resp.clone());
        })()
      );
      return withHeader(cached, { "x-edge-cache": "STALE" });
    }
    // Otherwise, treat as expired hard => fall through to recompute
  }

  // MISS => compute and store
  const data = await computeJson();
  const resp = await jsonResponseWithEtag(data, request, {
    cacheControl: buildCacheControl(cacheControlMaxAge, cacheControlSMaxAge, swr),
    edgeStatus: "MISS",
  });

  ctx.waitUntil(cache.put(cacheReq, resp.clone()));
  return resp;
}

function buildCacheControl(maxAge, sMaxAge, swr) {
  // Browser cache is max-age; edge cache is s-maxage
  // stale-while-revalidate helps intermediate caches + our own SWR logic still works
  return `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;
}

export async function jsonResponseWithEtag(data, request, opts = {}) {
  const body = JSON.stringify(data);
  const etag = `"${await sha1Hex(body)}"`; // strong ETag

  // Client conditional request => 304
  const inm = request.headers.get("if-none-match");
  if (inm && inm === etag) {
    const h = new Headers();
    h.set("ETag", etag);
    h.set("Cache-Control", opts.cacheControl || "no-store");
    h.set("x-edge-cache", opts.edgeStatus || "304");
    return new Response(null, { status: 304, headers: h });
  }

  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("ETag", etag);
  headers.set("Cache-Control", opts.cacheControl || "no-store");
  headers.set("x-edge-cache", opts.edgeStatus || "GEN");

  // Used by our SWR
  headers.set("x-cache-created", String(Date.now()));

  return new Response(body, { status: 200, headers });
}

/** Fast version meta: latest drawNo + updatedAt (used for cache busting) */
export async function getLatestDrawMeta(db) {
  const row = await db
    .prepare(
      `SELECT drawNo, updatedAt
       FROM draws
       ORDER BY CAST(drawNo AS INTEGER) DESC
       LIMIT 1`
    )
    .first();

  return {
    latestDrawNo: row?.drawNo || null,
    latestUpdatedAt: row?.updatedAt || null,
  };
}

/**
 * Cache JSON *data* (not Response) for internal use (e.g. /api/check using cached draws list).
 * Uses same SWR behavior.
 */
export async function edgeCacheJsonData({
  ctx,
  cacheKeyNamespace,
  version = "v0",
  ttl = 60,
  swr = 300,
  keyObject, // any stable object (will be stringified) to form cache key
  computeJson,
}) {
  const keyUrl = new URL("https://edgecache.local/" + cacheKeyNamespace);
  keyUrl.searchParams.set("__v", String(version));
  keyUrl.searchParams.set("__k", await sha1Hex(JSON.stringify(keyObject)));

  const cache = caches.default;
  const cacheReq = new Request(keyUrl.toString(), { method: "GET" });

  const cached = await cache.match(cacheReq);
  if (cached) {
    const created = Number(cached.headers.get("x-cache-created") || "0");
    const ageSec = created ? Math.floor((Date.now() - created) / 1000) : 0;

    if (created && ageSec <= ttl) {
      return await cached.clone().json();
    }

    if (created && ageSec <= ttl + swr) {
      ctx.waitUntil(
        (async () => {
          const data = await computeJson();
          const resp = await jsonResponseWithEtag(data, new Request("https://dummy.local"), {
            cacheControl: `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${swr}`,
            edgeStatus: "REFRESH",
          });
          await cache.put(cacheReq, resp.clone());
        })()
      );
      return await cached.clone().json();
    }
  }

  const data = await computeJson();
  const resp = await jsonResponseWithEtag(data, new Request("https://dummy.local"), {
    cacheControl: `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${swr}`,
    edgeStatus: "MISS",
  });

  ctx.waitUntil(cache.put(cacheReq, resp.clone()));
  return data;
}
