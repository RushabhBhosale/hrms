// electron/main.js
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const spawn = require("cross-spawn");
const kill = require("tree-kill");
const waitOn = require("wait-on");

let pids = [];
const isDev = process.env.NODE_ENV !== "production";

function spawnProc(cmd, args, cwd = process.cwd()) {
  const p = spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  pids.push(p.pid);
  p.on("exit", (code) => {
    if (code !== 0)
      dialog.showErrorBox(
        "Process exited",
        `${cmd} ${args.join(" ")} -> ${code}`
      );
  });
  return p;
}

async function startServices() {
  if (isDev) {
    // dev servers
    spawnProc("npm", ["run", "dev", "-w", "apps/api"]);
    spawnProc("npm", ["run", "dev", "-w", "apps/web"]);
    await waitOn({ resources: ["http-get://localhost:3000"], timeout: 120000 });
  } else {
    // production: API first, then static/preview server on 3000
    spawnProc("npm", ["run", "start", "-w", "apps/api"]);
    await waitOn({
      resources: ["http-get://localhost:3001"],
      timeout: 120000,
      interval: 500,
    });
    spawnProc("npm", ["run", "start", "-w", "apps/web"]);
    await waitOn({
      resources: ["http-get://localhost:3000"],
      timeout: 120000,
      interval: 500,
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
  win.loadURL("http://localhost:3000");
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
