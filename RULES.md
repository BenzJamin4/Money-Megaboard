# Money Megaboard Agent Rules

These are the strict rules and workflows that must be followed when working on the Money Megaboard project:

## 1. Project Organization
- Place Mac terminal command scripts (`.command`) in `mac commands/`.

- Place documentation in the root directory or in a documentation folder.
- Do **not** clutter the root directory — only primary config files belong there.
- The browser subagent is **banned** from testing CSV uploads or chart files. The AI must wait for the user to manually verify those.

## 2. Version Branching
When incrementing the version (e.g., `v3.4.9` → `v4.0.1`):
1. **Clone first**: `cp -a <old_version_dir> <new_version_dir>`
2. **Work exclusively in the new folder** — never modify the source version's files.

**Semantic Versioning Guide:**
- **X.0.0** (Major) — Major redesigns or architectural overhauls (e.g., 3.x → 4.0.0)
- **0.X.0** (Minor) — New features or new ideas added
- **0.0.X** (Patch) — Bug fixes and polishes of features that already exist

## 3. Git Workflow & Backups
1. **Snapshot before editing**: `git add . && git commit -m "Snapshot before starting vX.Y.Z"`
2. **Push to GitHub after every version** — the PAT is stored in `.agents/github_token` and embedded in the `origin` remote URL. **Failure to push is unacceptable.**

## 4. Virtual Environment
- Lives at `shared/venv/` — do **NOT** copy or create venv inside version folders.
- Run via `shared/venv/bin/python <version_dir>/launcher.py` or the top-level server.

## 5. Changelog Updates
When completing a version, strictly follow this procedure to document changes:
1. **Write the release notes using bullet points.** Do not use paragraph blobs.
2. **Update the UI**: Paste the *new* release notes into the inline changelog box within `templates/index.html` of the new version folder. Do not touch or carry over any old version notes here.
3. **Update the Master History**: Paste the exact same new release notes at the very top of `README.md` in the project root.

**Formatting Rules based on Version Type:**
- **X.0.0 (Major Updates)**: The title string should safely summarize the major overhaul (e.g., `v4.0.0 (Standalone Desktop Application Migration)`). Followed purely by bullet points detailing the fundamental changes.
- **0.X.0 (Minor Features)**: The title should generally reflect features added (e.g., `v3.5.0 (Features & Bug Fixes)`). Group changes under `Features:` (listed first with bullets), followed by `Bug Fixes:` (listed second with bullets).
- **0.0.X (Patches)**: The title should reflect polish (e.g., `v3.4.1 (Feature Polish & Bug Fixes)`). Follow the exact same `Features:` then `Bug Fixes:` bulleted structural priority as Minor updates.

## 6. Cross-Platform Compatibility
This app must remain compatible with **both macOS and Windows**.
- Always use `os.path.join()` or `pathlib.Path` — never hardcode `/` or `\` in paths.
- Avoid OS-specific shell commands, libraries, or file permissions.
- **Alert the user before** introducing any platform-specific behavior.

## 7. Architecture (v4.0.0+)
- **Backend**: Python + Flask (all data logic, CSV processing, financial math).
- **Frontend**: HTML/CSS/JS served by Flask, displayed in a native window via PyWebView.
- **Launcher**: Each version contains a `launcher.py` that starts Flask + PyWebView.
- **Packaging**: PyInstaller creates standalone `.app` (Mac) / `.exe` (Windows) when needed.

## 8. File Access Scope
The agent must **only** access files within the `/Antigravity/` project directory. Never read from or write to the Desktop, home directory, or any other system paths. Provide all temporary files or debug logs within `/Antigravity/`.
