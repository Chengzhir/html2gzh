@echo off
rem Drag an article folder or index.html onto this file, or run: serve.cmd [path] [--port N] [--no-open]
rem The page is built into ui\dist on first run and whenever its sources change.
node "%~dp0server.ts" %*
if errorlevel 1 pause
