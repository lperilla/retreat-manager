@echo off
rem Cartas del retiro: arrancar, parar, reiniciar, instalar...
rem
rem   start.cmd              arranca el panel en segundo plano (y MongoDB si hace falta)
rem   start.cmd --install    instala dependencias y prepara .env y data\participants.json
rem   start.cmd --stop       para el panel y MongoDB (los datos se conservan)
rem   start.cmd --restart    reinicia el panel
rem   start.cmd --status     muestra que esta en marcha
rem   start.cmd --logs       muestra el registro (--follow para seguirlo)
rem   start.cmd --auth       autoriza el acceso de solo lectura a Gmail
rem   start.cmd --demo       arranca con datos de demostracion
rem   start.cmd --help       todas las opciones
rem
rem Desde PowerShell: .\start.cmd --status
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js. Instala Node.js 22 o superior ^(https://nodejs.org/^) y vuelve a intentarlo. 1>&2
  exit /b 1
)
node "%~dp0scripts\manage.js" %*
exit /b %ERRORLEVEL%
