@echo off
rem Lets "run dev" work from cmd and PowerShell without changing the execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run.ps1" %*
