const vscode = require("vscode");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

let statusBarItem;
let pollTimer;
let currentPorts = [];

function parseLsof(output) {
  const lines = output.trim().split("\n");
  const results = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const command = parts[0];
    const pid = parts[1];
    const nameCol = parts.slice(8).join(" ");

    // Extract port from name column (e.g. *:8081, 127.0.0.1:3000, [::1]:8080)
    const match = nameCol.match(/[:.](\d+)\s*\(/);
    if (match) {
      const port = parseInt(match[1], 10);
      const key = `${port}-${pid}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          port,
          pid: Number(pid),
          command,
          address: nameCol.replace(/\s*\(LISTEN\)/, ""),
        });
      }
    }
  }
  return results.sort((a, b) => a.port - b.port);
}

async function getDescendants(pids) {
  const all = new Set(pids.map(Number));
  let current = [...all];
  while (current.length > 0) {
    try {
      const { stdout } = await execAsync(`pgrep -P ${current.join(",")}`);
      const children = stdout
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => !isNaN(n) && !all.has(n));
      if (children.length === 0) break;
      children.forEach((c) => all.add(c));
      current = children;
    } catch {
      break;
    }
  }
  return [...all];
}

async function updatePorts() {
  if (!statusBarItem) return;

  const config = vscode.workspace.getConfiguration("instancePorts");
  const hideWhenEmpty = config.get("hideWhenEmpty", false);

  try {
    const terminals = vscode.window.terminals;
    if (terminals.length === 0) {
      currentPorts = [];
      updateStatusBar([], hideWhenEmpty);
      return;
    }

    const rawPids = await Promise.all(
      terminals.map(async (t) => {
        try {
          return await t.processId;
        } catch {
          return null;
        }
      }),
    );

    const terminalPids = rawPids.filter(
      (pid) => typeof pid === "number" && pid > 0,
    );
    if (terminalPids.length === 0) {
      currentPorts = [];
      updateStatusBar([], hideWhenEmpty);
      return;
    }

    const allPids = await getDescendants(terminalPids);
    if (allPids.length === 0) {
      currentPorts = [];
      updateStatusBar([], hideWhenEmpty);
      return;
    }

    try {
      const { stdout } = await execAsync(
        `lsof -a -p ${allPids.join(",")} -iTCP -sTCP:LISTEN -P -n`,
      );
      currentPorts = parseLsof(stdout);
    } catch {
      // lsof returns exit code 1 if no matching listening sockets found
      currentPorts = [];
    }

    updateStatusBar(currentPorts, hideWhenEmpty);
  } catch (err) {
    console.error("[Current Window Ports] Error updating ports:", err);
  }
}

function updateStatusBar(ports, hideWhenEmpty) {
  if (!statusBarItem) return;

  const config = vscode.workspace.getConfiguration("instancePorts");
  const protocol = config.get("protocol", "https");

  if (ports.length === 0) {
    if (hideWhenEmpty) {
      statusBarItem.hide();
      return;
    }
    statusBarItem.text = "$(radio-tower) Ports: -";
    statusBarItem.tooltip = new vscode.MarkdownString(
      "**Current Window Ports**\n\nNo active listening ports detected in this window's terminals.\n\n*Click to refresh*",
    );
    statusBarItem.show();
    return;
  }

  const portList = ports.map((p) => p.port).join(", ");
  statusBarItem.text = `$(radio-tower) Ports: ${portList}`;

  const md = new vscode.MarkdownString(
    "**Ports in Current VS Code Window**\n\n",
  );
  ports.forEach((p) => {
    const url = `${protocol}://localhost:${p.port}`;
    md.appendMarkdown(
      `- **[${url}](${url})** — \`${p.command}\` (PID: ${p.pid})\n`,
    );
  });
  md.appendMarkdown("\n*Click to open menu or manage ports*");
  statusBarItem.tooltip = md;
  statusBarItem.show();
}

async function showPortMenu() {
  await updatePorts();

  const config = vscode.workspace.getConfiguration("instancePorts");
  const protocol = config.get("protocol", "https");

  if (currentPorts.length === 0) {
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: "$(refresh) Refresh",
          description: "Re-scan terminals in this window",
        },
      ],
      { placeHolder: "No open ports in this VS Code window" },
    );
    if (pick && pick.label.includes("Refresh")) {
      await updatePorts();
    }
    return;
  }

  const items = currentPorts.map((p) => ({
    label: `$(globe) ${protocol}://localhost:${p.port}`,
    description: `${p.command} (PID ${p.pid})`,
    detail: `Listening on ${p.address}`,
    portInfo: p,
  }));

  items.push({
    label: "$(refresh) Refresh",
    description: "Re-scan open ports",
    detail: "",
    portInfo: null,
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a port to open or manage",
  });

  if (!selected) return;

  if (!selected.portInfo) {
    await updatePorts();
    return;
  }

  const portInfo = selected.portInfo;
  const defaultUrl = `${protocol}://localhost:${portInfo.port}`;
  const altProtocol = protocol === "https" ? "http" : "https";
  const altUrl = `${altProtocol}://localhost:${portInfo.port}`;

  const action = await vscode.window.showQuickPick(
    [
      {
        label: `$(globe) Open in Browser (${defaultUrl})`,
        action: "open",
        url: defaultUrl,
      },
      {
        label: `$(globe) Open with ${altProtocol.toUpperCase()} (${altUrl})`,
        action: "open",
        url: altUrl,
      },
      { label: "$(clippy) Copy URL", action: "copy", url: defaultUrl },
      {
        label: "$(trash) Kill Process",
        action: "kill",
        description: `PID ${portInfo.pid} (${portInfo.command})`,
      },
    ],
    { placeHolder: `Action for port ${portInfo.port}` },
  );

  if (!action) return;

  if (action.action === "open") {
    vscode.env.openExternal(vscode.Uri.parse(action.url));
  } else if (action.action === "copy") {
    await vscode.env.clipboard.writeText(action.url);
    vscode.window.showInformationMessage(`Copied ${action.url} to clipboard`);
  } else if (action.action === "kill") {
    try {
      process.kill(portInfo.pid, "SIGTERM");
      vscode.window.showInformationMessage(
        `Stopped process ${portInfo.command} (PID ${portInfo.pid}) on port ${portInfo.port}`,
      );
      setTimeout(updatePorts, 500);
    } catch (e) {
      vscode.window.showErrorMessage(
        `Failed to kill PID ${portInfo.pid}: ${e.message}`,
      );
    }
  }
}

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(
    "instance-ports-statusbar",
    vscode.StatusBarAlignment.Left,
    0,
  );
  statusBarItem.name = "Current Window Ports";
  statusBarItem.command = "instance-ports.showMenu";
  statusBarItem.text = "$(radio-tower) Ports: -";
  statusBarItem.tooltip = "Current Window Ports (Click to scan/refresh)";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("instance-ports.showMenu", showPortMenu),
    vscode.commands.registerCommand("instance-ports.refresh", updatePorts),
  );

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => setTimeout(updatePorts, 1000)),
    vscode.window.onDidCloseTerminal(() => setTimeout(updatePorts, 500)),
  );

  const config = vscode.workspace.getConfiguration("instancePorts");
  const intervalSec = Math.max(1, config.get("pollInterval", 3));

  pollTimer = setInterval(updatePorts, intervalSec * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });

  // Initial scan
  updatePorts();
}

function deactivate() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
}

module.exports = {
  activate,
  deactivate,
};
