: << 'CMDBLOCK'
@echo off
REM Cross-platform fallback — delegates to run-hook.js
REM On Windows: cmd.exe runs this batch portion.
REM On Unix: the shell portion below runs directly.

if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

set "HOOK_DIR=%~dp0"
node "%HOOK_DIR%run-hook.js" %*
exit /b %ERRORLEVEL%
CMDBLOCK

# Unix fallback — delegates to run-hook.js
exec node "$(dirname "$0")/run-hook.js" "$@"
