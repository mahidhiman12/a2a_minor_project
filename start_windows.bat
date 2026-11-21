@echo off
rem Starts every backend agent: start_windows.bat [--reset] [--with-sanitation]
cd /d %~dp0backend
python run_all.py %*
pause
