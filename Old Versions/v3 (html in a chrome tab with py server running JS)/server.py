"""
Money Megaboard — Version Switcher Server
==========================================
Top-level launcher that serves any version from the versions/ directory.
The newest version (by semver) is loaded by default.

Usage:
    bash run.sh          (recommended — handles version switches automatically)
    shared/venv/bin/python server.py   (single run, no auto-restart on switch)
"""
import os
import re
import sys
import importlib
import importlib.util
from flask import Flask, request, jsonify

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VERSIONS_DIR = os.path.join(BASE_DIR, "versions")
ACTIVE_VERSION_FILE = os.path.join(BASE_DIR, ".active_version")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def semver_key(name):
    """Extract (major, minor, patch) tuple from a version folder name like 'v3.2.3'."""
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)$", name)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return (0, 0, 0)


VERSION_PATHS = {}

def discover_versions():
    """Return a list of valid version folder names sorted newest → oldest."""
    global VERSION_PATHS
    VERSION_PATHS.clear()
    versions = []
    
    for root, dirs, files in os.walk(VERSIONS_DIR):
        for d in dirs:
            if re.match(r"^v\d+\.\d+\.\d+$", d):
                full_path = os.path.join(root, d)
                if os.path.isfile(os.path.join(full_path, "app.py")):
                    versions.append(d)
                    VERSION_PATHS[d] = full_path
                    
    versions.sort(key=semver_key, reverse=True)
    return versions


def read_saved_version(versions):
    """Check for a saved version preference."""
    if os.path.isfile(ACTIVE_VERSION_FILE):
        with open(ACTIVE_VERSION_FILE) as f:
            saved = f.read().strip()
        if saved in versions:
            return saved
    return None


def load_version_app(version_name):
    """Import the Flask `app` object from versions/<version_name>/app.py."""
    version_dir = VERSION_PATHS.get(version_name)
    if not version_dir:
        raise RuntimeError(f"Could not resolve path for version {version_name}")
    app_path = os.path.join(version_dir, "app.py")

    # Make version dir the working directory so relative paths (DATA_FILE, etc.) work
    os.chdir(version_dir)

    # Unique module name to avoid collisions
    module_name = f"megaboard_{version_name.replace('.', '_')}"

    spec = importlib.util.spec_from_file_location(module_name, app_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)

    flask_app = getattr(mod, "app", None)
    if flask_app is None:
        raise RuntimeError(f"No `app` object found in {app_path}")

    # Tell Flask where the version's templates and static files live
    flask_app.template_folder = os.path.join(version_dir, "templates")
    flask_app.static_folder = os.path.join(version_dir, "static")

    return flask_app


# ---------------------------------------------------------------------------
# Build and configure
# ---------------------------------------------------------------------------

VERSIONS = discover_versions()
if not VERSIONS:
    print("ERROR: No valid version directories found in versions/")
    sys.exit(1)

# Determine which version to serve
ACTIVE_VERSION = read_saved_version(VERSIONS) or VERSIONS[0]

# Load the version's Flask app
version_app = load_version_app(ACTIVE_VERSION)


# Inject version data into every template render
@version_app.context_processor
def inject_versions():
    return dict(
        all_versions=VERSIONS,
        active_version=ACTIVE_VERSION,
    )


# Version switch endpoint — writes preference and exits with code 42
# so the run.sh wrapper knows to restart
@version_app.route("/api/switch-version", methods=["POST"])
def switch_version():
    data = request.get_json(silent=True) or {}
    target = request.form.get("version") or data.get("version", "")
    if target not in VERSIONS:
        return jsonify({"error": f"Unknown version: {target}"}), 400
    if target == ACTIVE_VERSION:
        return jsonify({"status": "already active", "version": target})

    # Save the preference
    with open(ACTIVE_VERSION_FILE, "w") as f:
        f.write(target)

    # Tell the client to wait a moment then reload
    # Then shut down the server so run.sh can restart it
    def shutdown():
        os._exit(42)

    import threading
    # Give Flask time to send the response before shutting down
    threading.Timer(0.3, shutdown).start()

    return jsonify({"status": "switching", "version": target})


@version_app.route("/api/versions", methods=["GET"])
def list_versions():
    return jsonify({"versions": VERSIONS, "active": ACTIVE_VERSION})


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"🚀 Money Megaboard — serving {ACTIVE_VERSION}")
    print(f"   Available versions: {', '.join(VERSIONS)}")
    version_app.run(debug=False, port=5050)
