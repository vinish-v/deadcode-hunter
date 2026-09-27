const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { fork } = require('child_process');

let serverProcess = null;

/**
 * Ensures backend server.js is running on port 8000
 */
function ensureServerRunning(context) {
    const req = http.get('http://localhost:8000/', (res) => {
        console.log('[DeadCode Hunter] Backend already active on port 8000');
    });

    req.on('error', () => {
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
    });
}

/**
 * Activates the VS Code extension shell.
 */
function activate(context) {
    console.log('DeadCode Hunter Extension Activated!');

    // Start background scanning engine if not already running
    ensureServerRunning(context);

    // Handler for messages from webview (open file, copy to clipboard)
    const handleWebviewMessage = async (message) => {
        if (!message) return;

        if (message.command === 'openFile' && message.path) {
            try {
                const folders = vscode.workspace.workspaceFolders;
                const workspaceRoot = (folders && folders.length > 0) ? folders[0].uri.fsPath : context.extensionUri.fsPath;
                
                let targetPath = path.isAbsolute(message.path) 
                    ? message.path 
                    : path.resolve(workspaceRoot, message.path);

                // If not found in workspace, fallback to extension root directory
                if (!fs.existsSync(targetPath)) {
                    targetPath = path.resolve(context.extensionUri.fsPath, message.path);
                }

                if (fs.existsSync(targetPath)) {
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
                    vscode.Uri.file(path.join(context.extensionUri.fsPath, 'webview-ui', 'dist'))
                ]
            }
        );

        panel.webview.html = getHtmlForWebview(panel.webview, context.extensionUri);
        panel.webview.onDidReceiveMessage(handleWebviewMessage);
    });

    context.subscriptions.push(openBesideCommand);
}

function getHtmlForWebview(webview, extensionUri) {
    const distPath = path.join(extensionUri.fsPath, 'webview-ui', 'dist');
    const indexPath = path.join(distPath, 'index.html');

    if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, 'utf8');

        // Rewrite relative asset paths to VS Code webview URIs
        html = html.replace(/(href|src)="\/?(assets\/[^"]+)"/g, (match, attr, rel) => {
            const fileUri = vscode.Uri.file(path.join(distPath, rel));
            return `${attr}="${webview.asWebviewUri(fileUri)}"`;
        });

        html = html.replace(/src="\/?(logo\.png)"/g, (match, rel) => {
            const fileUri = vscode.Uri.file(path.join(distPath, rel));
            return `src="${webview.asWebviewUri(fileUri)}"`;
        });

        // Inject script for native VS Code API bridge
        const scriptInjection = /* html */ `
            <script>
                try {
                    window.vscodeApi = acquireVsCodeApi();
                } catch(e) {}
            </script>
        `;
        html = html.replace('</head>', `${scriptInjection}</head>`);
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
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.file(path.join(this._extensionUri.fsPath, 'webview-ui', 'dist'))
            ]
        };

        webviewView.webview.html = getHtmlForWebview(webviewView.webview, this._extensionUri);

        if (this._messageHandler) {
            webviewView.webview.onDidReceiveMessage(this._messageHandler);
        }
    }
}

function deactivate() {
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
