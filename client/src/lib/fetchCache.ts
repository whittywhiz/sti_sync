const cache = new Map<string, { body: string; time: number }>();
const TTL = 60 * 1000;
const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();

  if (!url.startsWith("/api/")) return realFetch(input, init);

  if (method !== "GET") {
    const res = await realFetch(input, init);
    cache.clear();
    return res;
  }

  if (url.includes("/generate-schedule/status")) return realFetch(input, init);

  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < TTL) {
    return new Response(hit.body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const res = await realFetch(input, init);
  if (res.ok)
    cache.set(url, { body: await res.clone().text(), time: Date.now() });
  return res;
};
