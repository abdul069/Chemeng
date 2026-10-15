// Optionele toegangscode: zet ACCESS_CODE als de server buiten het thuisnetwerk bereikbaar is.
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const CODE = process.env.ACCESS_CODE ?? "";

export const authRequired = () => CODE.length > 0;

export function checkCode(given: string | null | undefined): boolean {
  if (!CODE) return true;
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireCode(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const query = typeof req.query.code === "string" ? req.query.code : undefined;
  if (checkCode(header ?? query)) return next();
  res.status(401).json({ error: "Voer de toegangscode in." });
}
