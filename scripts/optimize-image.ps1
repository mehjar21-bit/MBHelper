# Скрипт для оптимизации и ресайза изображения для фона расширения
# Использование: .\optimize-image.ps1 path\to\image.png

param(
    [Parameter(Mandatory=$true)]
    [string]$InputPath,
    
    [int]$Width = 600,
    [int]$Height = 800,
    
    [int]$Quality = 85
)

if (-not (Test-Path $InputPath)) {
    Write-Host "❌ Файл не найден: $InputPath" -ForegroundColor Red
    exit 1
}

$outputDir = Split-Path $InputPath -Parent
$inputName = [System.IO.Path]::GetFileNameWithoutExtension($InputPath)
$outputPath = Join-Path $outputDir "${inputName}_optimized.jpg"

Write-Host ""
Write-Host "🖼️  Оптимизация изображения..." -ForegroundColor Cyan
Write-Host "   Исходный файл: $InputPath"
Write-Host "   Целевой размер: ${Width}×${Height}px"
Write-Host "   Качество JPG: $Quality%"
Write-Host ""

# Проверяем наличие .NET классов для работы с изображениями
try {
    Add-Type -AssemblyName System.Drawing
    
    $img = [System.Drawing.Image]::FromFile((Resolve-Path $InputPath))
    
    $originalWidth = $img.Width
    $originalHeight = $img.Height
    $originalSizeKB = [math]::Round((Get-Item $InputPath).Length / 1KB, 2)
    
    Write-Host "📊 Исходные параметры:" -ForegroundColor Yellow
    Write-Host "   Размер: ${originalWidth}×${originalHeight}px"
    Write-Host "   Вес: $originalSizeKB KB"
    Write-Host ""
    
    # Создаем новое изображение с нужными размерами
    $newImg = New-Object System.Drawing.Bitmap($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($newImg)
    
    # Настройки качества ресайза
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    # Рисуем изображение с новыми размерами
    $graphics.DrawImage($img, 0, 0, $Width, $Height)
    
    # Сохраняем как JPG с заданным качеством
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
        [System.Drawing.Imaging.Encoder]::Quality, 
        $Quality
    )
    
    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | 
        Where-Object { $_.MimeType -eq 'image/jpeg' } | 
        Select-Object -First 1
    
    $newImg.Save($outputPath, $jpegCodec, $encoderParams)
    
    # Очистка ресурсов
    $graphics.Dispose()
    $newImg.Dispose()
    $img.Dispose()
    
    $outputSizeKB = [math]::Round((Get-Item $outputPath).Length / 1KB, 2)
    $reduction = [math]::Round(($originalSizeKB - $outputSizeKB) / $originalSizeKB * 100, 1)
    
    Write-Host "✅ Оптимизация завершена!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Результат:" -ForegroundColor Yellow
    Write-Host "   Размер: ${Width}×${Height}px"
    Write-Host "   Вес: $outputSizeKB KB"
    Write-Host "   Уменьшение: $reduction%"
    Write-Host ""
    Write-Host "💾 Сохранено: $outputPath" -ForegroundColor Green
    Write-Host ""
    
    if ($outputSizeKB -gt 200) {
        Write-Host "⚠️  ВНИМАНИЕ: Размер всё ещё больше 200KB!" -ForegroundColor Yellow
        Write-Host "   Рекомендуется уменьшить качество до 70-80 или использовать TinyJPG" -ForegroundColor Yellow
        Write-Host "   https://tinyjpg.com/" -ForegroundColor Cyan
        Write-Host ""
    }
    
    Write-Host "📋 Следующий шаг:" -ForegroundColor Cyan
    Write-Host "   node scripts\convert-image-to-base64.js `"$outputPath`"" -ForegroundColor White
    Write-Host ""
    
} catch {
    Write-Host "❌ Ошибка при обработке: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Альтернатива: используйте онлайн-инструменты:" -ForegroundColor Yellow
    Write-Host "   1. Ресайз: https://imageresizer.com/ (600×800px)" -ForegroundColor Cyan
    Write-Host "   2. Оптимизация: https://tinyjpg.com/" -ForegroundColor Cyan
    Write-Host "   3. Затем запустите: node scripts\convert-image-to-base64.js your-image.jpg" -ForegroundColor White
    Write-Host ""
    exit 1
}
