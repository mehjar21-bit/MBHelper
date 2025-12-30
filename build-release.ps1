# Скрипт для создания релиза MangaBuff Helper v3.0.5

$version = "3.0.5"
$releaseName = "MangaBuff-Helper-v$version"
$releaseDir = ".\release"
$zipPath = ".\$releaseName.zip"

Write-Host "Building MangaBuff Helper v$version release..." -ForegroundColor Green

# Удаляем старые файлы релиза
if (Test-Path $releaseDir) {
    Remove-Item $releaseDir -Recurse -Force
}
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

# Создаем директорию для релиза
New-Item -ItemType Directory -Path $releaseDir | Out-Null

# Копируем необходимые файлы
Write-Host "Copying files..." -ForegroundColor Cyan

$filesToCopy = @(
    "manifest.json",
    "background.js",
    "api.js",
    "cardProcessor.js",
    "config.js",
    "contextHandlers.js",
    "domUtils.js",
    "interface.html",
    "interface.js",
    "main.js",
    "observer.js",
    "settings.js",
    "styles.css",
    "styles-newyear.css",
    "sync.js",
    "utils.js",
    "README.md"
)

foreach ($file in $filesToCopy) {
    Copy-Item $file $releaseDir -Force
    Write-Host "  OK $file" -ForegroundColor Gray
}

# Копируем директории
Write-Host "Copying directories..." -ForegroundColor Cyan

Copy-Item "dist" $releaseDir -Recurse -Force
Write-Host "  OK dist/" -ForegroundColor Gray

Copy-Item "icons" $releaseDir -Recurse -Force
Write-Host "  OK icons/" -ForegroundColor Gray

# Создаем ZIP архив
Write-Host "Creating ZIP archive..." -ForegroundColor Cyan
Compress-Archive -Path "$releaseDir\*" -DestinationPath $zipPath -Force

# Получаем размер файла
$zipSize = (Get-Item $zipPath).Length
$zipSizeMB = [math]::Round($zipSize / 1MB, 2)

Write-Host ""
Write-Host "Release created successfully!" -ForegroundColor Green
Write-Host "File: $zipPath" -ForegroundColor Yellow
Write-Host "Size: $zipSizeMB MB" -ForegroundColor Yellow
Write-Host ""
Write-Host "Files included:" -ForegroundColor Cyan
Write-Host "   - Extension files JS HTML CSS" -ForegroundColor Gray
Write-Host "   - Manifest v3 configuration" -ForegroundColor Gray
Write-Host "   - Webpack bundles dist" -ForegroundColor Gray
Write-Host "   - Icons" -ForegroundColor Gray
Write-Host "   - README documentation" -ForegroundColor Gray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Magenta
Write-Host "   1. Go to https://github.com/mehjar21-bit/MBHelper/releases" -ForegroundColor White
Write-Host "   2. Click Create a new release" -ForegroundColor White
Write-Host "   3. Tag: v$version" -ForegroundColor White
Write-Host "   4. Title: MangaBuff Helper v$version - New Year Edition" -ForegroundColor White
Write-Host "   5. Upload: $zipPath" -ForegroundColor White
Write-Host ""

# Очищаем временную папку
Remove-Item $releaseDir -Recurse -Force
