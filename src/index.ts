import type {Options as BookDataModel} from 'epub-gen'
import {$bookService, $commonService} from './services/index';
import * as path from "path";


$commonService.userAlert();

const PAGE_URL = $commonService.getBookURL()
const BOOK_NAME = PAGE_URL.split('/').pop()
const OUTPUT_BOOK_PATH = `${path.dirname(__filename)}/../books/${BOOK_NAME}.epub`;

(async () => {
  console.log('\nПолучение информации о книге...')

  await $commonService.delay(1000)
  const bookInfo = await $bookService.getBookInfo(PAGE_URL);

  console.log('\nПолучение списка глав...')

  await $commonService.delay(1000)
  const chapters = await $bookService.getChapters(PAGE_URL);

  console.log('\nЗагрузка всех глав книги, поочередно...')

  await $commonService.delay(1000)
  const bookContent = await $bookService.getAllBookContent(chapters);

  const epubBookOptions: BookDataModel = {
    ...bookInfo,
    content: [...bookContent],
    output: OUTPUT_BOOK_PATH,
    verbose: true,
  }

  console.log(`\nГенерация книги ${BOOK_NAME}.epub в папке books/\n`)

  await $commonService.delay(1000)
  const book = await $bookService.generateEpubFromData(epubBookOptions)

  console.log('\nКнига успешно добавлена в папку book/')
  console.log('\nПриятного чтения!')
  console.log(book);
})()