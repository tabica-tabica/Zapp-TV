@echo off
rem Instalador do Zapp TV pra TV LG (Windows): duplo clique.
rem Chama o install-tv.ps1 da mesma pasta (duplo clique num .ps1 so abre o Bloco de Notas).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-tv.ps1" %*
pause
