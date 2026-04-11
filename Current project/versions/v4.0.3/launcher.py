"""
Money Megaboard — Desktop Launcher (v4.0.0+)
=============================================
Lightweight launcher that opens the Money Megaboard Flask app in a native
desktop window via PyWebView.  This file is OS-agnostic and works on both
macOS and Windows.

Usage (dev mode):
    shared/venv/bin/python versions/v4.0.3/launcher.py
"""
import os
import sys
import threading
import socket

# ---------------------------------------------------------------------------
# Resolve paths relative to THIS file so it works from any working directory
# ---------------------------------------------------------------------------
VERSION_DIR = os.path.dirname(os.path.abspath(__file__))

# Ensure the version folder is on sys.path so app.py can be imported
if VERSION_DIR not in sys.path:
    sys.path.insert(0, VERSION_DIR)


def find_free_port():
    """Find an available port to avoid conflicts."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_flask(app, port):
    """Run the Flask dev server in a background thread."""
    app.run(
        host="127.0.0.1",
        port=port,
        debug=False,
        use_reloader=False,   # reloader spawns a child — breaks PyWebView
    )


def main():
    # Import webview BEFORE changing cwd — its base_uri() resolves at import
    import webview
    import time

    # Set cwd to the version folder so Flask finds templates/ and static/
    os.chdir(VERSION_DIR)

    # Import the Flask app from this version's app.py
    import app as version_module
    flask_app = version_module.app

    # Make sure Flask knows where templates and static files live
    flask_app.template_folder = os.path.join(VERSION_DIR, "templates")
    flask_app.static_folder = os.path.join(VERSION_DIR, "static")

    # Pick a port
    port = find_free_port()

    # Start Flask in a background thread
    server_thread = threading.Thread(
        target=start_flask,
        args=(flask_app, port),
        daemon=True,
    )
    server_thread.start()

    # Give Flask a moment to bind
    time.sleep(0.5)

    # Open the native desktop window
    window = webview.create_window(
        title="Money Megaboard",
        url=f"http://127.0.0.1:{port}",
        width=1400,
        height=900,
        min_size=(900, 600),
    )
    webview.start()   # blocks until window is closed

    # When the window closes, perform cleanup of sensitive generated files
    downloads_dir = os.path.join(VERSION_DIR, "static", "downloads")
    try:
        import glob
        for f in glob.glob(os.path.join(downloads_dir, "*.csv")):
            os.remove(f)
    except Exception:
        pass

    # Exit cleanly
    sys.exit(0)


if __name__ == "__main__":
    main()
