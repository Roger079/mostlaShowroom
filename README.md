# Mostla Showroom — Multi-Screen Signage & Language Controller

A lightweight, real-time digital signage and showroom controller designed for multi-display environments. It features **instantaneous, zero-reload bilingual switching (English / Spanish)**, a password-protected admin dashboard, dynamic content assignment, support for local media (video/images) and web embeds (Canva, Genially), and automated boot scripts for Windows and macOS kiosks.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Display Client](#display-client)
- [Admin Dashboard](#admin-dashboard)
- [macOS Hub Server & Cloudflare Tunnel](#macos-hub-server--cloudflare-tunnel)
- [Display Auto-Start Kiosks](#display-auto-start-kiosks)
- [API & WebSocket Events](#api--websocket-events)
- [Project Structure](#project-structure)
- [Configuration](#configuration)

---

## Overview

In showroom and exhibition spaces, displays often need to switch languages simultaneously when visitors or guided tours arrive. Traditional signage solutions reload the page or require complicated content management systems.

**Mostla Showroom** solves this with a centralized Hub Server using WebSockets (Socket.IO):
- Displays preload bilingual assets and transition seamlessly with zero page reload.
- The administrator can toggle language for every screen at once with a single click.
- Each display can be individually reassigned in real time to show videos, images, or interactive web presentations.

---

## Key Features

- **Instant Language Switching (Zero Reload):** Displays preload English and Spanish content; toggling flips CSS layer opacity for smooth, instantaneous transitions.
- **Rich Media & Embed Support:**
  - **Images:** PNG, JPG, GIF, WebP, SVG.
  - **Videos:** MP4, MKV, WebM, MOV, AVI with continuous loop and muted autoplay.
  - **Interactive Embeds:** Canva, Genially, and generic iframes.
- **Secure Admin Panel (`/admin.html`):**
  - Session-token authentication.
  - Live display roster showing connection status (online / offline).
  - Dynamic content reassignment per screen in real time.
  - Content library manager with link creator and media uploader (supporting files up to 500MB).
- **Automatic Reconnection State:** Displays request the current language on connect/reconnect, preventing stale content after Wi-Fi blips or restarts.
- **Screen Whitelist & Access Control:** Displays must be registered in the screen roster (`data/screens.json`) to connect.
- **Production-Ready Automation:**
  - macOS hub runner with automated **Cloudflare Tunnel** (`cloudflared`) and `LaunchAgent` autostart.
  - Windows kiosk launcher with browser auto-discovery and Windows Startup integration (`shell:startup`).

---

## Architecture

```
                  ┌─────────────────────────────────────┐
                  │       Admin Panel (/admin.html)     │
                  │   Language Toggle | Content Library │
                  └──────────────────┬──────────────────┘
                                     │ WebSockets (Socket.IO)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Central Hub Server (server.js)                  │
│                     Node.js + Express + Socket.IO                      │
│                                                                        │
│  State: Global Language ('en'/'es') | Screens Roster | Content Library │
│  Storage: data/screens.json | data/custom-content.json | public/assets/ │
└──────────────────┬──────────────────┬──────────────────┬───────────────┘
                   │                  │                  │
                   ▼                  ▼                  ▼
          ┌─────────────────┐┌─────────────────┐┌─────────────────┐
          │  Display Kiosk  ││  Display Kiosk  ││  Display Kiosk  │
          │    (Screen 1)   ││    (Screen 2)   ││    (Screen N)   │
          │  Layered Render ││  Layered Render ││  Layered Render │
          └─────────────────┘└─────────────────┘└─────────────────┘
```

---

## Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org) (v18 or higher recommended)
- `npm`

### 2. Install & Start Server
```bash
git clone https://github.com/Roger079/mostlaShowroom.git
cd mostlaShowroom
npm install
npm start
```

### 3. Open in Browser
- **Admin Panel:** [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
  - Default Admin Password: `admin123` (configurable via `ADMIN_PASSWORD` env var).
- **Display Screen 1:** [http://localhost:3000/display.html?screen=screen1](http://localhost:3000/display.html?screen=screen1)
- **Display Screen 2:** [http://localhost:3000/display.html?screen=screen2](http://localhost:3000/display.html?screen=screen2)

---

## Display Client

Each display screen runs `display.html` in fullscreen kiosk mode:

```text
http://<hub-ip>:3000/display.html?screen=<SCREEN_ID>
```

### URL Parameters

| Parameter | Description |
|-----------|-------------|
| `screen` / `displayId` | Identifier for the screen (e.g. `screen1`, `lobby-display`). Must exist in the admin roster. |
| `canva` | Single Canva URL used for both English and Spanish. |
| `canvaEn` / `canvaEs` | Language-specific Canva URLs. |
| `genially` | Single Genially URL used for both English and Spanish. |
| `geniallyEn` / `geniallyEs` | Language-specific Genially URLs. |
| `provider` | Explicitly choose between `canva` or `genially` if both are supplied. |

Displays feature a **layered architecture** (`<img>`, `<video>`, `<iframe>`). When the language changes, active elements stay mounted and crossfade smoothly.

---

## Admin Dashboard

Access `http://<hub-ip>:3000/admin.html` and log in with your admin password.

### 1. Language Control
- Global **English** and **Español** toggle buttons.
- Real-time roster of connected screens:
  - Online/offline badge with connection time.
  - Dropdown selector to reassign which content key each screen is displaying live.

### 2. Content Library
- **Add Link Content:** Register Canva, Genially, Direct Video, or Generic Web URLs with EN and ES targets.
- **Upload Media:** Upload local images or video files (up to 500MB) directly from your browser.
- **Manage Entries:** View configured keys, check bilingual completeness, and delete unneeded content.

### 3. Screen Management
- Register new screens by name (e.g. `entrance-kiosk`, `screen2`).
- Set each screen's default content key on connection.
- Delete or modify registered screens.

---

## macOS Hub Server & Cloudflare Tunnel

To host the hub server on a Mac (Intel or Apple Silicon) and tunnel it securely through Cloudflare:

### 1. Install Dependencies
```bash
brew install node cloudflare/cloudflare/cloudflared
```

### 2. Interactive Launcher (`scripts/start-hub-mac.sh`)
```bash
chmod +x ./scripts/start-hub-mac.sh
./scripts/start-hub-mac.sh
```
- **Interactive Setup:** On first run, configure Port (default `3000`), Admin Password, and optional Cloudflare Token. Settings save to `scripts/hub-config.json`.
- **Quick Tunnel (TryCloudflare):** If no token is provided, a free, instant public URL (`https://*.trycloudflare.com`) is generated and printed in your terminal.
- **Zero Trust Tunnel:** Provide your tunnel token to bind to your own custom domain.
- Cleanly stops both Node and Cloudflare Tunnel on `Ctrl+C`.
- To reconfigure settings: `./scripts/start-hub-mac.sh --reset`.

### 3. Background Auto-Start on Boot (`LaunchAgent`)
To have the hub server start automatically when the Mac powers on or logs in:
```bash
chmod +x ./scripts/setup-mac-autostart.sh
./scripts/setup-mac-autostart.sh install
```

**Management:**
- **Check Status:** `./scripts/setup-mac-autostart.sh status`
- **View Live Logs & Public URL:** `tail -f ~/Library/Logs/mostla-showroom.log`
- **View Errors:** `tail -f ~/Library/Logs/mostla-showroom.err.log`
- **Uninstall:** `./scripts/setup-mac-autostart.sh uninstall`

---

## Display Auto-Start Kiosks

Automate display PCs so they launch fullscreen into the showroom on boot without user interaction.

### Windows Kiosk

#### 1. Run the Display Launcher
Execute `start-display.bat`:
- On first launch, a dialog will ask for **Display Name** (e.g. `screen1`) and **Hub Server URL**.
- Automatically locates Chrome, Edge, Brave, or Firefox and launches in fullscreen kiosk mode (`--kiosk --incognito`).
- Config stored in `scripts/display-config.json`. To reconfigure: `start-display.bat -Reset`.

#### 2. Auto-Start on Windows Boot
Open PowerShell in the project directory and run:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-startup.ps1
```
This registers a shortcut in Windows Startup (`shell:startup`).

### macOS & Linux Kiosk

Run the shell launcher:
```bash
chmod +x ./scripts/start-display.sh
./scripts/start-display.sh
```
- **macOS:** Automatically launches Safari and triggers native fullscreen.
- **Linux:** Launches Chrome/Chromium or Firefox in `--kiosk` mode.

---

## API & WebSocket Events

### REST API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/login` | No | Authenticate with admin password; returns session token. |
| `POST` | `/api/logout` | Optional | Invalidate session token. |
| `GET` | `/api/auth-check` | Yes | Verify active session token. |
| `GET` | `/api/screens` | No | List all screens in the roster with connection status. |
| `POST` | `/api/screens` | Yes | Add or update a screen in the roster. |
| `DELETE`| `/api/screens/:screenId` | Yes | Remove a screen from the roster. |
| `GET` | `/screen-types` | No | Get comma-separated list of valid content keys. |
| `GET` | `/custom-contents` | No | Get list of all content library entries. |
| `POST` | `/custom-contents/link` | Yes | Add/update external link content. |
| `POST` | `/custom-contents/media` | Yes | Upload image/video asset pair (Base64). |
| `DELETE`| `/custom-contents/:screenType` | Yes | Delete content entry and associated media files. |

### WebSocket Events (Socket.IO)

- `register-display` (Client → Server): Display announces its `screenId`.
- `display-config` (Server → Client): Sends initial `screenType`, `language`, and `content`.
- `request-state` (Client → Server): Client requests current global language.
- `language-changed` (Server → All): Broadcasts new language (`en` or `es`).
- `set-language` (Admin → Server): Admin updates global language (requires token).
- `set-display-screen-type` (Admin → Server): Admin reassigns screen content dynamically.
- `display-list` (Server → Admin): Live roster update of connected screens.
- `content-library-changed` (Server → All): Notifies that content library entries updated.

---

## Project Structure

```text
mostlaShowroom/
├── data/
│   ├── custom-content.json       # Persisted external links & custom content
│   └── screens.json              # Whitelisted screen roster & default types
├── public/
│   ├── admin.html                # Admin dashboard markup
│   ├── display.html              # Kiosk display markup
│   ├── assets/                   # Media files ({screenType}-{lang}.{ext})
│   ├── css/
│   │   ├── admin.css             # Admin dashboard styling
│   │   └── display.css           # Display kiosk styling & transition layers
│   └── js/
│       ├── admin.js              # Admin UI logic & socket management
│       └── display.js            # Display client engine & layer switcher
├── scripts/
│   ├── hub-config.json           # Hub server & tunnel config (generated)
│   ├── setup-mac-autostart.sh    # macOS LaunchAgent installer/uninstaller
│   ├── setup-startup.ps1         # Windows startup shortcut registrar
│   ├── start-display.ps1         # Windows kiosk browser launcher
│   ├── start-display.sh          # macOS/Linux kiosk browser launcher
│   └── start-hub-mac.sh          # macOS hub server & Cloudflare tunnel runner
├── package.json                  # Dependencies (express, socket.io)
├── server.js                     # Central Hub server & WebSocket engine
├── start-display.bat             # Windows display quick-start batch file
└── README.md                     # Repository documentation
```

---

## Configuration

Environment variables can be set in your environment or passed when starting Node:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port for the Hub server. |
| `ADMIN_PASSWORD` | `admin123` | Password required to unlock the admin dashboard. |

---

## License

Internal project for Mostla Showroom.
