// ------------------------------------------------------------------
// IMPORTS
// ------------------------------------------------------------------

import promptSync from 'prompt-sync';
import puppeteer from "puppeteer";
import EPub from 'epub-gen'

// ------------------------------------------------------------------
// SERVICE FUNCTIONS
// ------------------------------------------------------------------

function userAlert() {
  console.log('Здравствуйте, это программа загрузки книг с сайта ranobelib.me')
  console.log('Пожалуйста, прочитайте информацию ниже.')
  console.log('\nВо время загрузки у Вас, несколько раз, будет открываться и закрываться окно браузера.')
  console.log('Пожалуйста, не беспокойтесь, так и должно быть.')
  console.log('Во время загрузки, пожалуйста, не трогайте окно браузера, это может привести к сбоям.')
}

function getBookURL() {
  const prompt = promptSync({ sigint: true });

  console.log("\nВведите, пожалуйста, адрес книги с сайта ranobelib.me");
  console.log("Пример адреса: https://ranobelib.me/sakurasou-no-pet-na-kanojo-novel")
  console.log('Пожалуйста, указывайте верный адрес, во избежания проблем с работой программы.')

  const URL = prompt();

  console.log(`\nСейчас начнется загрузка книги, по адресу: ${URL}`)

  return URL;
}

function delay(time) {
  return new Promise(function(resolve) {
    setTimeout(resolve, time)
  });
}

function checkPageStatus(status) {
  if (status !== 200)
    throw new Error(`Ошибка загрузки страницы. Код ошибки: ${status}`);
}

async function gotoPage(page, url) {
  const status = await page.goto(url, { timeout: 0 });
  checkPageStatus(status.status());
}

async function startBrowser() {
  const browser = await puppeteer.launch(
      {
        headless: false,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--ignore-certificate-errors',
          '--no-sandbox'
        ]
      }
  );

  const page = await browser.newPage();
  // await page.setViewport({
  //   width: 1280,
  //   height: 720,
  //   deviceScaleFactor: 1,
  // });


  return {browser, page};
}

async function closeBrowser(browser) {
  await browser.close();
}

async function getBookInfo() {
  const { browser, page } = await startBrowser();

  await gotoPage(page, PAGE_URL)

  // Паршу инфу по книге на ее главной странице
  const bookInfo = await page.evaluate(() => {
    const title = document.querySelector('div.media-name__body > div.media-name__main');
    const author = document.querySelector('div.media-info-list__item > div.media-info-list__value > a');
    const coverImg = document.querySelector('div.media-sidebar__cover.paper > img');

    return {
      title: title.innerText,
      author: author.innerText,
      cover: coverImg.src,
      // output: './books',
      lang: 'ru',
      tocTitle: 'Содержание',
      content: [] // [{title: "Chapter 1",data: "<div>..."}, {data: ""},...]
    }
  })

  await closeBrowser(browser);

  return bookInfo;
}

async function getChapters() {
  const { browser, page } = await startBrowser(PAGE_URL);

  await gotoPage(page, PAGE_URL);

  // Нахожу кнопку "Начать читать" или "Продолжить" и кликаю по ней
  const gotoBookButton =
      await page.waitForSelector(
          'div.media-sidebar__buttons.section > a.button.button_block.button_primary'
      );
  await gotoBookButton.click();

  // Это нужно чтобы обходить проверку на робота от cloudfire, но она не всегда вылазит, пока не разобрался с этим
  // await page.waitForSelector('#challenge-form');
  // await page.evaluate(() => {
  //   document.querySelector('#challenge-form').submit();
  // });

  // Нахожу кнопку открытия модалки с главами и кликаю по ней
  const chapterButton =
      await page.waitForSelector(
          'div.reader-header-actions > div.reader-header-action[data-reader-modal="chapters"][data-media-down="md"]'
      )
  // const chapterButton = await page.waitForSelector('div.reader-header-action[data-reader-modal="chapters"]')
  await chapterButton.click();

  // Собираю все главы с называниями в один массив
  // Со страницы книги, простым путем, это сделать не получится
  // Так как там lazyloading на главах
  // С прокруткой страницы в контейнер добавляются новые главы и убираются старые
  const chaptersWithTitles = await page.evaluate(() => {
    const data =
        document.querySelectorAll(
            'div.modal__body > a.menu__item.text-truncate'
        );

    // Массив с главами надо отзеркалить, так как он в обратном порядке
    return Array.from(data, (item, k) => ({ id: k, title: item.innerText, link: item.href })).reverse();
  });

  await closeBrowser(browser);

  return chaptersWithTitles;
}

async function getChapterContent(url) {
  const { browser, page } = await startBrowser();

  await gotoPage(page, url)

  // Получаю контент главы, переданной в функцию
  const bookContent = await page.evaluate(() => {
    const content = document.querySelector('div.reader-container.container.container_center')

    return content.innerHTML;
  });

  await closeBrowser(browser);

  return bookContent;
}

async function getAllBookContent(bookChapters) {
  const bookContent = [];

  // Прохожусь по всем главам, собираю с них весь контент и кладу его в один массив
  for (const chapter of bookChapters) {
    const content = await getChapterContent(chapter.link);

    await delay(2000)

    const cacheData = {
      data: content,
      id: chapter.id,
      title: chapter.title,
    }

    bookContent.push(cacheData);
  }

  // Сортирую главы по порядку
  // "b - a", помним, что главы у нас в обратном порядке были, изначально, а затем был reverse()
  bookContent.sort((a, b) => b - a);

  return bookContent;
}

function generateEpubFromData(bookData) {
 return new EPub(bookData, bookData.output);
}

// ------------------------------------------------------------------
// MAIN FUNCTION
// ------------------------------------------------------------------

userAlert();

const PAGE_URL = getBookURL()
const bookName = PAGE_URL.split('/').pop()
const outputBookPath = `./books/${bookName}.epub`;

(async () => {
  console.log('\nПолучение информации о книге...')
  await delay(1000)
  const bookInfo = await getBookInfo();

  console.log('\nПолучение списка глав...')
  await delay(1000)
  const chapters = await getChapters();

  console.log('\nЗагрузка всех глав книги, поочередно...')
  await delay(1000)
  const bookContent = await getAllBookContent(chapters);

  const epubBookOptions = {
    ...bookInfo,
    content: [...bookContent],
    output: outputBookPath,
    verbose: true,
  }

  console.log(`\nГенерация книги ${bookName}.epub в папке books/\n`)
  await delay(1000)
  await generateEpubFromData(epubBookOptions)
  console.log('\nКнига успешно добавлена в папку book/')
  console.log('\nПриятного чтения!')
})()