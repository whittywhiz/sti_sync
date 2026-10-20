import { Request, Response, NextFunction } from "express";

const store = new Map<string, { body: string; time: number }>();
const TTL = 5 * 60 * 1000;

export function cacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.method !== "GET") {
    res.on("finish", () => store.clear());
    return next();
  }
  if (req.path === "/generate-schedule/status") return next();

  const hit = store.get(req.originalUrl);
  if (hit && Date.now() - hit.time < TTL) {
    return res.type("json").send(hit.body);
  }

  res.json = (body: any) => {
    const text = JSON.stringify(body);
    if (res.statusCode === 200)
      store.set(req.originalUrl, { body: text, time: Date.now() });
    return res.type("json").send(text);
  };
  next();
}

export const clearCache = () => store.clear();
