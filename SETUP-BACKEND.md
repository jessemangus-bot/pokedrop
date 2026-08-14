# PokeDrop — Going Live (Part 5 Guide)

This upgrade adds the two production pieces: **real stock feeds** and
**true background push** (alerts that arrive with the app closed).

## New files

| File | What it does |
|---|---|
| `server.js` | The backend: serves the app, polls your feeds every 2 min, sends push notifications |
| `sw.js` | Service worker: receives pushes in the background; tapping one opens the product page |
| `package.json` | Declares the 3 dependencies (`express`, `web-push`, `rss-parser`) |
| `products.seed.json` | **Your real watchlist** — the products and feed URLs the server tracks |
| `.gitignore` | Keeps your private push keys and subscriber list out of the repo |
| `index.html` | Updated — auto-detects the backend and switches from demo to LIVE FEED |

The app is still fully backward-compatible: opened as a plain file or on
static-only hosting, it behaves exactly like before (demo mode). When
`server.js` is serving it, the header switches to **LIVE FEED**, demo turns
off, and real alerts flow in.

---

## Step 1 — Configure your real watchlist

Open `products.seed.json`. Each product looks like:

```json
{
  "id": "phantasmal-flames-bb",
  "name": "Phantasmal Flames Booster Box",
  "maxPrice": 165,
  "feeds": [
    { "type": "rss", "url": "https://www.reddit.com/r/PokemonRestocks/new/.rss",
      "match": ["phantasmal", "booster box|display|bb"] }
  ]
}
```

- `maxPrice` — `null` means no limit (preorders with unknown pricing).
  Over-max events still log to the feed but **won't** push.
- `feeds` — where the server watches for that product. Two types:

**Community restock feeds via Reddit RSS (main source — free, fast).**
Collector communities post restocks within seconds, and every subreddit
publishes a real RSS feed at `/new/.rss`. The seed file ships with the
two main ones already configured:

- `https://www.reddit.com/r/PokemonRestocks/new/.rss`
- `https://www.reddit.com/r/PKMNTCGDeals/new/.rss`

Because these feeds cover *every* product, each feed entry uses `match`
keywords to pick out only your product's posts:

- Every entry in `match` must appear in the post title
- `|` inside an entry means "or" — `"booster box|display|bb"` matches any
  of those spellings
- Keep keywords short and lowercase; posts are matched case-insensitively
- Omit `match` entirely only for a feed that's already product-specific

**Best Buy official API (optional, more direct).** Request a free API key
at **developer.bestbuy.com**, find the product's SKU (on the Best Buy
product page under "Specifications"), and add:

```json
{ "type": "bestbuy", "sku": "6613029" }
```

Then set the `BESTBUY_API_KEY` environment variable when you deploy
(Step 3). Delete the example Best Buy entry if you're not using it.

**Other feeds that work:** any site offering RSS plugs straight in — for
example the Pokemon Restocks newsletter at
`https://pokemonrestocks.substack.com/feed` (newsier, less instant).
Note on NowInStock: great tracker, but it offers its own alerts
(email/Telegram/browser) rather than a public RSS feed, so it can't be
pasted here — worth signing up for separately as a backup alert channel.

> Note: the server copies `products.seed.json` into `data/products.json`
> on first boot. After that, edit `data/products.json` on the server (or
> update the seed and redeploy).

---

## Step 2 — Test it on your computer (optional but recommended)

Requires Node.js 18+ (nodejs.org).

```bash
cd pokedrop
npm install
npm start
```

Open **http://localhost:8080** — the header should say **LIVE FEED**.
Go to Settings → Enable notifications, then visit
**http://localhost:8080/api/test** in another tab. You should get a real
push notification, and tapping it should open the product link. That's the
entire pipeline verified.

---

## Step 3 — Deploy on DigitalOcean

The app is now a small Node service, so it runs as a **Web Service**
(not a Static Site). Two good options:

### Option A — App Platform Web Service (easiest, ~$5/mo)

1. Upload ALL the files in this folder to your GitHub `pokedrop` repo
   (drag them all into the upload area at once, commit).
2. DigitalOcean → **Apps** → **Create App** → your `pokedrop` repo.
   If your old static-site app exists, delete it first or this will
   conflict on the repo.
