import React, { useState } from 'react';
import { 
  RefreshCw, 
  Trash2, 
  FileCode, 
  Image as ImageIcon, 
  Check, 
  AlertCircle,
  ExternalLink,
  Copy,
  CheckCheck,
  ShieldAlert,
  ShieldCheck,
  X,
  List,
  BarChart3,
  EyeOff,
  Eye,
  GitBranch,
  Package,
  Download,
  RotateCcw,
  Search,
  Clock,
  Files
} from 'lucide-react';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  
  // Navigation: 'list' | 'treemap'
  const [viewMode, setViewMode] = useState('list');
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'code' | 'media' | 'packages' | 'ignored'
  
  // Instant Live Search Query
  const [searchQuery, setSearchQuery] = useState('');

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const [actionNotice, setActionNotice] = useState(null);

  // Enterprise Safety options
  const [useTrash, setUseTrash] = useState(true);
  const [createBackup, setCreateBackup] = useState(true);

  // Scan workspace dependency graph
  const triggerScan = async () => {
    setLoading(true);
    setError(null);
    setActionNotice(null);
    try {
      const response = await fetch('http://localhost:8000/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_dir: "." })
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = await response.json();
      setScanResult(data);

      const allPaths = new Set([
        ...(data.orphan_code_files || []).map(f => f.path),
        ...(data.unused_media_assets || []).map(f => f.path),
        ...(data.unused_dependencies || []).map(f => f.path)
      ]);
      setSelectedPaths(allPaths);
    } catch (err) {
      console.error(err);
      setError("Unable to reach backend engine on http://localhost:8000. Ensure server is running.");
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = (path) => {
    const next = new Set(selectedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setSelectedPaths(next);
  };

  const toggleSelectAll = () => {
    if (!scanResult) return;
    const allItems = [
      ...(scanResult.orphan_code_files || []).map(f => f.path),
      ...(scanResult.unused_media_assets || []).map(f => f.path),
      ...(scanResult.unused_dependencies || []).map(f => f.path)
    ];

    if (selectedPaths.size === allItems.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(allItems));
    }
  };

  // Open file in VS Code editor via native postMessage bridge + fallback
  const openFileInEditor = async (filePath) => {
    if (!filePath || filePath.startsWith('pkg:')) return;
    
    // 1. Native VS Code message bridge (instant, in-editor tab)
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ command: 'openFile', path: filePath }, '*');
    }

    // 2. Also notify backend
    try {
      await fetch('http://localhost:8000/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });
    } catch {}
  };

  // Ignore file and add to .deadcodeignore
  const handleIgnoreItem = async (filePath, e) => {
    if (e) e.stopPropagation();
    try {
      const response = await fetch('http://localhost:8000/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });
      if (response.ok) {
        setActionNotice(`Added ${filePath} to .deadcodeignore`);
        await triggerScan();
      }
    } catch (err) {
      console.error("Failed to ignore file:", err);
    }
  };

  // Restore file and remove from .deadcodeignore (Un-ignore)
  const handleUnignoreItem = async (filePath, e) => {
    if (e) e.stopPropagation();
    try {
      const response = await fetch('http://localhost:8000/unignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });
      if (response.ok) {
        setActionNotice(`Restored ${filePath} back to active scan`);
        await triggerScan();
      }
    } catch (err) {
      console.error("Failed to un-ignore file:", err);
    }
  };

  // Direct 1-click removal of an unused npm dependency
  const handleRemoveDependency = async (pkg, e) => {
    if (e) e.stopPropagation();
    try {
      const response = await fetch('http://localhost:8000/remove-dependency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_name: pkg.package_name,
          package_json_path: pkg.package_json_path,
          use_trash: true
        })
      });
      const data = await response.json();
      if (data.success) {
        const freed = (data.freed_bytes / 1024).toFixed(1);
        setActionNotice(`Removed ${pkg.package_name} from ${pkg.package_json_path} (reclaimed ${freed} KB).`);
        await triggerScan();
      }
    } catch (err) {
      console.error("Failed to remove dependency:", err);
    }
  };

  // Safe Batch Deletion with Recycle Bin & Git Stash Safety
  const handleDeleteSelected = async () => {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch('http://localhost:8000/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: Array.from(selectedPaths),
          use_trash: useTrash,
          create_backup: scanResult?.has_git ? createBackup : false
        })
      });

      const resData = await response.json();
      if (resData.success) {
        const freed = (resData.reclaimed_bytes / 1024).toFixed(1);
        const destination = resData.use_trash ? "moved to Recycle Bin" : "permanently deleted";
        let msg = `Cleaned ${resData.deleted_count} item(s) (${destination}), reclaiming ${freed} KB.`;
        if (resData.backup?.created) {
          msg += ` Git stash backup created: '${resData.backup.stash_name}'.`;
        }
        setActionNotice(msg);
        setShowConfirmModal(false);
        setSelectedPaths(new Set());
        await triggerScan();
      } else {
        throw new Error(resData.error || "Failed to delete files");
      }
    } catch (err) {
      console.error("Deletion error:", err);
      setError("Deletion failed: " + err.message);
    } finally {
      setDeleting(false);
    }
  };

  // Copy markdown report with multi-layer fallback
  const copyReportToClipboard = async () => {
    if (!scanResult) return;
    const stats = getReclaimedStats();
    const text = `# DeadCode Hunter Report\n- Reclaimable Storage: ${stats.formatted}\n- Selected Items: ${selectedPaths.size}\n\n## Target Items:\n` +
      Array.from(selectedPaths).map(p => `- ${p}`).join('\n');

    // 1. Send native postMessage to VS Code Host
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ command: 'copy', text: text }, '*');
    }

    // 2. Clipboard API + Textarea fallback
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {}

    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        copied = true;
      } catch (err) {
        console.error("Textarea fallback copy failed:", err);
      }
    }

    setCopiedReport(true);
    setActionNotice("Report copied to clipboard!");
    setTimeout(() => setCopiedReport(false), 2000);
  };

  // Download Comprehensive Markdown Audit Report
  const downloadAuditReport = () => {
    if (!scanResult) return;
    const orphanCode = scanResult.orphan_code_files || [];
    const unusedMedia = scanResult.unused_media_assets || [];
    const unusedDeps = scanResult.unused_dependencies || [];
    const dupGroups = scanResult.duplicate_media || [];
    const ignored = scanResult.ignored_files || [];
    const totalReclaimable = stats.formatted;

    const now = new Date().toLocaleString();
    let md = `# DeadCode Hunter by Vinish — Enterprise Audit Report\n\n`;
    md += `**Generated**: ${now}  \n`;
    md += `**Workspace Root**: \`${scanResult.workspace || 'Workspace'}\`  \n`;
    md += `**Git Protection**: ${scanResult.has_git ? 'Active (Git repository detected)' : 'Inactive (Recycle Bin safe-mode active)'}  \n\n`;
    
    md += `## Executive Summary\n\n`;
    md += `| Metric | Count / Size |\n`;
    md += `|---|---|\n`;
    md += `| **Reclaimable Storage (Selected)** | **${totalReclaimable}** |\n`;
    md += `| Orphan Source Code Files | ${orphanCode.length} |\n`;
    md += `| Unreferenced Media Assets | ${unusedMedia.length} |\n`;
    md += `| Ghost / Unused npm Dependencies | ${unusedDeps.length} |\n`;
    md += `| Duplicate Media Clusters | ${dupGroups.length} |\n`;
    md += `| Ignored Files (.deadcodeignore) | ${ignored.length} |\n\n`;

    if (orphanCode.length > 0) {
      md += `## 1. Orphan Code Files\n\n`;
      md += `| Path | Size (KB) | Age | Git Status |\n`;
      md += `|---|---|---|---|\n`;
      orphanCode.forEach(f => {
        const ageStr = f.age_days !== undefined ? (f.age_days === 0 ? 'Today' : `${f.age_days}d ago`) : 'N/A';
        md += `| \`${f.path}\` | ${(f.size_bytes / 1024).toFixed(1)} KB | ${ageStr} | ${f.git_status || 'clean'} |\n`;
      });
      md += `\n`;
    }

    if (unusedMedia.length > 0) {
      md += `## 2. Unreferenced Media Assets\n\n`;
      md += `| Path | Size (KB) | Age | Duplicate? | Git Status |\n`;
      md += `|---|---|---|---|---|\n`;
      unusedMedia.forEach(f => {
        const ageStr = f.age_days !== undefined ? (f.age_days === 0 ? 'Today' : `${f.age_days}d ago`) : 'N/A';
        const dupStr = f.is_duplicate ? `Yes (${f.duplicate_of?.length || 1} clone)` : 'No';
        md += `| \`${f.path}\` | ${(f.size_bytes / 1024).toFixed(1)} KB | ${ageStr} | ${dupStr} | ${f.git_status || 'clean'} |\n`;
      });
      md += `\n`;
    }

    if (dupGroups.length > 0) {
      md += `## 3. Duplicate Media Clones & Redundant Assets\n\n`;
      md += `| Files in Duplicate Group | Individual Size | Wasted Space |\n`;
      md += `|---|---|---|\n`;
      dupGroups.forEach(g => {
        const filesList = g.files.map(x => `\`${x.path}\``).join('<br>');
        md += `| ${filesList} | ${(g.size_bytes / 1024).toFixed(1)} KB | ${(g.wasted_bytes / 1024).toFixed(1)} KB |\n`;
      });
      md += `\n`;
    }

    if (unusedDeps.length > 0) {
      md += `## 4. Ghost npm Dependencies\n\n`;
      md += `| Package Name | Version | Node Modules Footprint | File |\n`;
      md += `|---|---|---|---|\n`;
      unusedDeps.forEach(pkg => {
        const sizeStr = pkg.size_bytes > 0 ? `${(pkg.size_bytes / (1024 * 1024)).toFixed(2)} MB` : '0 KB';
        md += `| \`${pkg.package_name}\` | \`${pkg.version}\` | ${sizeStr} | \`${pkg.package_json_path}\` |\n`;
      });
      md += `\n`;
    }

    if (ignored.length > 0) {
      md += `## 5. Ignored Files (.deadcodeignore)\n\n`;
      ignored.forEach(item => {
        md += `- \`${item.path}\`\n`;
      });
      md += `\n`;
    }

    md += `## Safe Recovery Guidelines\n\n`;
    md += `1. **Recycle Bin Safe Undo**: All deleted files are sent to the Windows / OS Recycle Bin. If any file was removed inadvertently, open your OS Recycle Bin and click "Restore".\n`;
    md += `2. **Git Stash Backup**: If Git backup was enabled, your workspace snapshot was preserved. Run \`git stash list\` and \`git stash apply\` to restore previous state.\n\n`;
    md += `---\n*Generated automatically by DeadCode Hunter Enterprise Engine*\n`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deadcode-audit-report-${Date.now()}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setActionNotice("Audit report downloaded (deadcode-audit-report.md)");
  };

  const getReclaimedStats = () => {
    if (!scanResult) return { formatted: "0 KB", bytes: 0 };
    let totalBytes = 0;
    const all = [
      ...(scanResult.orphan_code_files || []),
      ...(scanResult.unused_media_assets || []),
      ...(scanResult.unused_dependencies || [])
    ];
    all.forEach(item => {
      if (selectedPaths.has(item.path)) {
        totalBytes += (item.size_bytes || 0);
      }
    });

    if (totalBytes >= 1024 * 1024) {
      return { formatted: `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`, bytes: totalBytes };
    }
    return { formatted: `${(totalBytes / 1024).toFixed(1)} KB`, bytes: totalBytes };
  };

  // Helper: Format file age staleness badge
  const renderAgeBadge = (ageDays) => {
    if (ageDays === undefined || ageDays === null) return null;
    let text = '';
    let badgeClasses = '';

    if (ageDays === 0) {
      text = 'Today';
      badgeClasses = 'bg-emerald-950/40 text-emerald-400 border-emerald-800/60';
    } else if (ageDays === 1) {
      text = '1d ago';
      badgeClasses = 'bg-zinc-800/60 text-zinc-400 border-zinc-700/60';
    } else if (ageDays < 30) {
      text = `${ageDays}d ago`;
      badgeClasses = 'bg-zinc-800/60 text-zinc-400 border-zinc-700/60';
    } else if (ageDays < 365) {
      const mo = Math.floor(ageDays / 30);
      text = `${mo}mo ago`;
      badgeClasses = mo >= 6 
        ? 'bg-amber-950/50 text-amber-300 border-amber-800/70' 
        : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/60';
    } else {
      const yr = (ageDays / 365).toFixed(1);
      text = `${yr}y ago`;
      badgeClasses = 'bg-rose-950/50 text-rose-300 border-rose-800/70 font-semibold';
    }

    return (
      <span 
        title={`Modified ${ageDays} days ago`}
        className={`text-[9px] px-1.5 py-0.2 rounded border ${badgeClasses} whitespace-nowrap`}
      >
        {text}
      </span>
    );
  };

  const stats = getReclaimedStats();
  const orphanCode = scanResult?.orphan_code_files || [];
  const unusedMedia = scanResult?.unused_media_assets || [];
  const unusedDeps = scanResult?.unused_dependencies || [];
  const duplicateMedia = scanResult?.duplicate_media || [];
  const ignoredFiles = scanResult?.ignored_files || [];
  const totalItems = orphanCode.length + unusedMedia.length + unusedDeps.length;
  const folderBreakdown = scanResult?.folder_breakdown || [];

  // Filter items live based on searchQuery
  const q = searchQuery.trim().toLowerCase();
  const filteredOrphanCode = orphanCode.filter(f => !q || f.path.toLowerCase().includes(q));
  const filteredUnusedMedia = unusedMedia.filter(f => !q || f.path.toLowerCase().includes(q));
  const filteredUnusedDeps = unusedDeps.filter(p => !q || p.package_name.toLowerCase().includes(q) || p.package_json_path.toLowerCase().includes(q));
  const filteredIgnoredFiles = ignoredFiles.filter(f => !q || f.path.toLowerCase().includes(q));

  const totalFilteredCount = filteredOrphanCode.length + filteredUnusedMedia.length + filteredUnusedDeps.length;

  return (
    <div className="min-h-screen bg-[#171717] text-[#ececec] font-sans antialiased text-[13px] flex flex-col p-4 select-none">
      {/* Top Header */}
      <header className="flex items-center justify-between pb-3.5 mb-3 border-b border-[#262626]">
        <div className="flex items-center space-x-2.5">
          <img 
            src="/logo.png" 
            alt="DeadCode Hunter Logo" 
            className="w-5 h-5 rounded-md object-cover border border-zinc-700/80 shadow-xs shrink-0" 
          />
          <div className="flex items-baseline space-x-1.5">
            <span className="font-semibold text-sm text-[#f4f4f4] tracking-tight">DeadCode Hunter</span>
            <span className="text-[11px] text-zinc-500 font-normal">by Vinish</span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* View Mode Switcher */}
          {scanResult && (
            <div className="flex bg-[#212121] rounded-lg p-0.5 border border-[#2c2c2c] text-xs">
              <button
                onClick={() => setViewMode('list')}
                title="Checklist View"
                className={`p-1 rounded ${viewMode === 'list' ? 'bg-[#2f2f2f] text-white' : 'text-[#8e8e8e] hover:text-[#d4d4d4]'}`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('treemap')}
                title="Storage Breakdown"
                className={`p-1 rounded ${viewMode === 'treemap' ? 'bg-[#2f2f2f] text-white' : 'text-[#8e8e8e] hover:text-[#d4d4d4]'}`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {scanResult && totalItems > 0 && (
            <div className="flex items-center space-x-1">
              <button
                onClick={downloadAuditReport}
                title="Download Audit Report (Markdown)"
                className="p-1.5 rounded-full text-[#8e8e8e] hover:text-white hover:bg-[#262626] transition"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={copyReportToClipboard}
                title="Copy Summary Report"
                className="p-1.5 rounded-full text-[#8e8e8e] hover:text-white hover:bg-[#262626] transition"
              >
                {copiedReport ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}

          <button
            onClick={triggerScan}
            disabled={loading}
            className="flex items-center space-x-1.5 bg-[#f4f4f4] hover:bg-white active:bg-zinc-200 text-[#171717] font-medium text-xs px-3 py-1.5 rounded-full transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Analyzing' : 'Scan'}</span>
          </button>
        </div>
      </header>

      {/* Action Notice */}
      {actionNotice && (
        <div className="bg-[#19241d] border border-[#23422e] text-[#86efac] p-2.5 rounded-lg text-xs mb-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionNotice}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className="text-[#86efac]/70 hover:text-[#86efac]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error Notice */}
      {error && (
        <div className="bg-[#241a1a] border border-[#4d2828] text-[#fca5a5] p-3 rounded-lg text-xs mb-3 flex items-start space-x-2.5">
          <AlertCircle className="w-4 h-4 text-[#f87171] shrink-0 mt-0.5" />
          <div className="leading-relaxed flex-1">{error}</div>
          <button onClick={() => setError(null)} className="text-[#fca5a5]/70 hover:text-[#fca5a5]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Initial Empty State */}
      {!scanResult && !loading && !error && (
        <div className="my-auto flex flex-col items-center justify-center text-center py-16 px-4">
          <div className="w-10 h-10 rounded-xl bg-[#212121] border border-[#2f2f2f] flex items-center justify-center mb-3 text-zinc-400">
            <Trash2 className="w-5 h-5 text-zinc-300 stroke-[1.5]" />
          </div>
          <h2 className="text-sm font-medium text-[#f4f4f4] mb-1">Clean and optimize</h2>
          <p className="text-xs text-[#8e8e8e] max-w-[260px] leading-relaxed">
            Scan your workspace to find unreferenced code, duplicate media clones, and ghost npm dependencies.
          </p>
          <button
            onClick={triggerScan}
            className="mt-5 text-xs text-[#d4d4d4] bg-[#212121] hover:bg-[#2b2b2b] border border-[#333333] px-4 py-2 rounded-full transition"
          >
            Start Workspace Scan
          </button>
        </div>
      )}

      {/* Dashboard View */}
      {scanResult && (
        <div className="flex-1 flex flex-col space-y-3">
          {/* Reclaim Hero Card */}
          <div className="bg-[#212121] border border-[#2f2f2f] rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-normal text-[#8e8e8e] uppercase tracking-wider">Reclaimable Space</div>
              <div className="text-xl font-semibold text-white tracking-tight mt-0.5">{stats.formatted}</div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={toggleSelectAll}
                className="text-xs text-[#b4b4b4] hover:text-white bg-[#2b2b2b] hover:bg-[#333333] px-2.5 py-1.5 rounded-lg transition border border-[#383838]"
              >
                {selectedPaths.size === totalItems && totalItems > 0 ? "Deselect all" : "Select all"}
              </button>

              {selectedPaths.size > 0 && (
                <button
                  onClick={() => setShowConfirmModal(true)}
                  className="flex items-center space-x-1 text-xs text-rose-300 hover:text-white bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 px-2.5 py-1.5 rounded-lg transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clean ({selectedPaths.size})</span>
                </button>
              )}
            </div>
          </div>

          {/* VIEW MODE 1: CHECKLIST */}
          {viewMode === 'list' && (
            <>
              {/* Search & Filter Input Bar */}
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by filename, extension (.jsx, .svg), or folder..." 
                  className="w-full bg-[#1e1e1e] border border-[#2c2c2c] text-white text-xs pl-8 pr-7 py-1.5 rounded-lg focus:outline-none focus:border-zinc-500 transition placeholder:text-zinc-500"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')} 
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                    title="Clear filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Tab Selector */}
              <div className="flex p-0.5 bg-[#212121] rounded-lg border border-[#2a2a2a] text-xs">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`flex-1 py-1 rounded-md transition font-medium ${
                    activeTab === 'all' ? 'bg-[#2f2f2f] text-white shadow-sm' : 'text-[#8e8e8e] hover:text-[#d4d4d4]'
                  }`}
                >
                  All ({q ? totalFilteredCount : totalItems})
                </button>
                <button
                  onClick={() => setActiveTab('code')}
                  className={`flex-1 py-1 rounded-md transition font-medium ${
                    activeTab === 'code' ? 'bg-[#2f2f2f] text-white shadow-sm' : 'text-[#8e8e8e] hover:text-[#d4d4d4]'
                  }`}
                >
                  Code ({filteredOrphanCode.length})
                </button>
                <button
                  onClick={() => setActiveTab('media')}
                  className={`flex-1 py-1 rounded-md transition font-medium ${
                    activeTab === 'media' ? 'bg-[#2f2f2f] text-white shadow-sm' : 'text-[#8e8e8e] hover:text-[#d4d4d4]'
                  }`}
                >
                  Media ({filteredUnusedMedia.length})
                </button>
                <button
                  onClick={() => setActiveTab('packages')}
                  className={`flex-1 py-1 rounded-md transition font-medium ${
                    activeTab === 'packages' ? 'bg-[#2f2f2f] text-white shadow-sm' : 'text-[#8e8e8e] hover:text-[#d4d4d4]'
                  }`}
                >
                  Packages ({filteredUnusedDeps.length})
                </button>
                <button
                  onClick={() => setActiveTab('ignored')}
                  className={`flex-1 py-1 rounded-md transition font-medium ${
                    activeTab === 'ignored' ? 'bg-[#2f2f2f] text-white shadow-sm' : 'text-[#8e8e8e] hover:text-[#d4d4d4]'
                  }`}
                >
                  Ignored ({filteredIgnoredFiles.length})
                </button>
              </div>

              {/* Items List */}
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
                {/* 1. Code Files Section */}
                {(activeTab === 'all' || activeTab === 'code') && filteredOrphanCode.length > 0 && (
                  <div className="space-y-1">
                    {activeTab === 'all' && (
                      <div className="text-[11px] font-medium text-[#737373] px-1 pt-1 flex items-center space-x-1.5">
                        <FileCode className="w-3 h-3" />
                        <span>Code Files</span>
                      </div>
                    )}
                    {filteredOrphanCode.map((file) => {
                      const isChecked = selectedPaths.has(file.path);
                      return (
                        <div
                          key={file.path}
                          className={`group flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                            isChecked 
                              ? 'bg-[#212121] border-[#333333] text-[#f4f4f4]' 
                              : 'bg-[#1a1a1a] border-transparent text-[#737373] hover:bg-[#212121]/60'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5 truncate pr-2 flex-1">
                            <div 
                              onClick={() => toggleItem(file.path)}
                              className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition ${
                                isChecked 
                                  ? 'bg-white border-white text-black' 
                                  : 'border-[#444] bg-transparent group-hover:border-[#666]'
                              }`}
                            >
                              {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <FileCode className="w-3.5 h-3.5 text-[#8e8e8e] shrink-0" />
                            <span 
                              onClick={() => openFileInEditor(file.absolute_path || file.path)}
                              title="Click to open file in editor"
                              className="truncate font-mono text-xs hover:text-indigo-400 hover:underline cursor-pointer"
                            >
                              {file.path}
                            </span>
                            
                            {/* File Age Staleness Badge */}
                            {renderAgeBadge(file.age_days)}

                            {file.git_status === 'untracked' && (
                              <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded border border-slate-700">Untracked</span>
                            )}
                            {file.git_status === 'modified' && (
                              <span className="text-[9px] bg-amber-950/60 text-amber-400 px-1.5 py-0.2 rounded border border-amber-800">Modified</span>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              onClick={(e) => handleIgnoreItem(file.path, e)}
                              title="Ignore file (.deadcodeignore)"
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-white text-[#8e8e8e] transition"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => openFileInEditor(file.absolute_path || file.path)}
                              title="Open file"
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-white text-[#8e8e8e] transition"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                            <span className="text-[11px] text-[#666] font-mono">
                              {(file.size_bytes / 1024).toFixed(1)} KB
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 2. Media Assets Section */}
                {(activeTab === 'all' || activeTab === 'media') && filteredUnusedMedia.length > 0 && (
                  <div className="space-y-1">
                    {activeTab === 'all' && (
                      <div className="text-[11px] font-medium text-[#737373] px-1 pt-2 flex items-center space-x-1.5">
                        <ImageIcon className="w-3 h-3" />
                        <span>Media Assets</span>
                      </div>
                    )}
                    {filteredUnusedMedia.map((file) => {
                      const isChecked = selectedPaths.has(file.path);
                      return (
                        <div
                          key={file.path}
                          className={`group flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                            isChecked 
                              ? 'bg-[#212121] border-[#333333] text-[#f4f4f4]' 
                              : 'bg-[#1a1a1a] border-transparent text-[#737373] hover:bg-[#212121]/60'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5 truncate pr-2 flex-1">
                            <div 
                              onClick={() => toggleItem(file.path)}
                              className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition ${
                                isChecked 
                                  ? 'bg-white border-white text-black' 
                                  : 'border-[#444] bg-transparent group-hover:border-[#666]'
                              }`}
                            >
                              {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <ImageIcon className="w-3.5 h-3.5 text-[#8e8e8e] shrink-0" />
                            <span 
                              onClick={() => openFileInEditor(file.absolute_path || file.path)}
                              title="Click to open file in editor"
                              className="truncate font-mono text-xs hover:text-indigo-400 hover:underline cursor-pointer"
                            >
                              {file.path}
                            </span>
                            
                            {/* Duplicate Badge */}
                            {file.is_duplicate && (
                              <span 
                                title={`Identical copy of: ${file.duplicate_of?.join(', ')}`}
                                className="text-[9px] bg-purple-950/70 text-purple-300 border border-purple-800/80 px-1.5 py-0.2 rounded flex items-center space-x-1 shrink-0"
                              >
                                <Files className="w-2.5 h-2.5" />
                                <span>Duplicate</span>
                              </span>
                            )}

                            {/* File Age Staleness Badge */}
                            {renderAgeBadge(file.age_days)}

                            {file.git_status === 'untracked' && (
                              <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded border border-slate-700">Untracked</span>
                            )}
                            {file.git_status === 'modified' && (
                              <span className="text-[9px] bg-amber-950/60 text-amber-400 px-1.5 py-0.2 rounded border border-amber-800">Modified</span>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              onClick={(e) => handleIgnoreItem(file.path, e)}
                              title="Ignore file (.deadcodeignore)"
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-white text-[#8e8e8e] transition"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => openFileInEditor(file.absolute_path || file.path)}
                              title="Open file"
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-white text-[#8e8e8e] transition"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                            <span className="text-[11px] text-[#666] font-mono">
                              {(file.size_bytes / 1024).toFixed(1)} KB
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 3. Ghost npm Dependencies Section */}
                {(activeTab === 'all' || activeTab === 'packages') && filteredUnusedDeps.length > 0 && (
                  <div className="space-y-1">
                    {activeTab === 'all' && (
                      <div className="text-[11px] font-medium text-[#737373] px-1 pt-2 flex items-center space-x-1.5">
                        <Package className="w-3 h-3" />
                        <span>Ghost npm Dependencies</span>
                      </div>
                    )}
                    {filteredUnusedDeps.map((pkg) => {
                      const isChecked = selectedPaths.has(pkg.path);
                      const sizeFormatted = pkg.size_bytes >= 1024 * 1024
                        ? `${(pkg.size_bytes / (1024 * 1024)).toFixed(2)} MB`
                        : `${(pkg.size_bytes / 1024).toFixed(1)} KB`;

                      return (
                        <div
                          key={pkg.path}
                          className={`group flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                            isChecked 
                              ? 'bg-[#212121] border-[#333333] text-[#f4f4f4]' 
                              : 'bg-[#1a1a1a] border-transparent text-[#737373] hover:bg-[#212121]/60'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5 truncate pr-2 flex-1">
                            <div 
                              onClick={() => toggleItem(pkg.path)}
                              className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition ${
                                isChecked 
                                  ? 'bg-white border-white text-black' 
                                  : 'border-[#444] bg-transparent group-hover:border-[#666]'
                              }`}
                            >
                              {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <Package className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <div className="flex items-center space-x-2 truncate">
                              <span className="font-mono text-xs text-white font-medium truncate">
                                {pkg.package_name}
                              </span>
                              <span className="text-[10px] text-[#888] font-mono">
                                {pkg.version}
                              </span>
                              <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0.2 rounded border border-zinc-700">
                                {pkg.package_json_path}
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              onClick={(e) => handleRemoveDependency(pkg, e)}
                              title="Uninstall / remove package"
                              className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 p-1 hover:text-rose-400 text-[#8e8e8e] transition text-[10px]"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Remove</span>
                            </button>
                            <span className="text-[11px] text-amber-300/80 font-mono">
                              {sizeFormatted}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 4. Ignored Files Section */}
                {activeTab === 'ignored' && (
                  <div className="space-y-1">
                    {filteredIgnoredFiles.length === 0 ? (
                      <div className="text-center py-10 text-xs text-[#737373]">
                        {q ? `No ignored files matching "${q}".` : 'No files in .deadcodeignore. Files you ignore using the eye icon will appear here.'}
                      </div>
                    ) : (
                      filteredIgnoredFiles.map((file) => {
                        const isChecked = selectedPaths.has(file.path);
                        return (
                          <div
                            key={file.path}
                            className={`group flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                              isChecked 
                                ? 'bg-[#212121] border-[#333333] text-[#f4f4f4]' 
                                : 'bg-[#1a1a1a] border-transparent text-[#737373] hover:bg-[#212121]/60'
                            }`}
                          >
                            <div className="flex items-center space-x-2.5 truncate pr-2 flex-1">
                              <div 
                                onClick={() => toggleItem(file.path)}
                                className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition ${
                                  isChecked 
                                    ? 'bg-white border-white text-black' 
                                    : 'border-[#444] bg-transparent group-hover:border-[#666]'
                                }`}
                              >
                                {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                              </div>
                              {file.type === 'code' ? (
                                <FileCode className="w-3.5 h-3.5 text-[#8e8e8e] shrink-0" />
                              ) : (
                                <ImageIcon className="w-3.5 h-3.5 text-[#8e8e8e] shrink-0" />
                              )}
                              <span 
                                onClick={() => openFileInEditor(file.absolute_path || file.path)}
                                title="Click to open file in editor"
                                className="truncate font-mono text-xs hover:text-indigo-400 hover:underline cursor-pointer"
                              >
                                {file.path}
                              </span>
                              {renderAgeBadge(file.age_days)}
                              <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0.2 rounded border border-zinc-700">Ignored</span>
                            </div>

                            <div className="flex items-center space-x-1.5 shrink-0">
                              <button
                                onClick={(e) => handleUnignoreItem(file.path, e)}
                                title="Restore to active scan (Un-ignore)"
                                className="flex items-center space-x-1 p-1 hover:text-emerald-400 text-[#8e8e8e] transition text-[10px]"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span className="opacity-0 group-hover:opacity-100 transition">Restore</span>
                              </button>
                              <button
                                onClick={() => openFileInEditor(file.absolute_path || file.path)}
                                title="Open file"
                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-white text-[#8e8e8e] transition"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                              <span className="text-[11px] text-[#666] font-mono">
                                {(file.size_bytes / 1024).toFixed(1)} KB
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {totalItems === 0 && activeTab !== 'ignored' && (
                  <div className="text-center py-10 text-xs text-[#737373]">
                    Workspace clean. No dead code, duplicate assets, or ghost dependencies found.
                  </div>
                )}

                {totalItems > 0 && totalFilteredCount === 0 && activeTab !== 'ignored' && (
                  <div className="text-center py-10 text-xs text-[#737373]">
                    No items match filter "{q}".
                  </div>
                )}
              </div>
            </>
          )}

          {/* VIEW MODE 2: STORAGE TREEMAP / BREAKDOWN */}
          {viewMode === 'treemap' && (
            <div className="flex-1 space-y-3 overflow-y-auto">
              {duplicateMedia.length > 0 && (
                <div className="bg-[#241d2d] border border-[#482d61] rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-purple-300 flex items-center space-x-1.5">
                      <Files className="w-3.5 h-3.5" />
                      <span>Duplicate Media Assets Detected</span>
                    </span>
                    <span className="text-purple-400 font-mono text-[11px]">
                      {duplicateMedia.length} clusters ({(scanResult.total_wasted_duplicate_bytes / 1024).toFixed(1)} KB wasted)
                    </span>
                  </div>
                  <p className="text-[11px] text-purple-300/80 leading-relaxed">
                    Identical binary media files exist in multiple locations. Check the Media tab to eliminate copies.
                  </p>
                </div>
              )}

              <div className="text-xs font-medium text-[#8e8e8e]">Storage Distribution by Folder</div>
              <div className="space-y-2">
                {folderBreakdown.map((item) => {
                  const percent = stats.bytes > 0 ? ((item.size_bytes / stats.bytes) * 100).toFixed(0) : 0;
                  return (
                    <div key={item.folder} className="bg-[#212121] border border-[#2f2f2f] rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-white font-medium">{item.folder}/</span>
                        <span className="text-[#8e8e8e]">{(item.size_bytes / 1024).toFixed(1)} KB ({item.count} items)</span>
                      </div>
                      <div className="w-full bg-[#171717] h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(percent, 5)}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Enterprise Safe Deletion Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#212121] border border-[#333333] rounded-xl p-4 w-full max-w-sm shadow-xl space-y-3.5">
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-white">Safe Cleanup Confirmation</h3>
                <p className="text-xs text-[#8e8e8e] mt-1 leading-relaxed">
                  Clean <span className="text-white font-medium">{selectedPaths.size}</span> selected item(s), reclaiming <span className="text-white font-medium">{stats.formatted}</span>.
                </p>
              </div>
            </div>

            {/* Safety Controls */}
            <div className="space-y-2 bg-[#1a1a1a] p-3 rounded-lg border border-[#2a2a2a] text-xs">
              {/* Option 1: Move to OS Recycle Bin */}
              <label className="flex items-start space-x-2.5 cursor-pointer select-none">
                <input 
                  type="checkbox"
                  checked={useTrash}
                  onChange={(e) => setUseTrash(e.target.checked)}
                  className="mt-0.5 rounded bg-zinc-800 border-zinc-700 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="font-medium text-[#f4f4f4] flex items-center space-x-1.5">
                    <span>Move to Recycle Bin (Safe Undo)</span>
                    <span className="text-[10px] bg-emerald-950 text-emerald-300 px-1 rounded border border-emerald-800">Recommended</span>
                  </div>
                  <div className="text-[11px] text-[#888] mt-0.5 leading-tight">
                    Deleted items can be restored anytime from your OS Recycle Bin.
                  </div>
                </div>
              </label>

              {/* Option 2: Git Stash Backup */}
              <label className={`flex items-start space-x-2.5 select-none ${scanResult?.has_git ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <input 
                  type="checkbox"
                  disabled={!scanResult?.has_git}
                  checked={scanResult?.has_git ? createBackup : false}
                  onChange={(e) => setCreateBackup(e.target.checked)}
                  className="mt-0.5 rounded bg-zinc-800 border-zinc-700 text-indigo-500 focus:ring-0 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="font-medium text-[#f4f4f4] flex items-center space-x-1.5">
                    <span>Create Git Stash Backup</span>
                    {scanResult?.has_git ? (
                      <span className="text-[10px] bg-indigo-950 text-indigo-300 px-1 rounded border border-indigo-800">Git</span>
                    ) : (
                      <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1 rounded border border-zinc-700">No Git</span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#888] mt-0.5 leading-tight">
                    {scanResult?.has_git 
                      ? "Takes a complete stash snapshot before deleting so you can undo with 'git stash pop'."
                      : "Git repository not detected in workspace root. (Recycle Bin safe-mode active)"}
                  </div>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-1">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={deleting}
                className="text-xs text-[#b4b4b4] hover:text-white bg-[#2b2b2b] hover:bg-[#333333] px-3 py-1.5 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center space-x-1.5 text-xs text-white bg-rose-600 hover:bg-rose-500 active:bg-rose-700 px-3.5 py-1.5 rounded-lg transition font-medium disabled:opacity-50"
              >
                {deleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{deleting ? 'Cleaning...' : useTrash ? 'Move to Trash' : 'Delete Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
