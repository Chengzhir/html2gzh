@echo off
rem Drag an article folder or index.html onto this file, or run: serve.cmd [path] [--port N] [--no-open]
node "%~dp0server.mjs" %*
if errorlevel 1 pause
