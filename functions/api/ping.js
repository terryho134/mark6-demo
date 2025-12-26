export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, pong: true }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
