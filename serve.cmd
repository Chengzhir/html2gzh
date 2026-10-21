@echo off
rem Drag an article folder or index.html onto this file, or run: serve.cmd [path] [--port N] [--no-open]
if not exist "%~dp0ui\dist\index.html" (
  echo Building the page for the first run...
  pushd "%~dp0" && call npm run build && popd
)
node "%~dp0server.ts" %*
if errorlevel 1 pause
