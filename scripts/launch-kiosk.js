#!/usr/bin/env node
/**
 * ==============================================================================
 * Mostla Showroom — Cross-Platform Kiosk Launcher (PoC)
 * Works seamlessly on macOS, Windows, and Linux.
 * Launches the display client in true fullscreen kiosk mode.
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

const REPO_DIR = path.resolve(__dirname, '..');
const SCREENS_FILE = path.join(REPO_DIR, 'data', 'screens.json');
const HUB_CONFIG_FILE = path.join(REPO_DIR, 'scripts', 'hub-config.json');

// Terminal colors
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/**
 * Reads existing registered screens from screens.json for user reference.
 */
function getRegisteredScreens() {
  try {
    if (fs.existsSync(SCREENS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCREENS_FILE, 'utf8'));
      if (Array.isArray(data.screens) && data.screens.length > 0) {
        return data.screens.map(s => s.name || s.screenId).filter(Boolean);
      }
    }
  } catch (_) {}
  return [];
}

/**
 * Resolves a sensible default Hub Server URL.
 */
function getDefaultServerUrl() {
  try {
    if (fs.existsSync(HUB_CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(HUB_CONFIG_FILE, 'utf8'));
      if (cfg.tunnelProvider === 'ngrok' && cfg.ngrokDomain) {
        const domain = cfg.ngrokDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return `https://${domain}`;
      }
      if (cfg.port) {
        return `http://localhost:${cfg.port}`;
      }
    }
  } catch (_) {}
  return 'https://tremor-tacky-dandelion.ngrok-free.dev';
}

/**
 * Searches for supported browser executables on the host machine.
 */
