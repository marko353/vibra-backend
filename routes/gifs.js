// routes/gifs.js
// GET /api/gifs?q=<tekst>&page=<n>  ->  { items: [{ id, url, previewUrl, width, height }], hasNext }
// Prazan q = trending, inače pretraga. Klipy ključ ostaje na serveru (KLIPY_API_KEY).

const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();

const KLIPY_BASE = "https://api.klipy.com/api/v1";
const PER_PAGE = 24;

// Isti princip kao socket auth: JWT sa payload.id
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Token missing" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = String(payload.id);
    next();
  } catch {
    return res.status(401).json({ message: "Token invalid" });
  }
}

// Vraća prvi dostupan GIF objekat { url, width, height } po redosledu veličina
function pickGif(file, sizes) {
  if (!file) return null;
  for (const size of sizes) {
    const gif = file[size]?.gif;
    if (gif?.url) return gif;
  }
  return null;
}

router.get("/", requireAuth, async (req, res) => {
  const apiKey = process.env.KLIPY_API_KEY;
  if (!apiKey) {
    console.error("[GIF] KLIPY_API_KEY nije podešen");
    return res.status(500).json({ message: "GIF service not configured" });
  }

  const q = String(req.query.q || "").trim().slice(0, 100);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const url = new URL(`${KLIPY_BASE}/${encodeURIComponent(apiKey)}/gifs/${q ? "search" : "trending"}`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("customer_id", req.userId);
  if (q) url.searchParams.set("q", q);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.error("[GIF] Klipy status:", response.status);
      return res.status(502).json({ message: "GIF provider error" });
    }

    const json = await response.json();
    const list = Array.isArray(json?.data?.data) ? json.data.data : [];

    const items = list
      .map((g) => {
        const full = pickGif(g.file, ["hd", "md", "sm", "xs"]);
        const preview = pickGif(g.file, ["sm", "xs", "md", "hd"]);
        if (!full || !preview) return null; // preskoči reklame i nepotpune unose
        return {
          id: String(g.id ?? g.slug),
          url: full.url,
          previewUrl: preview.url,
          width: full.width ?? null,
          height: full.height ?? null,
        };
      })
      .filter(Boolean);

    return res.json({ items, hasNext: !!json?.data?.has_next });
  } catch (err) {
    console.error("[GIF] Greška:", err.name === "AbortError" ? "timeout" : err.message);
    return res.status(502).json({ message: "GIF provider unreachable" });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;