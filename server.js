const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, execSync } = require('child_process');

const PORT = process.env.PORT || 8000;

const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'venv', '.venv', 'dist', 'build',
    'out', '.next', '.cache', 'coverage', '.vscode'
]);

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.ico']);

// Regex pattern to extract import specs and asset references
const IMPORT_REGEX = /(?:import\s+(?:[\w*\s{},$]+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)|import\(['"]([^'"]+)['"]\)|src=['"]([^'"]+)['"]|url\(['"]?([^'"]+)['"]?\))/g;

/**
 * Loads .deadcodeignore rules if present
 */
function loadIgnorePatterns(rootDir) {
    const ignoreFile = path.join(rootDir, '.deadcodeignore');
    if (!fs.existsSync(ignoreFile)) return [];
    try {
        return fs.readFileSync(ignoreFile, 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
    } catch {
        return [];
    }
}

/**
 * Checks if a relative path matches any ignore pattern
 */
function isIgnored(relPath, patterns) {
    for (const pat of patterns) {
        if (relPath === pat || relPath.startsWith(pat.replace('/*', '')) || relPath.endsWith(pat.replace('*.', '.'))) {
            return true;
        }
    }
    return false;
}

/**
 * Loads tsconfig or jsconfig compilerOptions.paths aliases
 */
function loadPathAliases(rootDir) {
    const aliases = {};
    for (const configName of ['tsconfig.json', 'jsconfig.json']) {
        const configPath = path.join(rootDir, configName);
        if (fs.existsSync(configPath)) {
            try {
                const raw = fs.readFileSync(configPath, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
                const json = JSON.parse(raw);
                const baseUrl = json.compilerOptions?.baseUrl || '.';
                const paths = json.compilerOptions?.paths || {};

                for (const [aliasPattern, targetList] of Object.entries(paths)) {
                    if (targetList && targetList.length > 0) {
                        const cleanAlias = aliasPattern.replace('/*', '');
                        const cleanTarget = targetList[0].replace('/*', '');
                        aliases[cleanAlias] = path.resolve(rootDir, baseUrl, cleanTarget);
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }
    }
    return aliases;
}

/**
 * Checks Git status for files in workspace
 */
function getGitStatuses(rootDir) {
    const gitMap = new Map();
    try {
        const output = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        for (const line of output.split('\n')) {
            if (line.length >= 3) {
                const code = line.substring(0, 2).trim();
                const filePath = line.substring(3).trim().replace(/\\/g, '/');
                if (code === '??') {
                    gitMap.set(filePath, 'untracked');
                } else if (code.includes('M') || code.includes('A')) {
                    gitMap.set(filePath, 'modified');
                } else if (code.includes('D')) {
                    gitMap.set(filePath, 'deleted');
                }
            }
        }
    } catch {
        // Not a git repo or git not found
    }
    return gitMap;
}

/**
 * Recursively scans directory for code and media files.
 */
function walkDirectory(dirPath, codeFiles, mediaFiles) {
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) {
                walkDirectory(path.join(dirPath, entry.name), codeFiles, mediaFiles);
            }
        } else if (entry.isFile()) {
            const fullPath = path.join(dirPath, entry.name);
            const ext = path.extname(entry.name).toLowerCase();
            if (CODE_EXTENSIONS.has(ext)) {
                codeFiles.push(fullPath);
            } else if (MEDIA_EXTENSIONS.has(ext)) {
                mediaFiles.push(fullPath);
            }
        }
    }
}

/**
 * Finds all package.json files in workspace (ignoring node_modules, build, etc.)
 */
function findPackageJsonFiles(dirPath, result = []) {
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) {
                findPackageJsonFiles(path.join(dirPath, entry.name), result);
            }
        } else if (entry.isFile() && entry.name === 'package.json') {
            result.push(path.join(dirPath, entry.name));
        }
    }
    return result;
}

/**
 * Calculates folder disk footprint recursively
 */
function getFolderSize(dirPath) {
    let totalSize = 0;
    try {
        if (!fs.existsSync(dirPath)) return 0;
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                totalSize += getFolderSize(fullPath);
            } else if (entry.isFile()) {
                try {
                    totalSize += fs.statSync(fullPath).size;
                } catch {}
            }
        }
    } catch {}
    return totalSize;
}

/**
 * Safely moves file or folder to OS Recycle Bin (Windows), with fallback
 */