function findBrowser() {
  const platform = process.platform;

  if (platform === 'win32') {
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const candidates = [
      { type: 'chromium', path: path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { type: 'chromium', path: path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { type: 'chromium', path: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { type: 'chromium', path: path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { type: 'chromium', path: path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { type: 'chromium', path: path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
      { type: 'chromium', path: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
      { type: 'firefox', path: path.join(progFiles, 'Mozilla Firefox', 'firefox.exe') },
      { type: 'firefox', path: path.join(progFilesX86, 'Mozilla Firefox', 'firefox.exe') }
    ];

    for (const c of candidates) {
      if (fs.existsSync(c.path)) return c;
    }
    return null;
  }

  if (platform === 'darwin') {
    const candidates = [
      { type: 'chromium', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { type: 'chromium', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { type: 'chromium', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
      { type: 'firefox', path: '/Applications/Firefox.app/Contents/MacOS/firefox' },
      { type: 'safari', path: '/Applications/Safari.app' }
    ];

    for (const c of candidates) {
      if (fs.existsSync(c.path)) return c;
    }
    return null;
  }

  // Linux
  const linuxBins = [
    { type: 'chromium', bin: 'google-chrome' },
    { type: 'chromium', bin: 'chromium-browser' },
    { type: 'chromium', bin: 'chromium' },
    { type: 'chromium', bin: 'brave-browser' },
    { type: 'firefox', bin: 'firefox' }
  ];

  for (const b of linuxBins) {
    try {
      execSync(`command -v ${b.bin}`, { stdio: 'ignore' });
      return { type: b.type, path: b.bin };
    } catch (_) {}
  }

  return null;
}

/**
 * Launches the kiosk browser window.
 */
function launchKiosk(browser, targetUrl) {
  const tempProfileDir = path.join(os.tmpdir(), `mostla-kiosk-profile-${Date.now()}`);

  if (browser.type === 'chromium') {
    const args = [
      '--kiosk',
      targetUrl,
      '--noerrdialogs',
      '--disable-infobars',
      '--no-first-run',
      '--check-for-update-interval=31536000',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${tempProfileDir}`
    ];

    const child = spawn(browser.path, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  }

  if (browser.type === 'firefox') {
    const args = ['--kiosk', targetUrl];
    const child = spawn(browser.path, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  }

  if (browser.type === 'safari') {
    // macOS Safari Fullscreen fallback using open and osascript
    try {
      execSync(`open -a Safari "${targetUrl}"`);
      setTimeout(() => {
        try {
          execSync(`osascript -e '
            tell application "Safari"
              activate
              delay 0.5
              tell application "System Events"
                keystroke "f" using {command down, control down}
              end tell
            end tell
          '`);
        } catch (_) {}
      }, 1000);
      return true;
    } catch (err) {
      console.error('Error opening Safari:', err.message);
      return false;
    }
  }

  return false;
}

/**
 * Main interactive prompt and launcher workflow.
 */
function main() {
  console.log(`\n${CYAN}${BOLD}=====================================================${RESET}`);
  console.log(`${CYAN}${BOLD}     MOSTLA SHOWROOM — DISPLAY KIOSK LAUNCHER (PoC)  ${RESET}`);
  console.log(`${CYAN}${BOLD}=====================================================${RESET}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const registered = getRegisteredScreens();
  if (registered.length > 0) {
    console.log(`${YELLOW}Pantallas registradas en el sistema:${RESET} ${registered.join(', ')}`);
  } else {
    console.log(`${YELLOW}Nota:${RESET} Aún no hay pantallas en screens.json. Puedes ingresar cualquier nombre (e.g. screen1).`);
  }
  console.log('');

  const defaultUrl = getDefaultServerUrl();

  rl.question(`${BOLD}1. Ingresa el nombre de la pantalla [screen1]: ${RESET}`, (screenAnswer) => {
    const screenName = (screenAnswer || 'screen1').trim().replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || 'screen1';

    rl.question(`${BOLD}2. Ingresa la URL del Hub [${defaultUrl}]: ${RESET}`, (urlAnswer) => {
      let serverUrl = (urlAnswer || defaultUrl).trim();
      if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
        serverUrl = `http://${serverUrl}`;
      }
      serverUrl = serverUrl.replace(/\/$/, '');

      rl.close();

      const targetUrl = `${serverUrl}/display.html?screen=${encodeURIComponent(screenName)}&displayId=${encodeURIComponent(screenName)}`;

      console.log(`\n${GREEN}[OK]${RESET} Configuración:`);
      console.log(`   Pantalla : ${BOLD}${screenName}${RESET}`);
      console.log(`   Hub URL  : ${BOLD}${serverUrl}${RESET}`);
      console.log(`   Destino  : ${CYAN}${targetUrl}${RESET}\n`);

      const browser = findBrowser();
      if (!browser) {
        console.log(`${YELLOW}[!] No se encontró Chrome, Edge, Brave o Firefox.${RESET}`);
        console.log(`Abriendo con el navegador predeterminado del sistema...`);
        const openCmd = process.platform === 'win32' ? `start "" "${targetUrl}"` :
                        process.platform === 'darwin' ? `open "${targetUrl}"` : `xdg-open "${targetUrl}"`;
        try {
          execSync(openCmd);
        } catch (e) {
          console.error(`Abre manualmente: ${targetUrl}`);
        }
        return;
      }

      console.log(`${GREEN}Iniciando pantalla en modo kiosko con ${browser.path || browser.bin || browser.type}...${RESET}`);
      const started = launchKiosk(browser, targetUrl);

      if (started) {
        console.log(`\n${GREEN}${BOLD}✔ Pantalla iniciada con éxito en pantalla completa.${RESET}`);
        console.log(`${YELLOW}Tip para salir del modo kiosko:${RESET}`);
        if (process.platform === 'darwin') {
          console.log(`   Presiona ${BOLD}Command + Q${RESET} o ${BOLD}Esc${RESET} para salir.`);
        } else {
          console.log(`   Presiona ${BOLD}Alt + F4${RESET} o ${BOLD}F11${RESET} para salir.`);
        }
        console.log('');
      } else {
        console.log(`${YELLOW}No se pudo iniciar el navegador automáticamente. Visita manualmente: ${targetUrl}${RESET}`);
      }
    });
  });
}

main();
