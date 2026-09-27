const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { fork } = require('child_process');

let serverProcess = null;
const activeWebviews = new Set();

/**
 * Returns currently active workspace root and name
 */
function getCurrentWorkspace() {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return {
            root: folders[0].uri.fsPath,
            name: folders[0].name
        };
    }
    return { root: null, name: '' };
}

/**
 * Broadcasts workspace change event to all active webviews
 */
function broadcastWorkspaceChange() {
    const ws = getCurrentWorkspace();
    for (const wv of activeWebviews) {
        try {
            wv.postMessage({
                command: 'workspaceChanged',
                workspaceRoot: ws.root,
                workspaceName: ws.name
            });
        } catch (e) {}
    }
}

/**
 * Spawns backend server.js process
 */
function startServerProcess(context) {
    if (serverProcess) {
        try { serverProcess.kill(); } catch {}
        serverProcess = null;
    }
    console.log('[DeadCode Hunter] Launching backend server.js on port 8000...');
    try {
        const serverScript = path.join(context.extensionUri.fsPath, 'server.js');
        if (fs.existsSync(serverScript)) {
            serverProcess = fork(serverScript, [], {
                cwd: context.extensionUri.fsPath,
                silent: true,
                env: { ...process.env, PORT: '8000' }
            });
            serverProcess.stdout?.on('data', (d) => console.log(`[DeadCode Server] ${d}`));
            serverProcess.stderr?.on('data', (d) => console.error(`[DeadCode Server Err] ${d}`));
        }
    } catch (err) {
        console.error('[DeadCode Hunter] Failed to start backend engine:', err);
    }
}

/**
 * Ensures backend server.js is running on port 8000
 */
function ensureServerRunning(context) {
    const checkReq = http.get('http://localhost:8000/', (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            if (res.statusCode === 200 && body.includes('DeadCode Hunter')) {
                console.log('[DeadCode Hunter] Backend already active on port 8000');
            } else {
                startServerProcess(context);
            }
        });
    });

    checkReq.setTimeout(1500, () => {
        checkReq.destroy();
        startServerProcess(context);
    });

    checkReq.on('error', () => {
        startServerProcess(context);
    });
}

/**
 * Activates the VS Code extension shell.
 */
