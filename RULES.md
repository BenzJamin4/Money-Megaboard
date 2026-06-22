# Money Megaboard — Workspace Rules & Workflows
> [!IMPORTANT]
> These rules are binding. Read and apply them before writing code or executing commands.

## 1. Directory Structure & File Scope
* **Scope:** Access files **exclusively** within the `/Antigravity/` project directory. Never read or write outside this boundary.
* **Organization:** Place Mac terminal command scripts (`.command`, `.sh`) inside `mac commands/`. Place documentation in the root or a dedicated doc folder. Do not clutter the root.
* **Search Optimization:** Work **exclusively** inside the active version folder (`Current Project/versions/vX.Y.Z/`). Add older inactive version folders to `.cursorignore` to prevent AI search pollution.

## 2. Security, Privacy & Git Workflow
* **Data Privacy:** Do **NOT** commit personal or financial data (CSVs, logs, JSON databases). Maintain `.gitignore` actively to exclude them.
* **Git Snapshots:** Commit a snapshot **before** starting work on a version:
  ```bash
  git add . && git commit -m "Snapshot before starting vX.Y.Z"
  ```
  Commit and push to GitHub **after** completing a version, using the PAT stored in `.github_token`.
* **Changelog Censor:** Keep all release notes completely generic. Strip actual names, dollar amounts, transaction descriptions, and explicit dates.

## 3. Architecture & Compatibility
* **Cross-Platform:** App must support macOS and Windows. Always use `os.path.join()` or `pathlib.Path`; never hardcode `/` or `\` in paths. Avoid OS-specific shell commands, libraries, or file permissions. Alert the user before using platform-specific behavior.
* **Offline-First:** The app is completely offline-only by default (v6.0.0 introduces optional internet connectivity with explicit toggle controls). Always download remote JS/CSS assets (e.g. `chart.js`) locally to `static/`.
* **State Persistence:** Store configurations in `app_data.json` using an atomic write strategy (write to `.tmp` and rename using `os.replace`). Never delete settings or database files on read/write errors.
* **Venv & Dependencies:** Venv lives at `Current Project/shared/venv/`. Do not duplicate it. For `v4.X.X` versions, do **NOT** modify `requirements.txt` in a way that breaks older versions (e.g. do not remove `pandas`). Dependency cleanup is reserved for `v5.0.0`.
* **Stack:** Python/Flask backend + HTML/CSS/JS frontend displayed in a native window via PyWebView. Restarts/version switching write to `shared/active_version.txt` and `shared/restart_flag` to reload the process under the runner.

## 4. Versioning & Promotion
When incrementing versions:
1. **Clone First:** Copy the active version folder to the new version folder:
   ```bash
   cp -a "Current Project/versions/v<old>" "Current Project/versions/v<new>"
   ```
2. **Focus:** Work **only** inside the new version folder. Inactive version code should never be modified (except for document/release note corrections).
3. **Semantic Guide:**
   * **X.0.0 (Major):** Architectural overhauls or UI redesigns (relocates previous folders to `Old Versions/`).
   * **0.X.0 (Minor):** New features or optimizations.
   * **0.0.X (Patch):** Bug fixes and polish of existing features.

## 5. Changelog & Releases
When completing a version:
1. **Format:** Use bullet points only. Group under `Features:` and `Bug Fixes:` (omit empty sections).
   * **Major (X.0.0):** Title summarizes overhaul (e.g. `v4.0.0 (Standalone Desktop Migration)`).
   * **Minor (0.X.0):** Title reflects features (e.g. `v3.5.0 (Features & Bug Fixes)`).
   * **Patch (0.0.X):** Title reflects polish (e.g. `v3.4.1 (Feature Polish & Bug Fixes)`).
2. **Master History:** Prepend release notes to the top of the root `README.md`.
3. **UI Display:** Update the inline changelog box in `templates/index.html` (clear out old notes). Once the Smart Changelog Parser is built, the backend will dynamically parse `README.md` on startup instead.

## 6. Agent Boundaries
* **Verification:** The browser subagent is **banned** from testing CSV uploads or chart rendering. The agent must wait for the user to manually verify these features.