function moveToTrash(targetPath) {
    const absPath = path.resolve(targetPath);
    if (!fs.existsSync(absPath)) return false;

    if (process.platform === 'win32') {
        const escaped = absPath.replace(/'/g, "''");
        const psCommand = `Add-Type -AssemblyName Microsoft.VisualBasic; if (Test-Path -LiteralPath '${escaped}' -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin') }`;
        try {
            execSync(`powershell -NoProfile -NonInteractive -Command "${psCommand}"`, { stdio: ['ignore', 'ignore', 'ignore'] });
            return true;
        } catch {
            // fallback
        }
    }

    // Fallback if not Windows or PowerShell failed
    try {
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
            fs.rmSync(absPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(absPath);
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Creates a Git Stash backup of all modified & untracked files
 */
function createGitBackup(rootDir) {
    const gitDir = path.join(rootDir, '.git');
    if (!fs.existsSync(gitDir)) {
        return { created: false, reason: 'No Git repository initialized' };
    }

    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const stashMsg = `DeadCode-Hunter-by-Vinish-Backup-${timestamp}`;
        execSync(`git stash push -u -m "${stashMsg}"`, {
            cwd: rootDir,
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf8'
        });
        return { created: true, stash_name: stashMsg };
    } catch (err) {
        return { created: false, error: err.message };
    }
}

/**
 * Resolves relative, root-relative, or tsconfig-aliased import strings
 */
function resolveImportPath(currentFile, importStr, rootDir, pathAliases) {
    let candidateBase = null;

    // 1. Check path aliases (e.g. @/components/Button)
    for (const [alias, targetBaseDir] of Object.entries(pathAliases)) {
        if (importStr.startsWith(alias)) {
            const sub = importStr.substring(alias.length).replace(/^\//, '');
            candidateBase = path.join(targetBaseDir, sub);
            break;
        }
    }

    // 2. Relative or root-relative paths
    if (!candidateBase) {
        if (importStr.startsWith('.')) {
            candidateBase = path.resolve(path.dirname(currentFile), importStr);
        } else if (importStr.startsWith('/')) {
            candidateBase = path.resolve(rootDir, importStr.substring(1));
        } else {
            return null;
        }
    }

    if (fs.existsSync(candidateBase) && fs.statSync(candidateBase).isFile()) {
        return candidateBase;
    }

    const allExts = [...CODE_EXTENSIONS, ...MEDIA_EXTENSIONS];
    for (const ext of allExts) {
        const candidate = candidateBase + ext;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }

    if (fs.existsSync(candidateBase) && fs.statSync(candidateBase).isDirectory()) {
        for (const ext of CODE_EXTENSIONS) {
            const candidate = path.join(candidateBase, `index${ext}`);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate;
            }
        }
    }

    return null;
}

/**
 * Helper: Parse JSON body from request
 */
function parseJsonBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                resolve({});
            }
        });
    });
}

/**
 * Helper: Send JSON response with CORS headers
 */
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

