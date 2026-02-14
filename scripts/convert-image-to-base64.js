// Скрипт для конвертации JPG в Base64 для CSS
// Использование: node convert-image-to-base64.js path/to/image.jpg

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('❌ Использование: node convert-image-to-base64.js path/to/image.jpg');
  process.exit(1);
}

const imagePath = args[0];

if (!fs.existsSync(imagePath)) {
  console.error(`❌ Файл не найден: ${imagePath}`);
  process.exit(1);
}

const ext = path.extname(imagePath).toLowerCase();
const mimeTypes = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

const mimeType = mimeTypes[ext];
if (!mimeType) {
  console.error(`❌ Неподдерживаемый формат: ${ext}`);
  console.error('Поддерживаются: .jpg, .jpeg, .png, .gif, .webp');
  process.exit(1);
}

try {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${base64}`;
  
  const sizeKB = (imageBuffer.length / 1024).toFixed(2);
  const base64SizeKB = (dataUri.length / 1024).toFixed(2);
  
  console.log('');
  console.log('✅ Конвертация завершена!');
  console.log('');
  console.log(`📊 Размер оригинала: ${sizeKB} KB`);
  console.log(`📊 Размер Base64: ${base64SizeKB} KB`);
  console.log('');
  
  if (base64SizeKB > 200) {
    console.warn('⚠️  ВНИМАНИЕ: Размер больше 200KB! Рекомендуется оптимизировать изображение.');
    console.warn('   Используйте TinyJPG (https://tinyjpg.com/) или уменьшите разрешение.');
    console.log('');
  }
  
  console.log('📋 Скопируйте эту строку в CSS:');
  console.log('');
  console.log('background-image: url(\'' + dataUri + '\');');
  console.log('');
  
  // Сохраняем в файл для удобства
  const outputPath = path.join(path.dirname(imagePath), 'base64-output.txt');
  fs.writeFileSync(outputPath, `/* CSS для фонового изображения */\nbackground-image: url('${dataUri}');\nbackground-size: cover;\nbackground-position: center;\nbackground-repeat: no-repeat;\n`);
  
  console.log(`💾 Также сохранено в: ${outputPath}`);
  console.log('');
  
} catch (error) {
  console.error('❌ Ошибка при конвертации:', error.message);
  process.exit(1);
}