function activate(context) {
    console.log('DeadCode Hunter Extension Activated!');

    // Start background scanning engine if not already running
    ensureServerRunning(context);

    // Watch for workspace folder changes and broadcast to webview
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            broadcastWorkspaceChange();
        })
    );

    // Handler for messages from webview (open file, copy to clipboard, workspace queries)
    const handleWebviewMessage = async (message, webview) => {
        if (!message) return;

        if (message.command === 'getWorkspace') {
            const ws = getCurrentWorkspace();
            if (webview) {
                webview.postMessage({
                    command: 'setWorkspace',
                    workspaceRoot: ws.root,
                    workspaceName: ws.name
                });
            }
        } else if (message.command === 'openFolder') {
            vscode.commands.executeCommand('vscode.openFolder');
        } else if (message.command === 'openFile' && message.path) {
            try {
                const ws = getCurrentWorkspace();
                const workspaceRoot = message.targetDir || ws.root;
                
                let targetPath = path.isAbsolute(message.path) 
                    ? message.path 
                    : (workspaceRoot ? path.resolve(workspaceRoot, message.path) : null);

                if (!targetPath || !fs.existsSync(targetPath)) {
                    if (fs.existsSync(message.path)) {
                        targetPath = message.path;
                    }
                }

                if (targetPath && fs.existsSync(targetPath)) {
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
                    await vscode.window.showTextDocument(doc, { preview: false });
                } else {
                    vscode.window.showWarningMessage(`File not found: ${message.path}`);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Unable to open file: ${err.message}`);
            }
        } else if (message.command === 'copy' && message.text) {
            try {
                await vscode.env.clipboard.writeText(message.text);
                vscode.window.setStatusBarMessage('DeadCode report copied to clipboard!', 3000);
            } catch (err) {
                console.error("Clipboard copy failed:", err);
            }
        }
    };

    // 1. Register Webview Provider for both custom sidebar and Explorer panel
    const provider = new DeadCodeSidebarProvider(context.extensionUri, handleWebviewMessage);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('deadcode-hunter.sidebarView', provider),
        vscode.window.registerWebviewViewProvider('deadcode-hunter.explorerView', provider)
    );

    // 2. Register Command: Open DeadCode Hunter on the Right Side
    const openBesideCommand = vscode.commands.registerCommand('deadcode-hunter.openBeside', () => {
        const panel = vscode.window.createWebviewPanel(
            'deadcodeHunterPanel',
            'DeadCode Hunter by Vinish',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    context.extensionUri,
                    vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist')
                ]
            }
        );

        activeWebviews.add(panel.webview);
        panel.onDidDispose(() => {
            activeWebviews.delete(panel.webview);
        });

        panel.webview.html = getHtmlForWebview(panel.webview, context.extensionUri);
        panel.webview.onDidReceiveMessage((msg) => handleWebviewMessage(msg, panel.webview));
    });

    context.subscriptions.push(openBesideCommand);
}

function getHtmlForWebview(webview, extensionUri) {
    const distPath = path.join(extensionUri.fsPath, 'webview-ui', 'dist');
    const indexPath = path.join(distPath, 'index.html');
    const ws = getCurrentWorkspace();

    if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, 'utf8');

        const distUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist'));

        // Rewrite relative asset paths to VS Code webview URIs (handles ./assets/..., /assets/..., assets/...)
        html = html.replace(/(href|src)="(?:\.\/|\/)?(assets\/[^"]+)"/g, (match, attr, rel) => {
            const fileUri = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist', rel);
            return `${attr}="${webview.asWebviewUri(fileUri)}"`;
        });

        html = html.replace(/(href|src)="(?:\.\/|\/)?(logo\.png)"/g, (match, attr, rel) => {
            const fileUri = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist', rel);
            return `${attr}="${webview.asWebviewUri(fileUri)}"`;
        });

        // Inject base href, CSP, and full reset styles to eliminate any border/margin gaps
        const baseHref = `<base href="${distUri}/">`;
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'; img-src ${webview.cspSource} https: data: blob:; font-src ${webview.cspSource}; connect-src http://localhost:8000 http://127.0.0.1:8000 ws://localhost:* ws://127.0.0.1:*;">`;
        const styleReset = `<style>html, body, #root { margin: 0 !important; padding: 0 !important; width: 100% !important; min-height: 100% !important; background-color: #171717 !important; overflow-x: hidden !important; }</style>`;

        // Inject script for native VS Code API bridge and workspace context
        const scriptInjection = /* html */ `
            <script>
                try {
                    window.vscodeApi = acquireVsCodeApi();
                } catch(e) {}
                window.vscodeWorkspace = {
                    root: ${JSON.stringify(ws.root)},
                    name: ${JSON.stringify(ws.name)}
                };
            </script>
        `;

        html = html.replace('<head>', `<head>\n    ${baseHref}\n    ${cspMeta}\n    ${styleReset}`);
        html = html.replace('</head>', `    ${scriptInjection}\n</head>`);
        return html;
    }

    // Dev fallback if dist is missing
    return /* html */ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>DeadCode Hunter</title>
            <style>
                html, body, iframe {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    border: none;
                    background-color: #171717;
                    overflow: hidden;
                }
            </style>
        </head>
        <body>
            <iframe 
                id="app-frame"
                src="http://localhost:5173" 
                style="width: 100vw; height: 100vh; border: none;"
                allow="clipboard-read; clipboard-write;"
            ></iframe>
            <script>
                const vscode = acquireVsCodeApi();
                window.addEventListener('message', (event) => {
                    if (event.data && typeof event.data === 'object') {
                        vscode.postMessage(event.data);
                    }
                });
            </script>
        </body>
        </html>
    `;
}

class DeadCodeSidebarProvider {
    constructor(extensionUri, messageHandler) {
        this._extensionUri = extensionUri;
        this._messageHandler = messageHandler;
    }

    resolveWebviewView(webviewView) {
        activeWebviews.add(webviewView.webview);
        webviewView.onDidDispose(() => {
            activeWebviews.delete(webviewView.webview);
        });

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist')
            ]
        };

        webviewView.webview.html = getHtmlForWebview(webviewView.webview, this._extensionUri);

        if (this._messageHandler) {
            webviewView.webview.onDidReceiveMessage((msg) => this._messageHandler(msg, webviewView.webview));
        }
    }
}

function deactivate() {
    activeWebviews.clear();
    if (serverProcess) {
        try {
            serverProcess.kill();
        } catch {}
    }
}

module.exports = {
    activate,
    deactivate
};
