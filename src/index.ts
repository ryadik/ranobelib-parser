import type {Options as BookDataModel} from 'epub-gen'
import {$bookService, $commonService} from './services/index';
import * as path from "path";
const prompt = require('prompt-sync')({ sigint: true });


$commonService.userAlert();

// Проверяем наличие сохраненных прогрессов
const progressFiles = $bookService.findProgressFiles();
let PAGE_URL: string = '';
let BOOK_NAME: string = '';
let BOOK_ID: string = '';
let bookInfo: any;
let allChapters: any[] = [];
let useProgress = false;

(async () => {
  // Если есть сохраненные прогрессы, предлагаем выбор
  if (progressFiles.length > 0) {
    console.log('\n💾 === НАЙДЕНЫ СОХРАНЕННЫЕ ПРОГРЕССЫ ===');
    console.log(`Найдено ${progressFiles.length} сохраненных сессий:\n`);
    
    progressFiles.forEach((progress, index) => {
      const data = progress.progressData;
      const date = new Date(data.timestamp);
      const dateStr = date.toLocaleString('ru-RU');
      console.log(`   ${index + 1}. ${progress.bookId}`);
      console.log(`      Загружено глав: ${data.completedCount}`);
      console.log(`      Дата: ${dateStr}`);
      if (data.url) {
        console.log(`      URL: ${data.url}`);
      }
      console.log('');
    });
    
    console.log('Выберите действие:');
    console.log('1. Продолжить загрузку (быстрое продолжение)');
    console.log('2. Начать новую загрузку');
    
    const choice = prompt('Ваш выбор (1-2): ');
    
    if (choice === '1' && progressFiles.length > 0) {
      // Выбираем первый прогресс (можно расширить для выбора конкретного)
      const selectedProgress = progressFiles[0];
      const progressData = selectedProgress.progressData;
      
      console.log(`\n✅ Продолжение загрузки: ${selectedProgress.bookId}`);
      console.log(`📚 Загружено глав: ${progressData.completedCount}`);
      
      if (progressData.url && progressData.allChapters) {
        // Полный быстрый режим - есть все данные
        console.log(`🔄 Быстрое продолжение - используем сохраненные данные...\n`);
        
        PAGE_URL = progressData.url;
        const BOOK_NAME_RAW = PAGE_URL.split('/').pop() || 'unknown-book';
        BOOK_NAME = BOOK_NAME_RAW.split('?')[0];
        BOOK_ID = selectedProgress.bookId;
        allChapters = progressData.allChapters;
        useProgress = true;
        
        // Получаем информацию о книге
        console.log('Получение информации о книге...');
        await $commonService.delay(1000);
        bookInfo = await $bookService.getBookInfo(PAGE_URL);
      } else {
        // Старый формат прогресса - нужно получить URL и список глав
        console.log(`⚠️ В сохраненном прогрессе нет URL или списка глав.`);
        console.log(`📝 Нужно ввести URL для продолжения загрузки.\n`);
        
        console.log('Введите URL книги для продолжения загрузки:');
        console.log('Пример: https://ranobelib.me/ru/book/165329--kusuriya-no-hitorigoto-ln-novel');
        const inputUrl = prompt('URL: ');
        
        if (!inputUrl || !inputUrl.trim()) {
          console.log('❌ URL не введен. Начинаем новую загрузку.');
          useProgress = false;
        } else {
          PAGE_URL = inputUrl.trim();
          const BOOK_NAME_RAW = PAGE_URL.split('/').pop() || 'unknown-book';
          BOOK_NAME = BOOK_NAME_RAW.split('?')[0];
          BOOK_ID = selectedProgress.bookId; // Используем ID из прогресса
          useProgress = true;
          
          console.log('\nПолучение информации о книге...');
          await $commonService.delay(1000);
          bookInfo = await $bookService.getBookInfo(PAGE_URL);
          
          console.log('\nПолучение списка глав...');
          await $commonService.delay(1000);
          allChapters = await $bookService.getChapters(PAGE_URL);
          
          console.log(`\n✅ Продолжаем загрузку с существующим прогрессом (${progressData.completedCount} глав уже загружено)`);
        }
      }
    } else {
      useProgress = false;
    }
  }
  
  // Если не используем прогресс, получаем данные заново
  if (!useProgress) {
    PAGE_URL = $commonService.getBookURL();
    // Очищаем URL от параметров и получаем только название книги
    const BOOK_NAME_RAW = PAGE_URL.split('/').pop() || 'unknown-book';
    BOOK_NAME = BOOK_NAME_RAW.split('?')[0]; // Удаляем все после знака ?
    BOOK_ID = BOOK_NAME; // Используем для идентификации в прогрессе
    
    console.log('\nПолучение информации о книге...');
    await $commonService.delay(1000);
    bookInfo = await $bookService.getBookInfo(PAGE_URL);
    
    console.log('\nПолучение списка глав...');
    await $commonService.delay(1000);
    allChapters = await $bookService.getChapters(PAGE_URL);
  }

  if (!useProgress) {
    console.log(`\n📚 Найдено ${allChapters.length} глав`);
  } else {
    console.log(`\n📚 Используем сохраненный список из ${allChapters.length} глав`);
  }
  
  // Даем пользователю выбрать тома для загрузки
  const selectionResult = $commonService.selectVolumesToDownload(allChapters);
  
  // Проверяем режим обработки
  const isVolumeByVolumeMode = Array.isArray(selectionResult) && selectionResult[0] === 'VOLUME_BY_VOLUME';
  const isNoImagesMode = Array.isArray(selectionResult) && selectionResult.includes('NO_IMAGES');
  
  // Извлекаем номера томов (убираем специальные маркеры)
  let selectedVolumes;
  if (Array.isArray(selectionResult)) {
    // Фильтруем специальные маркеры, но сохраняем -1 для тестового режима
    selectedVolumes = selectionResult.filter(item => 
      typeof item === 'number' || 
      (!isNaN(Number(item)) && item !== 'VOLUME_BY_VOLUME' && item !== 'NO_IMAGES')
    );
  } else {
    selectedVolumes = selectionResult;
  }
  
  const booksDir = path.dirname(__filename) + '/../books';
  
  // Показываем информацию о выбранных настройках
  console.log('\n🔧 === ВЫБРАННЫЕ НАСТРОЙКИ ===');
  if (isVolumeByVolumeMode) {
    console.log('📚 Режим: Тома по отдельности');
  } else {
    console.log('📚 Режим: Один файл');
  }
  
  if (isNoImagesMode) {
    console.log('🖼️ Изображения: БЕЗ изображений (стабильно)');
  } else {
    console.log('🖼️ Изображения: С изображениями (fallback при ошибках)');
  }
  console.log('========================\n');
  
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
    const createdFiles = await $bookService.processVolumesByOne(chaptersToDownload, BOOK_ID, bookInfo, booksDir, isNoImagesMode);
    
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
    const result = await $bookService.getAllBookContent(chaptersToDownload, BOOK_ID, PAGE_URL, allChapters);
    
    // Проверяем, есть ли ошибки 429
    const hasRateLimitErrors = (result as any).hasRateLimitErrors || false;
    const rateLimitErrorCount = (result as any).rateLimitErrorCount || 0;
    const bookContent = (result as any).content || result; // Поддержка старого формата
    
    // Если были ошибки 429, не создаем книгу и не удаляем прогресс
    if (hasRateLimitErrors) {
        console.log('\n⚠️ === ОБНАРУЖЕНЫ ОШИБКИ 429 (Too Many Requests) ===');
        console.log(`❌ Не удалось загрузить ${rateLimitErrorCount} глав из-за ограничения запросов сервером.`);
        console.log(`💾 Прогресс сохранен. Загружено глав: ${bookContent.length} из ${chaptersToDownload.length}`);
        console.log(`\n💡 РЕКОМЕНДАЦИЯ:`);
        console.log(`   Запустите программу снова через некоторое время.`);
        console.log(`   Программа автоматически продолжит загрузку с незагруженных глав.`);
        console.log(`   Прогресс не будет потерян.`);
        console.log(`\n🔚 Завершение работы без создания книги...`);
        process.exit(0);
    }
    
    // Проверяем, что все главы загружены
    if (bookContent.length < chaptersToDownload.length) {
        const missingChapters = chaptersToDownload.length - bookContent.length;
        console.log(`\n⚠️ ВНИМАНИЕ: Загружено только ${bookContent.length} из ${chaptersToDownload.length} глав.`);
        console.log(`   Отсутствует ${missingChapters} глав.`);
        console.log(`\n💡 РЕКОМЕНДАЦИЯ:`);
        console.log(`   Запустите программу снова, чтобы загрузить оставшиеся главы.`);
        console.log(`   Прогресс сохранен и будет использован при следующем запуске.`);
        console.log(`\n❓ Создать книгу с неполным содержимым? (y/n)`);
        
        const answer = prompt('');
        
        if (answer?.toLowerCase() !== 'y' && answer?.toLowerCase() !== 'yes' && answer?.toLowerCase() !== 'да') {
            console.log(`\n🔚 Завершение работы без создания книги...`);
            process.exit(0);
        }
    }

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

    // Сортируем главы по ID (который соответствует порядку в исходном списке)
    bookContent.sort((a: any, b: any) => a.id - b.id);
    
    const epubBookOptions: BookDataModel = {
      ...bookInfo,
      content: bookContent,
      output: OUTPUT_BOOK_PATH,
      verbose: true,
    }

    console.log(`\nГенерация книги ${outputFileName}.epub в папке books/\n`)

    await $commonService.delay(1000)
    
    try {
      // Если выбран режим без изображений, используем специальный метод
      if (isNoImagesMode) {
        console.log('🚫 Создаем EPUB БЕЗ изображений (выбрано пользователем)');
        const book = await $bookService.generateEpubFromDataNoImages(epubBookOptions)
      } else {
        const book = await $bookService.generateEpubFromData(epubBookOptions)
      }
      
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
    
    // Очищаем файл прогресса только если все главы успешно загружены
    if (bookContent.length === chaptersToDownload.length) {
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
    } else {
      console.log(`\n💾 Файл прогресса сохранен (загружено ${bookContent.length} из ${chaptersToDownload.length} глав)`);
      console.log(`   При следующем запуске программа продолжит с незагруженных глав.`);
    }
  }
  
  // Завершаем процесс
  console.log('🔚 Завершение работы...');
  process.exit(0);
})().catch((error) => {
  console.error('\n❌ Критическая ошибка:', error instanceof Error ? error.message : error);
  process.exit(1);
});