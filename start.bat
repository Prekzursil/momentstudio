@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "VENV=%ROOT%\.venv"

where python >nul 2>nul || (echo Python is required. && exit /b 1)
where npm >nul 2>nul || (echo npm is required. && exit /b 1)

if not exist "%VENV%\Scripts\python.exe" (
  python -m venv "%VENV%"
)
call "%VENV%\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r "%BACKEND%\requirements.txt"

if not exist "%FRONTEND%\node_modules" (
  pushd "%FRONTEND%"
  npm ci
  popd
)

if "%UVICORN_HOST%"=="" set "UVICORN_HOST=127.0.0.1"
if "%UVICORN_PORT%"=="" set "UVICORN_PORT=8000"

echo Starting backend on http://%UVICORN_HOST%:%UVICORN_PORT%
start "backend" cmd /k "cd /d %BACKEND% && \"%VENV%\Scripts\python.exe\" -m uvicorn app.main:app --host %UVICORN_HOST% --port %UVICORN_PORT% --reload"

echo Starting frontend dev server on http://localhost:4200
pushd "%FRONTEND%"
npm start
popd

endlocal
