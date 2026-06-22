#!/usr/bin/env python3
"""
Money Megaboard — Interactive Version Bumper
=============================================
Automates the creation of a new version branch:
1. Detects the current active version.
2. Prompts the user for version bump type (Minor, Patch, or Custom).
3. Clones the active version directory to the new version directory.
4. Updates the active version tracker file.
5. Prepends a template changelog block to README.md.
6. Automatically stages changes and runs git commit snapshot.

This script is cross-platform and works on macOS and Windows.
"""

import os
import sys
import re
import shutil
import subprocess

def get_current_version(project_dir):
    """Resolve current active version from shared/active_version.txt or versions folder."""
    active_file = os.path.join(project_dir, "Current Project", "shared", "active_version.txt")
    if os.path.exists(active_file):
        try:
            with open(active_file, "r", encoding="utf-8") as f:
                ver = f.read().strip()
                if ver:
                    return ver
        except Exception:
            pass
            
    # Fallback: List versions folder
    versions_dir = os.path.join(project_dir, "Current Project", "versions")
    if os.path.exists(versions_dir):
        versions = [d for d in os.listdir(versions_dir) if d.startswith('v') and os.path.isdir(os.path.join(versions_dir, d))]
        if versions:
            # Sort semantically
            def parse_ver(v_str):
                m = re.match(r'^v?(\d+)\.(\d+)\.(\d+)', v_str)
                return tuple(map(int, m.groups())) if m else (0, 0, 0)
            versions.sort(key=parse_ver)
            return versions[-1]
            
    return "v4.0.0"

def parse_semver(v_str):
    """Parse vX.Y.Z into (major, minor, patch)."""
    m = re.match(r'^v?(\d+)\.(\d+)\.(\d+)', v_str)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    return None

def main():
    # Resolve project root (parent of Development Tools)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.abspath(os.path.join(script_dir, ".."))
    
    print("=" * 60)
    print("      Money Megaboard — Version Bumper & Snapshot Tool      ")
    print("=" * 60)
    
    current_ver = get_current_version(project_dir)
    print(f"Current version detected: {current_ver}")
    
    parsed = parse_semver(current_ver)
    if not parsed:
        print(f"Error: Current version format '{current_ver}' is not valid semver (vX.Y.Z).")
        sys.exit(1)
        
    major, minor, patch = parsed
    
    # Propose bumps
    patch_bump = f"v{major}.{minor}.{patch + 1}"
    minor_bump = f"v{major}.{minor + 1}.0"
    
    print("\nSelect bump type:")
    print(f"1) Patch: {current_ver} -> {patch_bump}")
    print(f"2) Minor: {current_ver} -> {minor_bump}")
    print("3) Custom version string")
    
    choice = input("\nEnter choice (1, 2, or 3): ").strip()
    
    if choice == "1":
        new_ver = patch_bump
    elif choice == "2":
        new_ver = minor_bump
    elif choice == "3":
        new_ver = input("Enter custom version (e.g. v4.2.1): ").strip()
        if not new_ver.startswith("v"):
            new_ver = "v" + new_ver
    else:
        print("Invalid choice. Exiting.")
        sys.exit(1)
        
    if not re.match(r'^v?\d+\.\d+\.\d+$', new_ver):
        print(f"Error: Target version '{new_ver}' is invalid. Must follow vX.Y.Z format.")
        sys.exit(1)
        
    print(f"\nTargeting version: {new_ver}")
    
    versions_dir = os.path.join(project_dir, "Current Project", "versions")
    src_dir = os.path.join(versions_dir, current_ver)
    dst_dir = os.path.join(versions_dir, new_ver)
    
    if not os.path.exists(src_dir):
        print(f"Error: Source directory '{src_dir}' does not exist.")
        sys.exit(1)
        
    if os.path.exists(dst_dir):
        print(f"Warning: Directory '{dst_dir}' already exists.")
        overwrite = input("Do you want to overwrite it? (y/N): ").strip().lower()
        if overwrite != "y":
            print("Aborted.")
            sys.exit(0)
        shutil.rmtree(dst_dir)
        
    # 1. Copy directory
    print(f"\nCloning version folder:\n  From: {src_dir}\n  To:   {dst_dir}")
    shutil.copytree(src_dir, dst_dir)
    
    # 2. Update active version tracker file
    active_file = os.path.join(project_dir, "Current Project", "shared", "active_version.txt")
    print(f"Updating active version tracker: {active_file}")
    os.makedirs(os.path.dirname(active_file), exist_ok=True)
    with open(active_file, "w", encoding="utf-8") as f:
        f.write(new_ver)
        
    # 3. Update README.md
    readme_path = os.path.join(project_dir, "README.md")
    if os.path.exists(readme_path):
        print(f"Prepending changelog template to README.md: {readme_path}")
        with open(readme_path, "r", encoding="utf-8") as f:
            readme_content = f.read()
            
        # Build the changelog template
        changelog_template = (
            f"\n{new_ver} (Title)\n"
            "Features:\n"
            "- \n\n"
            "Bug Fixes:\n"
            "- \n"
        )
        
        # Insert after CHANGELOG: header
        header_marker = "CHANGELOG:"
        if header_marker in readme_content:
            idx = readme_content.index(header_marker) + len(header_marker)
            # Find the rest of the file and construct new contents
            # Ensure there is exactly one empty line between header and new changelog, and new changelog and old changelog
            after_header = readme_content[idx:].lstrip()
            new_readme = readme_content[:idx] + "\n\n" + changelog_template.strip() + "\n\n" + after_header
        else:
            # Fallback: prepend
            new_readme = header_marker + "\n\n" + changelog_template.strip() + "\n\n" + readme_content
            
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(new_readme)
    else:
        print("Warning: README.md not found. Skipping changelog update.")
        
    # 4. Automate git snapshot commit
    print("\nRunning git snapshot commit...")
    try:
        # Check if git is a repository
        git_check = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=project_dir, capture_output=True, text=True)
        if git_check.returncode == 0:
            subprocess.run(["git", "add", "."], cwd=project_dir, check=True)
            subprocess.run(["git", "commit", "-m", f"Snapshot before starting {new_ver}"], cwd=project_dir, check=True)
            print("Git commit successful.")
        else:
            print("Not inside a git repository. Skipping git commit.")
    except Exception as e:
        print(f"Warning: Git commit failed: {e}")
        
    print("\nVersion bump complete! You can now start working on the new version.")
    print("=" * 60)

if __name__ == "__main__":
    main()
