use AppleScript version "2.4"
use scripting additions

set app_path to POSIX path of (path to me)
set project_dir to POSIX path of (container of (path to me))

set shellCode to "
APP_DIR=\"$1\"
PYTHON=\"$APP_DIR/shared/venv/bin/python3\"

if [ ! -f \"$PYTHON\" ]; then
    osascript -e 'display dialog \"Python venv not found. Please set up the virtual environment first.\" with title \"Money Megaboard\" buttons {\"OK\"} default button \"OK\" with icon stop'
    exit 1
fi

VERSIONS_DIR=\"$APP_DIR/versions\"
ACTIVE_FILE=\"$APP_DIR/shared/active_version.txt\"
RESTART_FLAG=\"$APP_DIR/shared/restart_flag\"

cleanup_downloads() {
    if [ ! -d \"$VERSIONS_DIR\" ]; then
        return
    fi

    for dir in \"$VERSIONS_DIR\"/v*/static/downloads; do
        if [ -d \"$dir\" ]; then
            rm -rf \"$dir\"
        fi
    done
}

rm -f \"$RESTART_FLAG\"
cleanup_downloads

{
while true; do
    LATEST=\"\"

    if [ -f \"$ACTIVE_FILE\" ]; then
        READ_VER=$(cat \"$ACTIVE_FILE\")
        if [ -f \"$VERSIONS_DIR/$READ_VER/launcher.py\" ]; then
            LATEST=\"$VERSIONS_DIR/$READ_VER\"
        fi
    fi

    if [ -z \"$LATEST\" ]; then
        for dir in \"$VERSIONS_DIR\"/v*/; do
            if [ -f \"${dir}launcher.py\" ]; then
                LATEST=\"${dir%/}\"
            fi
        done
        if [ -n \"$LATEST\" ]; then
            mkdir -p \"$APP_DIR/shared\"
            basename \"$LATEST\" > \"$ACTIVE_FILE\"
        fi
    fi

    if [ -z \"$LATEST\" ]; then
        osascript -e 'display dialog \"No valid version found in versions/ folder.\" with title \"Money Megaboard\" buttons {\"OK\"} default button \"OK\" with icon stop'
        exit 1
    fi

    \"$PYTHON\" \"$LATEST/launcher.py\" > /dev/null 2>&1
    cleanup_downloads

    if [ -f \"$RESTART_FLAG\" ]; then
        rm -f \"$RESTART_FLAG\"
    else
        rm -f \"$ACTIVE_FILE\"
        break
    fi
done
} &
"

set launch_result to «event sysoexec» ("/bin/bash -c " & quoted form of shellCode & " _ " & quoted form of project_dir)
