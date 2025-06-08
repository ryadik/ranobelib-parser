import type {Options as BookDataModel} from 'epub-gen'
import {$bookService, $commonService} from './services/index';
import * as path from "path";


$commonService.userAlert();

const PAGE_URL = $commonService.getBookURL()
// Очищаем URL от параметров и получаем только название книги
const BOOK_NAME_RAW = PAGE_URL.split('/').pop() || 'unknown-book'
const BOOK_NAME = BOOK_NAME_RAW.split('?')[0] // Удаляем все после знака ?
const BOOK_ID = BOOK_NAME; // Используем для идентификации в прогрессе

(async () => {
  console.log('\nПолучение информации о книге...')

  await $commonService.delay(1000)
  const bookInfo = await $bookService.getBookInfo(PAGE_URL);

  console.log('\nПолучение списка глав...')

  await $commonService.delay(1000)
  const allChapters = await $bookService.getChapters(PAGE_URL);

  console.log(`\n📚 Найдено ${allChapters.length} глав`);
  
  // Даем пользователю выбрать тома для загрузки
  const selectionResult = $commonService.selectVolumesToDownload(allChapters);
  
  // Проверяем режим обработки
  const isVolumeByVolumeMode = Array.isArray(selectionResult) && selectionResult[0] === 'VOLUME_BY_VOLUME';
  const selectedVolumes = isVolumeByVolumeMode ? selectionResult.slice(1) : selectionResult;
  
  const booksDir = path.dirname(__filename) + '/../books';
  
  if (isVolumeByVolumeMode) {
    console.log('\n🔥 === РЕЖИМ ОБРАБОТКИ ПО ТОМАМ ===');
    console.log('📚 Каждый том будет загружен и сохранен отдельно');
    console.log('💡 При ошибке потеряется только текущий том, а не всё');
    
    // Фильтруем главы по выбранным томам
    const chaptersToDownload = $bookService.filterChaptersByVolumes(allChapters, selectedVolumes);
    
    if (chaptersToDownload.length === 0) {
      console.log('❌ Не найдено глав для загрузки. Проверьте выбранные тома.');
      process.exit(1);
    }
    
    console.log(`\n📖 К загрузке: ${chaptersToDownload.length} глав в ${selectedVolumes.length} томах`);
    
    await $commonService.delay(1000);
    
    // Обрабатываем тома по одному
    const createdFiles = await $bookService.processVolumesByOne(chaptersToDownload, BOOK_ID, bookInfo, booksDir);
    
    if (createdFiles.length > 0) {
      console.log('\n🎉 === ИТОГОВЫЙ РЕЗУЛЬТАТ ===');
      console.log(`✅ Успешно создано: ${createdFiles.length} файлов EPUB`);
      console.log('📂 Список созданных файлов:');
      createdFiles.forEach((file, index) => {
        console.log(`   ${index + 1}. ${path.basename(file)}`);
      });
    } else {
      console.log('\n❌ Не удалось создать ни одного файла EPUB');
    }
    
  } else {
    // Обычный режим (для одного тома или тестирования)
    console.log('\n📖 === ОБЫЧНЫЙ РЕЖИМ ===');
    
    // Фильтруем главы по выбранным томам
    const chaptersToDownload = $bookService.filterChaptersByVolumes(allChapters, selectedVolumes);
    
    if (chaptersToDownload.length === 0) {
      console.log('❌ Не найдено глав для загрузки. Проверьте выбранные тома.');
      process.exit(1);
    }
    
    console.log(`\n📖 К загрузке: ${chaptersToDownload.length} глав`);
    
    // Показываем примеры выбранных глав
    if (chaptersToDownload.length > 0) {
      console.log(`   Первая глава: "${chaptersToDownload[0].title}"`);
      if (chaptersToDownload.length > 1) {
        console.log(`   Последняя глава: "${chaptersToDownload[chaptersToDownload.length - 1].title}"`);
      }
    }
    
    // Предупреждение о времени загрузки
    const estimatedMinutes = Math.ceil(chaptersToDownload.length * 0.5); // примерно 30 секунд на главу
    console.log(`\n⏱️ Примерное время загрузки: ${estimatedMinutes} минут`);
    console.log('💾 Прогресс будет автоматически сохраняться каждые 5 глав');
    console.log('🔄 При прерывании можно будет продолжить с того же места');

    console.log('\nЗагрузка глав книги...')

    await $commonService.delay(1000)
    const bookContent = await $bookService.getAllBookContent(chaptersToDownload, BOOK_ID);

    // Определяем имя файла с указанием выбранных томов
    let outputFileName = BOOK_NAME;
    if (selectedVolumes.length >= 1 && selectedVolumes[0] !== -1) {
      // Если выбраны конкретные тома
      if (selectedVolumes.length === 1) {
        outputFileName += `_том_${selectedVolumes[0]}`;
      } else if (selectedVolumes.length <= 3) {
        outputFileName += `_тома_${selectedVolumes.join('_')}`;
      } else {
        outputFileName += `_тома_${selectedVolumes[0]}-${selectedVolumes[selectedVolumes.length - 1]}`;
      }
    } else if (selectedVolumes.length === 2 && selectedVolumes[0] === -1) {
      // Если ограничено количество глав
      outputFileName += `_первые_${selectedVolumes[1]}_глав`;
    }
    
    const OUTPUT_BOOK_PATH = `${booksDir}/${outputFileName}.epub`;

    const epubBookOptions: BookDataModel = {
      ...bookInfo,
      content: [...bookContent],
      output: OUTPUT_BOOK_PATH,
      verbose: true,
    }

    console.log(`\nГенерация книги ${outputFileName}.epub в папке books/\n`)

    await $commonService.delay(1000)
    
    try {
      const book = await $bookService.generateEpubFromData(epubBookOptions)
      
      console.log('\n✅ Книга успешно создана!')
      console.log(`📂 Путь к файлу: ${OUTPUT_BOOK_PATH}`)
      console.log(`📊 Загружено глав: ${bookContent.length}`)
      
    } catch (epubError: any) {
      const errorMessage = epubError.message || epubError.toString();
      
      // Если ошибка связана с изображениями, пробуем без них
      if (errorMessage.toLowerCase().includes('econnreset') ||
          errorMessage.toLowerCase().includes('network') ||
          errorMessage.toLowerCase().includes('timeout') ||
          errorMessage.toLowerCase().includes('connection') ||
          errorMessage.toLowerCase().includes('aborted')) {
        
        console.log(`⚠️ Ошибка сети при генерации EPUB: ${errorMessage}`);
        console.log(`🔄 Пробуем создать EPUB без изображений...`);
        
        const fallbackPath = OUTPUT_BOOK_PATH.replace('.epub', '_без_изображений.epub');
        const fallbackOptions = { ...epubBookOptions, output: fallbackPath };
        
        await $bookService.generateEpubFromDataNoImages(fallbackOptions);
        
        console.log('\n✅ Книга успешно создана БЕЗ ИЗОБРАЖЕНИЙ!')
        console.log(`📂 Путь к файлу: ${fallbackPath}`)
        console.log(`📊 Загружено глав: ${bookContent.length}`)
        console.log(`💡 Изображения были удалены для стабильности`)
      } else {
        throw epubError; // Прокидываем не-сетевые ошибки дальше
      }
    }
    
    // Очищаем файл прогресса после успешного завершения
    try {
      const fs = require('fs');
      const progressFile = path.join(process.cwd(), 'progress', `${BOOK_ID}_progress.json`);
      if (fs.existsSync(progressFile)) {
        fs.unlinkSync(progressFile);
        console.log('🗑️ Файл прогресса очищен');
      }
    } catch (error) {
      console.log('⚠️ Не удалось очистить файл прогресса (не критично)');
    }
  }
})();