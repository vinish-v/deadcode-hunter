# DeadCode Hunter by Vinish 🎯

<div align="center">
  <img src="resources/icon.png" width="128" height="128" alt="DeadCode Hunter Logo" />
  <p><strong>Hunt orphan code, unreferenced media, and ghost npm dependencies with zero-risk safe deletion.</strong></p>
</div>

---

## ⚡ Features at a Glance

- **🎯 Tri-Factor Scanning**: Unifies dead code detection (`.js`, `.jsx`, `.ts`, `.tsx`), dangling media assets (`.svg`, `.png`, `.jpg`, `.webp`), and unreferenced npm dependencies (`package.json`) in one scan.
- **♻️ Windows Recycle Bin (Safe Undo)**: Deletions are sent to your OS Recycle Bin instead of hard unlinking. Restore files anytime with 1-click.
- **🛡️ Git Stash Backup Safety Net**: Automatically captures a timestamped stash snapshot (`git stash push -u`) before batch deletions so you can undo anytime with `git stash pop`.
- **👯 Cryptographic Duplicate Media Detection**: Identifies exact binary clone assets across folders using SHA-256 content hashing.
- **⏳ File Age & Staleness Badges**: Shows how long a file has been abandoned (`Today`, `X mo ago`, `> 1y ago`).
- **🔍 Instant Live Search & Filter**: Filter files, folders, and extensions in real-time as you type.
- **📊 Storage Breakdown Treemap**: Visual distribution showing which folders hold the most reclaimable space.
- **📑 Markdown Audit Report**: Generates and downloads itemized compliance reports for Pull Requests.

---

## 🚀 Getting Started

1. Open your project in VS Code.
2. Click the **DeadCode Hunter** icon in the Activity Bar or Explorer.
3. Click **Scan** to analyze your workspace.
4. Review detected orphan code, unused media, and ghost dependencies.
5. Select items to clean and click **Clean Selected**.

---

## 📄 License

MIT License © 2026 Vinish
