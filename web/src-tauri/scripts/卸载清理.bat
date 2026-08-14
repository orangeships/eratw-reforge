@echo off
echo ============================================
echo   eraTW Mod Studio - 卸载清理工具
echo   内部分享版 (含口上正文)
echo ============================================
echo.

set "APP_DIR=%APPDATA%\studio.eratw.modstudio"
set "LOCAL_DIR=%LOCALAPPDATA%\studio.eratw.modstudio"

echo 将要删除以下数据目录(存档、设置、缓存):
echo   %APP_DIR%
echo   %LOCAL_DIR%
echo.
echo 注意: 这会把玩家存档一并删除, 无法恢复!
echo.

set /p CONFIRM="输入 Y 确认删除, 其他任意键取消: "
if /i not "%CONFIRM%"=="Y" (
    echo.
    echo 已取消, 没有删除任何文件。
    pause
    exit /b 0
)

echo.
echo 正在删除存档/设置目录...
if exist "%APP_DIR%" (
    rmdir /s /q "%APP_DIR%"
    echo   [已删] %APP_DIR%
) else (
    echo   [不存在] %APP_DIR%
)

echo 正在删除 WebView2 缓存目录...
if exist "%LOCAL_DIR%" (
    rmdir /s /q "%LOCAL_DIR%"
    echo   [已删] %LOCAL_DIR%
) else (
    echo   [不存在] %LOCAL_DIR%
)

echo.
echo 清理完成。感谢试玩!
echo (此 bat 脚本需手动删除)
pause
