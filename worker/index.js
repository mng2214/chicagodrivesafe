// Edge cache for the City of Chicago crash data.
// /api/<dataset-id>.json?<SoQL> -> data.cityofchicago.org, cached at Cloudflare for the current Chicago day.
// The first request of the day waits for the city portal; everyone after that gets the cached copy.

const UPSTREAM = "https://data.cityofchicago.org/resource/";
const DATASETS = new Set(["85ca-t3if", "u6pd-qa9d"]); // Crashes, People
const PARAMS = new Set(["$select", "$where", "$order", "$group", "$limit", "$offset"]);
const chicagoDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const m = url.pathname.match(/^\/api\/([a-z0-9]{4}-[a-z0-9]{4})\.json$/);
    if (!m || !DATASETS.has(m[1])) return json({ error: "Unknown dataset" }, 404);

    // Keep only known SoQL parameters, in a stable order, so equal queries share one cache entry.
    const q = new URLSearchParams();
    for (const k of [...url.searchParams.keys()].filter(k => PARAMS.has(k)).sort()) q.set(k, url.searchParams.get(k));
    const query = q.toString();

    const cache = caches.default;
    const key = new Request(`${url.origin}/__cache/${m[1]}/${chicagoDay()}?${query}`);
    const hit = await cache.match(key);
    if (hit) return withHeaders(hit, "HIT");

    const headers = { accept: "application/json" };
    if (env.SODA_APP_TOKEN) headers["X-App-Token"] = env.SODA_APP_TOKEN;
    let up;
    try { up = await fetch(`${UPSTREAM}${m[1]}.json?${query}`, { headers }); }
    catch (e) { return json({ error: "City portal is unreachable" }, 502); }
    if (!up.ok) return json({ error: `City portal returned ${up.status}` }, 502);

    const body = await up.arrayBuffer();
    const stored = new Response(body, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400" }
    });
    ctx.waitUntil(cache.put(key, stored.clone()));
    return withHeaders(stored, "MISS");
  }
};

function withHeaders(res, status) {
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "public, max-age=1800");
  out.headers.set("x-data-cache", status);
  return out;
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
