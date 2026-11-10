@echo off
setlocal
chcp 65001 >nul
set "SRC=%~dp0"
set "DST=%USERPROFILE%\Desktop\cet4-flashcards"

if not exist "%DST%" mkdir "%DST%"
if not exist "%DST%\css" mkdir "%DST%\css"
if not exist "%DST%\js" mkdir "%DST%\js"
if not exist "%DST%\tools" mkdir "%DST%\tools"
if not exist "%DST%\tests" mkdir "%DST%\tests"

echo Copying updated v2.3 files to "%DST%" ...
robocopy "%SRC%" "%DST%" index.html cet4-flashcards.html README.md package.json 更新到桌面.cmd /NJH /NJS /NP /R:2 /W:1 >nul
robocopy "%SRC%css" "%DST%\css" styles.css /NJH /NJS /NP /R:2 /W:1 >nul
robocopy "%SRC%js" "%DST%\js" app.js core.js data-a.js data-b.js /NJH /NJS /NP /R:2 /W:1 >nul
robocopy "%SRC%tools" "%DST%\tools" check-ui.js check-quiz.js validate-data.js build-single.js enrich_vocab.py expand_phrases.py DATA_SPEC.md idioms.json /NJH /NJS /NP /R:2 /W:1 >nul
robocopy "%SRC%tests" "%DST%\tests" core.test.js /NJH /NJS /NP /R:2 /W:1 >nul

if exist "%SRC%..\cet4-flashcards-v2.3-mobile.zip" (
  copy /Y "%SRC%..\cet4-flashcards-v2.3-mobile.zip" "%USERPROFILE%\Desktop\" >nul
  echo Also copied cet4-flashcards-v2.3-mobile.zip to Desktop.
)

echo.
echo Done. The Desktop folder now uses v2.3 files.
echo Open cet4-flashcards.html (single file) or index.html (multi-file).
echo.
pause >nul