3. It should detect **Node.js / Web Service**. Run command: `npm start`.
   (It reads the `PORT` env var automatically — no config needed.)
4. Under **Environment Variables**, optionally add:
   - `VAPID_SUBJECT` = `mailto:your@email.com` (identifies your push sender)
   - `BESTBUY_API_KEY` = your key (only if using Best Buy feeds)
   - `ADMIN_TOKEN` = any random string (locks the `/api/test` endpoint —
     then test via `/api/test?key=YOURTOKEN`)
5. Pick the **Basic** plan (smallest instance), Create Resources.
6. Your app URL now serves everything — frontend, push, and polling.

**One caveat:** App Platform containers have an ephemeral disk. On each
redeploy, the `data/` folder resets, which means:
- Push keys regenerate and subscribers clear — **but the app self-heals**:
  anyone who opens it again with notifications already granted is
  re-subscribed automatically.
- `data/products.json` re-seeds from `products.seed.json` — so keep your
  real watchlist in the seed file in the repo and it survives redeploys.

### Option B — Droplet (persistent, ~$6/mo)

If you'd rather have nothing reset, a basic Ubuntu droplet:

```bash
# on the droplet
sudo apt update && sudo apt install -y nodejs npm
git clone https://github.com/YOURNAME/pokedrop.git && cd pokedrop
npm install
npm install -g pm2
pm2 start server.js --name pokedrop
pm2 save && pm2 startup   # follow the printed command to start on reboot
```

Then point a domain (or use the droplet IP) and add HTTPS with a free
Caddy or Nginx + Let's Encrypt setup — **push notifications require
HTTPS**, so on a droplet this step is not optional. (App Platform gives
you HTTPS automatically, which is why Option A is easier.)

---

## Step 4 — Phones

- **iPhone:** open your app's HTTPS URL in Safari → Share → **Add to Home
  Screen** → open it from the icon → Settings → Enable notifications.
  iOS only delivers web push to home-screen apps (iOS 16.4+).
- **Android:** Chrome → open URL → Enable notifications (home-screen
  install optional but nice).

Everyone who does this gets pushed independently — share the URL with a
friend and you've got a group alert system.

---

## How the alert logic works (so you can tune it)

- Every `POLL_SECONDS` (default 120, env-configurable, minimum 60 to be
  polite to feed providers), the server checks each product's feeds.
- **RSS:** a feed entry it hasn't seen before = an availability event. On
  the very first poll of a feed it only memorizes history — no alert spam.
  Titles are parsed for status (in stock / preorder / sold out), price,
  and retailer.
- **Best Buy:** alerts on the flip from unavailable → available.
- Events land in the app's feed; **in stock / preorder within your max**
  additionally push to every subscriber, and tapping the notification
  opens the product link directly.

## Troubleshooting

- **Only test alerts, nothing real:** visit **`/api/feedcheck`** on your
  app URL. It fetches every configured feed right now and reports, per
  feed: `"status": "ok"` plus how many recent posts match your keywords
  (`matchingRecentItems`), or an `ERROR` with the reason. Interpreting it:
  - All `ok` but `matchingRecentItems: 0` everywhere → the system is fine;
    no matching posts have appeared yet. Restocks are bursty — the
    catch-all "Pokemon Center — any drop" product should fire first since
    it matches the most posts. You can also loosen keywords.
  - `ERROR: Status code 403` on Reddit feeds → Reddit is blocking your
    server's IP (common for cloud hosts). Fixes to try, in order: set
    `POLL_SECONDS=300` in your environment variables (gentler rate);
    or swap the feed URLs to an RSS mirror service such as Open RSS
    (openrss.org) which republishes subreddit feeds; or run the server
    from a home machine/droplet whose IP Reddit doesn't flag.
  - Remember: matching posts only alert **going forward** — the first
    poll memorizes history without alerting, by design.
- **No push on test:** check you enabled notifications *on that device
  from the live HTTPS URL* (not localhost/file), and on iPhone that the
  app is on the home screen.
- **`/api/health`** shows product and subscriber counts — handy sanity
  check.
- **RSS feed errors in logs:** the placeholder `PASTE_...` URLs are
  skipped silently; a real URL that errors is logged with the reason.
- **Alerts but wrong prices/retailers:** feed titles vary; the parser is
  best-effort. The alert still links to the actual listing.
