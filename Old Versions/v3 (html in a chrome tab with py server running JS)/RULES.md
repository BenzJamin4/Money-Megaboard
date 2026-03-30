# Money Megaboard Agent Rules

These are the strict rules and workflows that must be followed when working on the Money Megaboard project:

## 1. Project Organization
Always maintain a clean and organized project structure. When creating new files, scripts, or assets, ensure they are placed in their appropriate directories:
- Mac terminal command scripts (`.command`) belong in `mac commands/`.
- Mock or dummy CSV files belong in `Dummy CSVs/`.
- Documentation or general project rules belong in the root directory or an appropriate documentation folder.
- Do not place files in the root directory unless they are primary configuration files or absolutely belong there. Always double-check where existing similar files are organized before creating a new one.
- Do not trust the browser subagent to upload CSVs automatically or confirm its own work blindly. The subagent is banned from testing chart files and uploads. The AI must wait for the user to manually upload files and verify the system behavior.

## 2. Version Branching
When performing enhancements or bug fixes that necessitate incrementing the Semantic Version (e.g., from `v3.2.1` to `v3.2.2`), you **MUST NEVER** overwrite the existing project directory directly. Follow this workflow:
1. **Clone the Folder**: Use bash explicitly to copy the active directory into the new version's designated location (e.g., `cp -a versions/v3.2.1 versions/v3.2.2`).
2. **Work Exclusively in the New Branch**: Change your target `Cwd` path immediately to ONLY execute code replacements on files within your newly minted folder.

## 3. Git Workflow & Backups
1. **Secure the Baseline via Git**: Before making your first edit to a new version, initialize or update the git repository tracking changes in the master directory (`git add . && git commit -m "Snapshot before starting vX.Y.Z"`).
2. **Upload to GitHub (CRITICAL)**: After completing the edits for any iteration, you MUST ALWAYS push the updated version to GitHub. The authentication token is safely stored and configured on the remote `origin`. **Failure to perform this step is unacceptable.**

## 4. Virtual Environment
The virtual environment lives at `shared/venv/` in the project root. Do NOT create or copy a `venv` folder inside version directories. Run the app with `shared/venv/bin/python versions/vX.Y.Z/app.py` or use the top-level `server.py` which handles this automatically.

## 5. Changelog Updates
You MUST ALWAYS update the embedded CHANGELOG string directly inside the `templates/index.html` file of the NEW version. Document all Bug Fixes and Features clearly above the previous version, and categorize them correctly (e.g., separate bug fixes from features). DO NOT skip this step!
