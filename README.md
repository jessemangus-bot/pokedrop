# PokeDrop — Pokemon Restock Alerts

A mobile-first web app that watches for Pokemon TCG restocks and preorders
(ETBs, booster boxes, Ultra Premium Collections, and anything else you add),
alerts you the moment something lands, and deep-links you straight to the
product page so you can buy it yourself in seconds.

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The app — auto-detects the backend and switches to LIVE FEED when it's there |
| `sw.js` | Service worker for background push notifications |
| `server.js` | The backend: polls stock feeds, sends push (see `SETUP-BACKEND.md`) |
| `package.json` | Backend dependencies |
| `products.seed.json` | Your real watchlist — products + feed URLs the server tracks |
| `.gitignore` | Keeps private keys and subscriber data out of the repo |
| `README.md` | This guide (static hosting + app usage) |
| `SETUP-BACKEND.md` | **Part 5 guide** — going fully live with real feeds and push |

**Two ways to run it:** upload just `index.html` for the static demo
version (Parts 1–4 below), or deploy the whole folder with the backend
for the real thing (`SETUP-BACKEND.md`).

---

## Part 1 — Put it on GitHub (no command line needed)

1. Log in at **github.com**.
2. Click the **+** in the top-right corner → **New repository**.
3. Name it `pokedrop`, set it to **Public**, and click **Create repository**.
   (Skip the README/gitignore options — leave everything unchecked.)
4. On the new empty repo page, click the **"uploading an existing file"** link.
5. Drag `index.html` from this folder into the upload area.
6. Click **Commit changes** at the bottom. Done — that's the whole "push."

> Updating later: repeat steps 4–6 with the new version of `index.html`.
> GitHub will replace the old file, and your host redeploys automatically.

---

## Part 2 — Deploy on DigitalOcean (free tier)

1. Log in to your **DigitalOcean** dashboard.
2. Go to **Apps** → **Create App**.
3. Choose **GitHub** as the source. The first time, DigitalOcean asks you to
   **authorize access to your GitHub account** — approve it and grant access
   to the `pokedrop` repo. (This link is what makes auto-deploys work.)
4. Select the `pokedrop` repo and the `main` branch. Leave **Autodeploy** on.
5. DigitalOcean should detect it as a **Static Site**. If it asks, pick
   Static Site — *not* Web Service. No build command; the output directory
   is the repo root.
6. On the plan screen choose the **Starter** tier — DigitalOcean includes
   **3 static-site apps free**.
7. Click **Create Resources** and wait a minute or two for the build.
8. You'll get a URL like `pokedrop-xxxxx.ondigitalocean.app`, with HTTPS
   already enabled. That's your live app.

### Don't want to link GitHub to DigitalOcean?

Either works instead:

- **GitHub Pages (free):** in your repo, go to **Settings → Pages**, set
  Source to **Deploy from a branch**, pick `main` and `/ (root)`, save.
  Your app appears at `https://YOURNAME.github.io/pokedrop/` in ~1 minute.
- **Netlify Drop:** go to `app.netlify.com/drop` and drag `index.html`
  onto the page. Instant URL, no account linking.

---

## Part 3 — Install it on your phone

HTTPS (which all the hosts above provide) is required for this part.

- **iPhone:** open your app URL in Safari → **Share** → **Add to Home
  Screen**. PokeDrop opens full-screen like a native app. Note: iOS only
  delivers web push notifications to apps added to the home screen.
- **Android:** open the URL in Chrome → menu (⋮) → **Add to Home screen**
  (or "Install app" if offered).

Then in the app's **Settings** tab, tap **Enable** next to Browser
notifications and accept the permission prompt.

---

## Part 4 — Using the app

- **Alerts** — the live feed. Green edge = in stock, blue = preorder,
  red = sold out. **Go buy →** deep-links to that product at that retailer.
  A red dot on the nav marks unseen alerts.
- **Watchlist** — toggle, remove, or add products. Optional **top price**:
  alerts over your max still log to the feed with an **OVER MAX** badge but
  won't ping you. **Leave it blank for no limit** — right for preorders
  where pricing isn't announced. The eBay buy-link pre-applies your cap as
  a real price filter, sorted newest-first.
- **Add a website** — track any site: give it a name and a search URL with
  `{q}` where the product name goes. (Search the site for anything, copy
  the address bar, swap your words for `{q}`.) eBay, Mercari, and
  BoardGameGeek come preloaded.
- **Settings** — which event types alert you, sound, quiet hours, and the
  **Demo mode** switch. Demo mode is ON by default so you can test the
  whole flow with simulated drops — turn it off once real feeds are wired.

---

## Part 5 — Going fully live

This is no longer a roadmap — it's built. `server.js` + `sw.js` add real
stock-feed polling and true background push. Full walkthrough, including
the DigitalOcean deployment change (Web Service instead of Static Site),
is in **`SETUP-BACKEND.md`**.

A note on scope: the app alerts and deep-links; checkout stays in your
hands. Automated purchasing violates retailer terms and is how accounts
and IPs get banned — the legitimate speed edge is knowing the instant
stock lands.

---

## Troubleshooting

- **Notifications button says "blocked"** — you previously denied the
  permission. Fix it in the browser's site settings for your app's URL.
- **No sound on iPhone** — check the physical silent switch; web audio
  respects it.
- **Watchlist resets between visits** — expected in this version. State is
  in-memory; persistence is part of the backend upgrade in Part 5.
- **DigitalOcean built it as a Web Service** — delete the app and recreate,
  explicitly choosing Static Site, or edit the component type in the app's
  settings. Static Site is the free one.
