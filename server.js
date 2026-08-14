/* ============================================================
   PokeDrop server
   - Serves the app (index.html + sw.js)
   - Polls stock feeds (NowInStock-style RSS + Best Buy API)
   - Diffs "new availability event" and fires Web Push alerts
   - Respects each product's maxPrice (over-max logs, no push)
   Run: npm install && npm start   (Node 18+)
   ============================================================ */

import express from "express";
import webpush from "web-push";
import Parser from "rss-parser";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const POLL_SECONDS = Math.max(60, parseInt(process.env.POLL_SECONDS || "120", 10)); // be polite to feeds
const PORT = process.env.PORT || 8080;
const MAX_ALERTS = 200;

/* ---------------- tiny JSON storage ---------------- */
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const fp = (name) => path.join(DATA_DIR, name);
const load = (name, fallback) => {
  try { return JSON.parse(fs.readFileSync(fp(name), "utf8")); } catch (_) { return fallback; }
};
const save = (name, obj) => fs.writeFileSync(fp(name), JSON.stringify(obj, null, 2));

/* ---------------- VAPID keys (auto-generated on first run) ---------------- */
let vapid = load("vapid.json", null);
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else if (!vapid) {
  vapid = webpush.generateVAPIDKeys();
  save("vapid.json", vapid);
  console.log("Generated new VAPID keys -> data/vapid.json (keep private)");
}
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:you@example.com",
  vapid.publicKey,
  vapid.privateKey
);

/* ---------------- state ---------------- */
/* products: what to actually track. Seeded from products.seed.json on first run. */
let products = load("products.json", null);
if (!products) {
  try {
    products = JSON.parse(fs.readFileSync(path.join(__dirname, "products.seed.json"), "utf8"));
  } catch (_) { products = []; }
  save("products.json", products);
}
let subs = load("subscriptions.json", []);          // web push subscriptions
let alerts = load("alerts.json", []);               // recent alert feed (newest first)
let seen = load("seen.json", {});                   // per-feed guids already alerted on
let bbAvail = load("bestbuy-state.json", {});       // last known Best Buy availability per sku

const persist = () => {
  save("subscriptions.json", subs);
  save("alerts.json", alerts);
  save("seen.json", seen);
  save("bestbuy-state.json", bbAvail);
};

/* ---------------- alert + push plumbing ---------------- */
function classify(text) {
  if (/pre-?order/i.test(text)) return "preorder";
  if (/out of stock|sold out/i.test(text)) return "oos";
  if (/in stock|available|add to cart/i.test(text)) return "instock";
  return "instock"; // stock-tracker feeds post on availability; default to the useful case
}
function extractPrice(text) {
  const m = /\$\s?([\d,]+(?:\.\d{1,2})?)/.exec(text || "");
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}
function extractRetailer(text) {
  const b = /^\s*\[([^\]]{2,30})\]/.exec(text || ""); // "[Target] Product..." style titles
  if (b) return b[1].trim();
  const m = /\bat\s+([A-Za-z][A-Za-z0-9 .'&+-]{1,30})/.exec(text || "");
  return m ? m[1].trim() : "Web";
}

async function sendPushAll(payload) {
  const body = JSON.stringify(payload);
  const dead = [];
  await Promise.all(subs.map(async (s, i) => {
    try { await webpush.sendNotification(s, body); }
    catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) dead.push(i); // expired subscription
    }
  }));
  if (dead.length) subs = subs.filter((_, i) => !dead.includes(i));
}

async function recordAlert({ product, status, price, retailer, url }) {
  const over = !!(product.maxPrice && price && price > product.maxPrice);
  const alert = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    name: product.name,
    retailer,
    status,
    price: price ? "$" + price.toFixed(2) : "",
    priceNum: price || null,
    max: product.maxPrice || null,
    over,
    url: url || null
  };
  alerts.unshift(alert);
  if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;

  /* Push only what's actionable: in stock / preorder, and within budget.
     Over-max and sold-out still land in the feed for visibility. */
  if (status !== "oos" && !over) {
    const label = status === "preorder" ? "PREORDER OPEN" : "IN STOCK";
    await sendPushAll({
      title: `PokeDrop: ${label}`,
      body: `${product.name} at ${retailer}${alert.price ? " · " + alert.price : ""}`,
      url: url || "/",
      tag: "pokedrop-" + product.id
    });
  }
  console.log(`[alert] ${status.toUpperCase()} ${product.name} @ ${retailer}${over ? " (over max, no push)" : ""}`);
}

/* ---------------- feed adapters ---------------- */
const rss = new Parser({ timeout: 15000, headers: { "User-Agent": "PokeDropAlerts/1.0 (personal stock alert app)" } });

function matchesKeywords(text, match) {
  if (!match || !match.length) return true; // no filter = product-specific feed
  const hay = text.toLowerCase();
  /* every entry must match; "a|b" inside an entry means "a OR b" */
  return match.every((kw) => String(kw).toLowerCase().split("|").some((alt) => hay.includes(alt.trim())));
}

