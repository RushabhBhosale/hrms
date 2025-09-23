// electron/main.js
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const spawn = require("cross-spawn");
const kill = require("tree-kill");
const waitOn = require("wait-on");

let pids = [];
const isDev = process.env.NODE_ENV !== "production";

// ---- Ports ----
const DEV_WEB_PORT = 5174; // Vite dev
const DEV_API_PORT = 4000; // API dev
const PROD_WEB_PORT = 5174; // your prod/static server (adjust if different)
const PROD_API_PORT = 4000; // API prod

function spawnProc(cmd, args, cwd = process.cwd()) {
  const p = spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  pids.push(p.pid);
  p.on("exit", (code) => {
    if (code !== 0) {
      dialog.showErrorBox(
        "Process exited",
        `${cmd} ${args.join(" ")} -> ${code}`
      );
      app.quit();
    }
  });
  return p;
}

async function startServices() {
  if (isDev) {
    // dev servers
    spawnProc("npm", ["run", "dev", "-w", "apps/api"]); // -> :4000
    spawnProc("npm", ["run", "dev", "-w", "apps/web"]); // -> :5174

    // Wait for API (optional) then web (required)
    await waitOn({
      resources: [
        `http-get://localhost:${DEV_API_PORT}`, // comment out if API may start later
        `http-get://localhost:${DEV_WEB_PORT}`,
      ],
      timeout: 120000,
      interval: 500,
      validateStatus: (status) => status >= 200 && status < 500, // accept 4xx during early boot
    });
  } else {
    // production: start API, wait, then start static server
    spawnProc("npm", ["run", "start", "-w", "apps/api"]); // -> :4000
    await waitOn({
      resources: [`http-get://localhost:${PROD_API_PORT}`],
      timeout: 120000,
      interval: 500,
      validateStatus: (s) => s >= 200 && s < 500,
    });

    spawnProc("npm", ["run", "start", "-w", "apps/web"]); // -> :3000 (adjust if needed)
    await waitOn({
      resources: [`http-get://localhost:${PROD_WEB_PORT}`],
      timeout: 120000,
      interval: 500,
      validateStatus: (s) => s >= 200 && s < 500,
    });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  const url = isDev
    ? `http://localhost:${DEV_WEB_PORT}`
    : `http://localhost:${PROD_WEB_PORT}`;

  win.loadURL(url);
  if (isDev) win.webContents.openDevTools({ mode: "detach" });
}

function cleanup() {
  pids.forEach((pid) => {
    try {
      kill(pid);
    } catch (_) {}
  });
  pids = [];
}

app.on("ready", async () => {
  try {
    await startServices();
    createWindow();
  } catch (e) {
    dialog.showErrorBox("Startup failed", String(e));
    app.quit();
  }
});
app.on("before-quit", cleanup);
app.on("window-all-closed", () => {
  cleanup();
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