// Native Zero-Dependency HTTP Server
const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    const url = req.url.split('?')[0];

    // 1. Health check
    if (url === '/' && req.method === 'GET') {
        return sendJson(res, 200, { status: 'ok', service: 'DeadCode Hunter by Vinish Enterprise Engine' });
    }

    // 2. Scan workspace
    if (url === '/scan' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const targetDirInput = body?.target_dir || '.';
        const rootPath = path.resolve(targetDirInput);

        if (!fs.existsSync(rootPath)) {
            return sendJson(res, 400, { error: `Directory not found: ${rootPath}` });
        }

        const ignorePatterns = loadIgnorePatterns(rootPath);
        const pathAliases = loadPathAliases(rootPath);
        const gitStatuses = getGitStatuses(rootPath);

        const rawCodeFiles = [];
        const rawMediaFiles = [];
        walkDirectory(rootPath, rawCodeFiles, rawMediaFiles);

        const ignoredFiles = [];

        const codeFiles = rawCodeFiles.filter(fp => {
            const rel = path.relative(rootPath, fp).replace(/\\/g, '/');
            if (isIgnored(rel, ignorePatterns)) {
                const stats = fs.statSync(fp);
                const ageDays = Math.floor((Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24));
                ignoredFiles.push({
                    path: rel,
                    absolute_path: fp,
                    size_bytes: stats.size,
                    type: 'code',
                    age_days: ageDays,
                    last_modified: stats.mtime.toISOString(),
                    git_status: gitStatuses.get(rel) || 'clean'
                });
                return false;
            }
            return true;
        });

        const mediaFiles = rawMediaFiles.filter(fp => {
            const rel = path.relative(rootPath, fp).replace(/\\/g, '/');
            if (isIgnored(rel, ignorePatterns)) {
                const stats = fs.statSync(fp);
                const ageDays = Math.floor((Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24));
                ignoredFiles.push({
                    path: rel,
                    absolute_path: fp,
                    size_bytes: stats.size,
                    type: 'media',
                    age_days: ageDays,
                    last_modified: stats.mtime.toISOString(),
                    git_status: gitStatuses.get(rel) || 'clean'
                });
                return false;
            }
            return true;
        });

        // Duplicate Media Detection via SHA-256
        const mediaHashMap = new Map();
        for (const fp of rawMediaFiles) {
            try {
                const buffer = fs.readFileSync(fp);
                const hash = crypto.createHash('sha256').update(buffer).digest('hex');
                const rel = path.relative(rootPath, fp).replace(/\\/g, '/');
                const stats = fs.statSync(fp);
                if (!mediaHashMap.has(hash)) {
                    mediaHashMap.set(hash, []);
                }
                mediaHashMap.get(hash).push({
                    path: rel,
                    absolute_path: fp,
                    size_bytes: stats.size,
                    age_days: Math.floor((Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24)),
                    last_modified: stats.mtime.toISOString(),
                    git_status: gitStatuses.get(rel) || 'clean'
                });
            } catch {}
        }

        const duplicateMediaGroups = [];
        const duplicatePathToGroup = new Map();
        for (const [hash, group] of mediaHashMap.entries()) {
            if (group.length > 1) {
                duplicateMediaGroups.push({
                    hash: hash,
                    size_bytes: group[0].size_bytes,
                    wasted_bytes: group[0].size_bytes * (group.length - 1),
                    count: group.length,
                    files: group
                });
                for (const f of group) {
                    duplicatePathToGroup.set(f.path, group.map(x => x.path).filter(p => p !== f.path));
                }
            }
        }

        const referencedFiles = new Set();
        const referencedPackages = new Set();
        const entryPoints = new Set();

        for (const filePath of codeFiles) {
            const fileName = path.basename(filePath).toLowerCase();
            const isConfigOrEntry = [
                'main.', 'index.', 'extension.', 'server.', 'config.',
                '.config', 'setup', 'babel', 'webpack', 'rollup', 'postcss'
            ].some(ep => fileName.includes(ep));

            if (isConfigOrEntry) {
                entryPoints.add(filePath);
                referencedFiles.add(filePath);
            }

            try {
                const content = fs.readFileSync(filePath, 'utf8');
                let match;
                IMPORT_REGEX.lastIndex = 0;

                while ((match = IMPORT_REGEX.exec(content)) !== null) {
                    const importStr = match[1] || match[2] || match[3] || match[4] || match[5];
                    if (importStr) {
                        const resolved = resolveImportPath(filePath, importStr, rootPath, pathAliases);
                        if (resolved) {
                            referencedFiles.add(resolved);
                        } else if (!importStr.startsWith('.') && !importStr.startsWith('/')) {
                            let pkgName = importStr.trim();
                            if (pkgName.startsWith('@')) {
                                const parts = pkgName.split('/');
                                if (parts.length >= 2) {
                                    pkgName = `${parts[0]}/${parts[1]}`;
                                }
                            } else {
                                pkgName = pkgName.split('/')[0];
                            }
                            referencedPackages.add(pkgName);
                        }
                    }
                }
            } catch {}
        }

        const orphanCodeFiles = codeFiles
            .filter(fp => !referencedFiles.has(fp))
            .map(fp => {
                const stats = fs.statSync(fp);
                const rel = path.relative(rootPath, fp).replace(/\\/g, '/');
                const ageDays = Math.floor((Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24));
                return {
                    path: rel,
                    absolute_path: fp,
                    size_bytes: stats.size,
                    type: 'code',
                    age_days: ageDays,
                    last_modified: stats.mtime.toISOString(),
                    git_status: gitStatuses.get(rel) || 'clean'
                };
            });

        const unusedMediaAssets = mediaFiles
            .filter(fp => !referencedFiles.has(fp))
            .map(fp => {
                const stats = fs.statSync(fp);
                const rel = path.relative(rootPath, fp).replace(/\\/g, '/');
                const ageDays = Math.floor((Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24));
                const duplicates = duplicatePathToGroup.get(rel) || [];
                return {
                    path: rel,
                    absolute_path: fp,
                    size_bytes: stats.size,
                    type: 'media',
                    age_days: ageDays,
                    last_modified: stats.mtime.toISOString(),
                    is_duplicate: duplicates.length > 0,
                    duplicate_of: duplicates,
                    git_status: gitStatuses.get(rel) || 'clean'
                };
            });

        const packageJsonFiles = findPackageJsonFiles(rootPath);
        const unusedDependencies = [];

        for (const pkgJsonPath of packageJsonFiles) {
            try {
                const raw = fs.readFileSync(pkgJsonPath, 'utf8');
                const json = JSON.parse(raw);
                const deps = json.dependencies || {};
                const scriptsStr = Object.values(json.scripts || {}).join(' ');
                const pkgDir = path.dirname(pkgJsonPath);
                const relPkgJson = path.relative(rootPath, pkgJsonPath).replace(/\\/g, '/');

                for (const [depName, version] of Object.entries(deps)) {
                    const isImported = referencedPackages.has(depName);
                    const isUsedInScript = scriptsStr.includes(depName);
                    const isFrameworkCore = ['react', 'react-dom'].includes(depName) &&
                        (referencedPackages.has('react') || referencedPackages.has('react-dom'));

                    if (!isImported && !isUsedInScript && !isFrameworkCore) {
                        const localNm = path.join(pkgDir, 'node_modules', depName);
                        const rootNm = path.join(rootPath, 'node_modules', depName);
                        let size = 0;
                        if (fs.existsSync(localNm)) {
                            size = getFolderSize(localNm);
                        } else if (fs.existsSync(rootNm)) {
                            size = getFolderSize(rootNm);
                        }

                        unusedDependencies.push({
                            package_name: depName,
                            version: version,
                            path: `pkg:${depName}@${relPkgJson}`,
                            package_json_path: relPkgJson,
                            size_bytes: size,
                            type: 'package'
                        });
                    }
                }
            } catch {}
        }

        const folderStats = {};
        [...orphanCodeFiles, ...unusedMediaAssets].forEach(item => {
            const topFolder = item.path.includes('/') ? item.path.split('/')[0] : 'root';
            if (!folderStats[topFolder]) {
                folderStats[topFolder] = { folder: topFolder, size_bytes: 0, count: 0 };
            }
            folderStats[topFolder].size_bytes += item.size_bytes;
            folderStats[topFolder].count += 1;
        });

        const folderBreakdown = Object.values(folderStats).sort((a, b) => b.size_bytes - a.size_bytes);

        return sendJson(res, 200, {
            workspace: rootPath,
            has_git: fs.existsSync(path.join(rootPath, '.git')),
            total_code_files: codeFiles.length,
            total_media_files: mediaFiles.length,
            orphan_code_files: orphanCodeFiles,
            unused_media_assets: unusedMediaAssets,
            unused_dependencies: unusedDependencies,
            duplicate_media: duplicateMediaGroups,
            total_wasted_duplicate_bytes: duplicateMediaGroups.reduce((acc, g) => acc + g.wasted_bytes, 0),
            ignored_files: ignoredFiles,
            folder_breakdown: folderBreakdown
        });
    }

    // 3. Open file in VS Code
    if (url === '/open' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const targetFile = body?.path;
        if (!targetFile) return sendJson(res, 400, { error: "Missing path" });
        const fullPath = path.resolve(targetFile);
        if (!fs.existsSync(fullPath)) return sendJson(res, 404, { error: "File not found" });

        const isWin = process.platform === 'win32';
        const cmd = isWin ? `cmd /c code -g "${fullPath}"` : `code -g "${fullPath}"`;
        exec(cmd, { shell: true }, (err) => {
            if (err) console.error("CLI open error:", err);
        });
        return sendJson(res, 200, { success: true, opened: fullPath });
    }

    // 4. Ignore file
    if (url === '/ignore' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const itemPath = body?.path;
        if (!itemPath) return sendJson(res, 400, { error: "Missing path to ignore" });

        const ignoreFile = path.resolve('.deadcodeignore');
        fs.appendFileSync(ignoreFile, `\n${itemPath}\n`);
        return sendJson(res, 200, { success: true, ignored: itemPath });
    }

    // 5. Un-ignore file
    if (url === '/unignore' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const itemPath = body?.path;
        if (!itemPath) return sendJson(res, 400, { error: "Missing path to unignore" });

        const ignoreFile = path.resolve('.deadcodeignore');
        if (fs.existsSync(ignoreFile)) {
            try {
                let lines = fs.readFileSync(ignoreFile, 'utf8').split('\n');
                lines = lines.filter(line => line.trim() && line.trim() !== itemPath.trim());
                fs.writeFileSync(ignoreFile, lines.join('\n'));
            } catch (err) {
                return sendJson(res, 500, { error: err.message });
            }
        }
        return sendJson(res, 200, { success: true, unignored: itemPath });
    }

    // 6. Remove dependency
    if (url === '/remove-dependency' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const { package_name, package_json_path, use_trash = true } = body;
        if (!package_name) return sendJson(res, 400, { error: "Missing package_name" });

        const absPkgJson = path.resolve(package_json_path || 'package.json');
        if (!fs.existsSync(absPkgJson)) return sendJson(res, 404, { error: "package.json not found" });

        try {
            const json = JSON.parse(fs.readFileSync(absPkgJson, 'utf8'));
            if (json.dependencies && json.dependencies[package_name]) delete json.dependencies[package_name];
            if (json.devDependencies && json.devDependencies[package_name]) delete json.devDependencies[package_name];
            fs.writeFileSync(absPkgJson, JSON.stringify(json, null, 2) + '\n');

            let freedBytes = 0;
            const nmDir = path.join(path.dirname(absPkgJson), 'node_modules', package_name);
            if (fs.existsSync(nmDir)) {
                freedBytes = getFolderSize(nmDir);
                if (use_trash) moveToTrash(nmDir);
                else fs.rmSync(nmDir, { recursive: true, force: true });
            }

            return sendJson(res, 200, { success: true, removed: package_name, freed_bytes: freedBytes });
        } catch (err) {
            return sendJson(res, 500, { error: err.message });
        }
    }

    // 7. Delete files batch
    if (url === '/delete' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const pathsToDelete = body?.paths || [];
        const useTrash = body?.use_trash !== false;
        const createBackup = Boolean(body?.create_backup);
        const targetDirInput = body?.target_dir || '.';
        const rootPath = path.resolve(targetDirInput);

        if (!Array.isArray(pathsToDelete) || pathsToDelete.length === 0) {
            return sendJson(res, 400, { error: "No files specified for deletion" });
        }

        let backupInfo = { created: false };
        if (createBackup) {
            backupInfo = createGitBackup(rootPath);
        }

        let deletedCount = 0;
        let reclaimedBytes = 0;
        const errors = [];

        for (const itemPath of pathsToDelete) {
            try {
                if (typeof itemPath === 'string' && itemPath.startsWith('pkg:')) {
                    const spec = itemPath.substring(4);
                    const [pkgName, relPkgJson] = spec.split('@');
                    const absPkgJson = path.resolve(rootPath, relPkgJson || 'package.json');
                    if (fs.existsSync(absPkgJson)) {
                        const raw = fs.readFileSync(absPkgJson, 'utf8');
                        const json = JSON.parse(raw);
                        let changed = false;
                        if (json.dependencies && json.dependencies[pkgName]) {
                            delete json.dependencies[pkgName];
                            changed = true;
                        }
                        if (json.devDependencies && json.devDependencies[pkgName]) {
                            delete json.devDependencies[pkgName];
                            changed = true;
                        }
                        if (changed) {
                            fs.writeFileSync(absPkgJson, JSON.stringify(json, null, 2) + '\n');
                        }

                        const nmPath = path.join(path.dirname(absPkgJson), 'node_modules', pkgName);
                        if (fs.existsSync(nmPath)) {
                            reclaimedBytes += getFolderSize(nmPath);
                            if (useTrash) moveToTrash(nmPath);
                            else fs.rmSync(nmPath, { recursive: true, force: true });
                        }
                        deletedCount++;
                    }
                } else {
                    const fullPath = path.resolve(rootPath, itemPath);
                    if (fs.existsSync(fullPath)) {
                        const stat = fs.statSync(fullPath);
                        reclaimedBytes += stat.size;
                        if (useTrash) moveToTrash(fullPath);
                        else fs.unlinkSync(fullPath);
                        deletedCount++;
                    }
                }
            } catch (err) {
                errors.push({ path: itemPath, error: err.message });
            }
        }

        return sendJson(res, 200, {
            success: true,
            deleted_count: deletedCount,
            reclaimed_bytes: reclaimedBytes,
            use_trash: useTrash,
            backup: backupInfo,
            errors: errors
        });
    }

    // Default 404
    sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
    console.log(`[DeadCode Hunter Server] Running on http://localhost:${PORT}`);
});
