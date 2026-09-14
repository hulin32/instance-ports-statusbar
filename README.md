# Current Window Ports

<img src="icon.png" width="112" alt="Current Window Ports icon">

Shows the ports that **this VS Code window's own terminals** are listening on, right in the status bar.

Working across several projects at once, you end up with a pile of dev servers on ports you no longer remember, and `lsof -i` shows all of them mixed together. This extension scopes the answer to the current window: it walks the process tree of that window's terminals, so only servers *you started here* show up.

## Features

- **Strict window isolation** — only ports whose process descends from a terminal in this window. Other windows and other projects stay invisible.
- **Live status bar item** — `$(radio-tower) Ports: 3000, 5173`, refreshed on a configurable interval.
- **One-click actions** — click the item to open a port in the browser, copy its URL, kill the process, or refresh.
- **HTTPS by default** — ready for dev servers behind a local proxy or a self-signed cert, with an `http://` fallback in the same menu.
- **No runtime dependencies** — a single file, no bundled packages.

## Requirements

- VS Code `1.80.0` or newer
- **macOS or Linux.** Port discovery shells out to `lsof` and walks the process tree with `pgrep`; Windows is not supported yet.

## Install

**From a release:** download the `.vsix` from [Releases](https://github.com/linhuon/instance-ports-statusbar/releases) and install it.

```sh
code --install-extension instance-ports-statusbar-0.1.0.vsix
```

Or open the Extensions view, click the `...` menu, and choose **Install from VSIX…**.

**From source:**

```sh
git clone https://github.com/linhuon/instance-ports-statusbar.git
cd instance-ports-statusbar
npx @vscode/vsce package
code --install-extension instance-ports-statusbar-0.1.0.vsix
```

## Usage

Start a dev server in a terminal inside VS Code — `npm run dev`, `cargo run`, whatever. Once it binds a port, the status bar shows it.

Click the status bar item to pick a port and choose an action:

- **Open in Browser** — `https://localhost:<port>`
- **Open with HTTP** — the other protocol, for plain dev servers
- **Copy URL**
- **Kill Process** — sends `SIGTERM` to the listener

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `instancePorts.protocol` | `"https"` \| `"http"` | `"https"` | Default protocol for opening ports in the browser |
| `instancePorts.hideWhenEmpty` | `boolean` | `false` | Hide the status bar item when no ports are open in this window |
| `instancePorts.pollInterval` | `number` | `3` | Seconds between port checks |

## License

MIT — see [LICENSE](LICENSE).