async function checkRssFeed(product, feed) {
  if (!feed.url || /PASTE_/.test(feed.url)) return; // unconfigured placeholder
  const parsed = await rss.parseURL(feed.url);
  const key = product.id + "|" + feed.url; // per-product memory, so one shared feed can serve many products
  seen[key] = seen[key] || [];
  const seenSet = new Set(seen[key]);
  const firstRun = seen[key].length === 0;

  for (const item of (parsed.items || []).slice(0, 25)) {
    const guid = item.guid || item.link || item.title + (item.isoDate || "");
    if (seenSet.has(guid)) continue;
    seenSet.add(guid);
    if (firstRun) continue; // don't spam history on the first poll — only alert on NEW events

    const text = `${item.title || ""} ${item.contentSnippet || ""}`;
    if (!matchesKeywords(text, feed.match)) continue; // firehose feeds: only this product's posts
    await recordAlert({
      product,
      status: classify(text),
      price: extractPrice(text),
      retailer: extractRetailer(item.title || text),
      url: item.link || null
    });
  }
  seen[key] = [...seenSet].slice(-300);
}

async function checkBestBuy(product, feed) {
  const apiKey = process.env.BESTBUY_API_KEY;
  if (!apiKey || !feed.sku) return;
  const url = `https://api.bestbuy.com/v1/products(sku=${feed.sku})?apiKey=${apiKey}&format=json&show=sku,name,salePrice,onlineAvailability,url`;
  const r = await fetch(url);
  if (!r.ok) return;
  const data = await r.json();
  const p = data.products && data.products[0];
  if (!p) return;

  const was = bbAvail[feed.sku];
  bbAvail[feed.sku] = !!p.onlineAvailability;
  /* Alert on the flip: unavailable (or unknown-but-not-first-run) -> available */
  if (p.onlineAvailability && was === false) {
    await recordAlert({
      product,
      status: "instock",
      price: p.salePrice || null,
      retailer: "Best Buy",
      url: p.url || null
    });
  }
}

async function pollOnce() {
  for (const product of products) {
    for (const feed of product.feeds || []) {
      try {
        if (feed.type === "rss") await checkRssFeed(product, feed);
        else if (feed.type === "bestbuy") await checkBestBuy(product, feed);
      } catch (err) {
        console.warn(`[poll] ${product.name} (${feed.type}) failed: ${err.message}`);
      }
    }
  }
  persist();
}

/* ---------------- web server ---------------- */
const app = express();
app.use(express.json({ limit: "50kb" }));
app.use(express.static(__dirname, { index: "index.html" }));

app.get("/api/health", (_, res) => res.json({ ok: true, products: products.length, subscribers: subs.length }));
app.get("/api/vapid-public-key", (_, res) => res.json({ key: vapid.publicKey }));
app.get("/api/alerts", (_, res) => res.json(alerts.slice(0, 60)));
app.get("/api/products", (_, res) => res.json(products));

app.post("/api/subscribe", (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "bad subscription" });
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    persist();
  }
  res.json({ ok: true });
});

app.post("/api/unsubscribe", (req, res) => {
  const { endpoint } = req.body || {};
  subs = subs.filter((s) => s.endpoint !== endpoint);
  persist();
  res.json({ ok: true });
});

/* Fire a fake alert end-to-end (feed entry + push) to verify your setup.
   If ADMIN_TOKEN env is set, require ?key=THAT_TOKEN. */
app.get("/api/test", async (req, res) => {
  if (process.env.ADMIN_TOKEN && req.query.key !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: "forbidden" });
  }
  await recordAlert({
    product: { id: "test", name: "Test Alert — Phantasmal Flames Booster Box", maxPrice: null },
    status: "instock",
    price: 161.64,
    retailer: "Pokemon Center",
    url: "https://www.pokemoncenter.com/"
  });
  persist();
  res.json({ ok: true, sentTo: subs.length });
});

/* Diagnose your feeds: fetches each one right now and reports whether it
   works, how many recent items match your keywords, and any errors.
   Respects ADMIN_TOKEN the same way /api/test does. */
app.get("/api/feedcheck", async (req, res) => {
  if (process.env.ADMIN_TOKEN && req.query.key !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: "forbidden" });
  }
  const report = [];
  for (const product of products) {
    for (const feed of product.feeds || []) {
      if (feed.type !== "rss") {
        report.push({ product: product.name, type: feed.type, status: "non-RSS feed (checked during normal polling)" });
        continue;
      }
      if (!feed.url || /PASTE_/.test(feed.url)) {
        report.push({ product: product.name, url: feed.url, status: "placeholder — not configured" });
        continue;
      }
      try {
        const parsed = await rss.parseURL(feed.url);
        const items = (parsed.items || []).slice(0, 25);
        const matching = items.filter((i) => matchesKeywords(`${i.title || ""} ${i.contentSnippet || ""}`, feed.match));
        report.push({
          product: product.name,
          url: feed.url,
          status: "ok",
          itemsFetched: items.length,
          matchingRecentItems: matching.length,
          latestMatchingTitle: matching[0] ? matching[0].title : null,
          newestItemTitle: items[0] ? items[0].title : null
        });
      } catch (err) {
        report.push({ product: product.name, url: feed.url, status: "ERROR: " + err.message });
      }
    }
  }
  res.json(report);
});

app.listen(PORT, () => {
  console.log(`PokeDrop server on :${PORT} — polling ${products.length} product(s) every ${POLL_SECONDS}s`);
  pollOnce();
  setInterval(pollOnce, POLL_SECONDS * 1000);
});
