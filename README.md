# Signage POC — multi-screen language controller

Minimal working proof of concept for the architecture we discussed:
one hub server, an admin panel, and kiosk-style display clients that
switch language instantly via WebSocket broadcast.

## Run it

```bash
npm install
npm start
```

Then open:
- **Admin panel:** http://localhost:3000/admin.html
- **Display (screen 1):** http://localhost:3000/display.html?screen=screen1
- **Display (screen 2):** http://localhost:3000/display.html?screen=screen2
- **Display (screen 3):** http://localhost:3000/display.html?screen=screen3
- **Display with Canva embed:** http://localhost:3000/display.html?screen=screen1&canva=https%3A%2F%2Fwww.canva.com%2Fdesign%2FYOUR_DESIGN_ID%2Fview
- **Display with Genially embed:** http://localhost:3000/display.html?screen=screen1&genially=https%3A%2F%2Fview.genially.com%2FYOUR_GENIALLY_ID

Open the admin panel in one tab/window and a couple of display pages in
others (or on other machines once you add Tailscale). Click English /
Español in the admin panel and watch every display switch instantly,
with no page reload.

In the admin page, use the **Content Library** tab to add:
- link-based content (Canva, Genially, or any web URL) with EN/ES URLs
- PNG pairs (one EN file + one ES file)

New content keys appear in the connected-display selector as soon as both
languages exist.

## What this proves out

- **Instant switching, no reload** — both language images are preloaded
  on page load; toggling just flips CSS opacity.
- **Reconnect handling** — every client calls `request-state` on
  connect, so a display that refreshes or drops Wi-Fi briefly comes
  back showing the *current* language, not a stale one.
- **Live display roster** — the admin panel shows which screens are
  currently connected, using the same socket connection.
- **Swappable asset source** — `display.html` just points `<img>` tags
  at `/assets/{screen}-{lang}.svg`. Swap that URL pattern for an Adobe
  Express published-page URL (and `<img>` → `<iframe>`) without
  touching the WebSocket logic at all.
- **Canva embed option** — pass `canva=<url>` to use one Canva URL for
  both languages, or `canvaEn=<url>&canvaEs=<url>` to load different
  Canva pages per language.
- **Genially embed option** — pass `genially=<url>` to use one Genially
  URL for both languages, or
  `geniallyEn=<url>&geniallyEs=<url>` for language-specific pages.
- **Provider selection** — if both Canva and Genially URLs are provided,
  add `provider=canva` or `provider=genially` to choose the source
  explicitly (default priority is Genially, then Canva).
- **Admin-managed link content** — link entries saved in Content Library
  are persisted in `data/custom-content.json` and delivered by screen key.

## Next steps toward the real deployment

1. Replace the placeholder SVGs in `public/assets/` with your real
   Adobe exports (same naming pattern: `{screen}-{lang}.png` or `.svg`).
2. Put this server on an always-on local box (e.g. a Raspberry Pi),
   enable it as a systemd service, and join it + all display PCs to
   the same Tailscale network.
3. Launch each display PC's browser in kiosk mode pointed at
   `http://<hub-tailscale-ip>:3000/display.html?screen=screenN`.
4. Add basic auth or a shared key to `admin.html` before this leaves
   your local testing.
