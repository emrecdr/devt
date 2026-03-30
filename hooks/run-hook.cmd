: << 'CMDBLOCK'
@echo off
REM Cross-platform polyglot wrapper for devt hook scripts.
REM On Windows: cmd.exe runs the batch portion, which finds and calls bash.
REM On Unix: the shell interprets this as a script (: is a no-op in bash).
REM
REM Usage: run-hook.cmd <script-name> [args...]

if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

set "HOOK_DIR=%~dp0"

REM Try Git for Windows bash in standard locations
if exist "C:\Program Files\Git\bin\bash.exe" (
    "C:\Program Files\Git\bin\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
if exist "C:\Program Files (x86)\Git\bin\bash.exe" (
    "C:\Program Files (x86)\Git\bin\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)

REM Try bash on PATH (e.g. user-installed Git Bash, MSYS2, Cygwin)
where bash >nul 2>nul
if %ERRORLEVEL% equ 0 (
    bash "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)

REM No bash found — exit silently (plugin still works, hooks just won't fire)
exit /b 0
CMDBLOCK

# Unix: resolve script dir safely, then exec the named script
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
if [ -z "$SCRIPT_NAME" ]; then
  echo '{"error": "No hook script specified"}' >&2
  exit 1
fi
shift
RESOLVED="${SCRIPT_DIR}/${SCRIPT_NAME}"
if [ ! -f "$RESOLVED" ]; then
  echo "{\"error\": \"Hook script not found: ${SCRIPT_NAME}\"}" >&2
  exit 1
fi
exec bash "$RESOLVED" "$@"
