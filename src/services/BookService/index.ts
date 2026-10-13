import EPub from 'epub-gen'
import type {Options as BookDataModel} from 'epub-gen'
import type {Page, Browser} from "puppeteer";
import type {BookServiceModel} from "../../models/book-service.model";
import type {BookInfoModel} from "../../models/book-info.model";
import type {BookChaptersModel} from "../../models/book-chapters.model";
import type {BookContentModel} from "../../models/book-content.model";
import {ErrorMsgModel} from "../../models/error-handler-service.model";
import {ErrorHandler} from "../ErrorHandler/index";
import {BrowserService} from "../BrowserService/index";
import {CommonService} from "../CommonService/index";
import {Config, Prompt} from "prompt-sync";
import * as fs from 'fs';
import * as path from 'path';

export class BookService implements BookServiceModel {
  constructor(
    private $errorService: ErrorHandler,
    private $browserService: BrowserService,
    private $commonService: CommonService,
    private $promptSync: (config?: Config) => Prompt
  ) {}

    public async getBookInfo(url: string): Promise<BookInfoModel> {
        // Retry механизм для обработки ошибок 429
        const maxRetries = 3;
        let currentTry = 1;
        let browser: any;
        let page: any;

        while (currentTry <= maxRetries) {
            try {
                const browserData = await this.$browserService.startBrowser();
                browser = browserData.browser;
                page = browserData.page;

                await this.$browserService.gotoPage(page, url);
                break; // Успешно загрузили страницу, выходим из цикла

            } catch (error: any) {
                const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
                const errorStatus = error.statusCode;
                const isRateLimitError = errorStatus === 429 || errorMessage.includes('429') || errorMessage.includes('too many requests');

                if (browser) {
                    try {
                        await this.$browserService.closeBrowser(browser);
                    } catch (closeError) {
                        // Игнорируем ошибки закрытия
                    }
                }

                if (isRateLimitError && currentTry < maxRetries) {
                    const delaySeconds = 30 * Math.pow(2, currentTry - 1);
                    console.log(`⏸️ Ошибка 429 при получении информации о книге. Ожидание ${delaySeconds} секунд...`);
                    await this.showCountdown(delaySeconds);
                    currentTry++;
                    continue;
                } else {
                    throw error;
                }
            }
        }

        // Паршу инфу по книге на ее главной странице
        const bookInfo = await page.evaluate(() => {
            const titleSelectors = [
                'h1.media-name__main',
                '.media-name__main',
                'div.media-name__body > div.media-name__main',
                'h1',
                '.title',
                '[data-media-name]'
            ];

            const authorSelectors = [
                '.media-info-list__value a',
                'div.media-info-list__item > div.media-info-list__value > a',
                '[data-media-author]',
                '.author a',
                '.media-info a'
            ];

            let title = '';
            let author = '';

            for (const selector of titleSelectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent?.trim()) {
                    title = element.textContent.trim();
                    break;
                }
            }

            for (const selector of authorSelectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent?.trim()) {
                    author = element.textContent.trim();
                    break;
                }
            }

            if (!title) {
                const pageTitle = document.title;
                if (pageTitle && pageTitle.includes('·')) {
                    const parts = pageTitle.split('·');
                    if (parts.length > 1) {
                        title = parts[1].trim().replace(' • RanobeLIB', '');
                    }
                }
            }

            if (!title) {
                title = 'Неизвестное название';
            }

            if (!author) {
                author = 'Неизвестный автор';
            }

            const coverImg: HTMLImageElement | null = document.querySelector('div.media-sidebar__cover.paper > img, .media-cover img, .cover img');
            const coverPlaceholder = 'https://aeroclub-issoire.fr/wp-content/uploads/2020/05/image-not-found.jpg'

            return {
                title: title,
                author: author,
                cover: coverImg?.src || coverPlaceholder,
                lang: 'ru',
                tocTitle: 'Содержание',
            }
        })

        await this.$browserService.closeBrowser(browser);

        return bookInfo;
    }

    public async getChapters(url: string): Promise<BookChaptersModel[]> {
        const { browser, page } = await this.$browserService.startBrowser();

        try {
            await this.$browserService.gotoPage(page, url);

            const pageContent = await page.evaluate(() => {
                const errorElements = document.querySelectorAll('h1, .error, .error-message');
                const bodyText = document.body.innerText.toLowerCase();
                const hasError = bodyText.includes('ошибка') || bodyText.includes('error') || bodyText.includes('код ошибки');

                return {
                    hasError,
                    errorText: Array.from(errorElements).map(el => el.textContent).join(' ')
                };
            });

            if (pageContent.hasError) {
                console.log(`⚠️ Обнаружена ошибка на странице: ${pageContent.errorText}`);
                console.log('Попробуем альтернативные способы доступа...');
            }
        } catch (error: any) {
            const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
            const errorStatus = error.statusCode;
            const isRateLimitError = errorStatus === 429 || errorMessage.includes('429') || errorMessage.includes('too many requests');

            if (isRateLimitError) {
                console.log(`⚠️ Ошибка 429 при проверке URL. Продолжаем с API...`);
            } else {
                console.log(`⚠️ Не удалось загрузить основной URL: ${error}`);
                console.log('Попробуем продолжить с API...');
            }
        }

        // Извлекаем ID книги из URL
        const urlWithoutParams = url.split('?')[0];
        let bookId: string;
        const bookIdMatch = urlWithoutParams.match(/\/book\/([^\/\?]+)/);
        if (!bookIdMatch) {
            const altMatch = urlWithoutParams.match(/\/(\d+[^\/\?]*)/);
            if (!altMatch) {
                await this.$browserService.closeBrowser(browser);
                this.$errorService.throwError(ErrorMsgModel.ELEMENT_COULD_NOT_BE_FOUND, 'ID книги в URL');
                return [];
            }
            bookId = altMatch[1];
        } else {
            bookId = bookIdMatch[1];
        }

        bookId = bookId.split('?')[0].split('&')[0];
        console.log(`Найден ID книги: ${bookId}`);

        const numericIdMatch = bookId.match(/^(\d+)/);
        const numericBookId = numericIdMatch ? numericIdMatch[1] : bookId;
        console.log(`Числовой ID для API: ${numericBookId}`);

        console.log('Переходим на страницу со списком всех глав...');

        const cleanUrl = url.split('?')[0].replace(/\/$/, '');
        const chapterPageUrl = cleanUrl + '?section=chapters';

        console.log(`Исходный URL: ${url}`);
        console.log(`Очищенный URL: ${cleanUrl}`);
        console.log(`Финальный URL для глав: ${chapterPageUrl}`);

        let chaptersWithTitles: BookChaptersModel[] = [];

        try {
            let pageLoaded = false;
            let retryCount = 0;
            const maxRetries = 3;

            while (!pageLoaded && retryCount < maxRetries) {
                try {
                    await this.$browserService.gotoPage(page, chapterPageUrl);
                    console.log(`Загружаем страницу: ${chapterPageUrl}`);
                    pageLoaded = true;
                } catch (error: any) {
                    const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
                    const errorStatus = error.statusCode;
                    const isRateLimitError = errorStatus === 429 || errorMessage.includes('429') || errorMessage.includes('too many requests');

                    if (isRateLimitError && retryCount < maxRetries - 1) {
                        retryCount++;
                        const delaySeconds = 30 * Math.pow(2, retryCount - 1);
                        console.log(`⏸️ Ошибка 429 при загрузке страницы глав. Ожидание ${delaySeconds} секунд...`);
                        await this.showCountdown(delaySeconds);
                        continue;
                    } else {
                        throw error;
                    }
                }
            }

            const actualUrl = await page.url();
            console.log(`Фактический URL в браузере: ${actualUrl}`);

            // Умное ожидание появления списка глав вместо фиксированной задержки
            try {
                await page.waitForSelector('a[href*="/read/"]', { timeout: 10000 });
            } catch (e) {
                console.log('⚠️ Не удалось дождаться появления ссылок на главы');
            }

            // Прокручиваем страницу вниз, чтобы загрузить все главы (если они подгружаются динамически)
            console.log('Прокручиваем страницу для загрузки всех глав...');
            try {
                await page.evaluate(async () => {
                    await new Promise<void>((resolve) => {
                        let lastHeight = document.body.scrollHeight;
                        let attempts = 0;
                        const maxAttempts = 20;

                        const scrollDown = () => {
                            window.scrollTo(0, document.body.scrollHeight);
                            attempts++;

                            setTimeout(() => {
                                const newHeight = document.body.scrollHeight;
                                if (newHeight === lastHeight || attempts >= maxAttempts) {
                                    resolve();
                                } else {
                                    lastHeight = newHeight;
                                    scrollDown();
                                }
                            }, 500);
                        };

                        scrollDown();
                    });
                });
                await new Promise(r => setTimeout(r, 1000));
                console.log('Прокрутка завершена');
            } catch (scrollError) {
                console.log(`⚠️ Ошибка при прокрутке: ${scrollError}`);
            }

            // Попробуем получить главы через API
            console.log('Попытка получить главы через API...');

            const numericIdMatch2 = bookId.match(/^(\d+)/);
            const numericBookId2 = numericIdMatch2 ? numericIdMatch2[1] : bookId;

            let apiUrl = `https://api.cdnlibs.org/api/manga/${numericBookId2}/chapters`;
            console.log(`API URL (числовой ID): ${apiUrl}`);

            const apiUrlFull = `https://api.cdnlibs.org/api/manga/${bookId}/chapters`;
            console.log(`API URL (полный ID): ${apiUrlFull}`);

            let chaptersData = await page.evaluate(async (apiUrl) => {
                try {
                    const response = await fetch(apiUrl, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    const data = await response.json();
                    return data;
                } catch (error) {
                    console.log('Ошибка API запроса:', error);
                    return null;
                }
            }, apiUrl);

            if (!chaptersData || !chaptersData.data || !Array.isArray(chaptersData.data) || chaptersData.data.length === 0) {
                console.log('Пробуем API с полным ID...');
                chaptersData = await page.evaluate(async (apiUrl) => {
                    try {
                        const response = await fetch(apiUrl, {
                            method: 'GET',
                            headers: {
                                'Accept': 'application/json',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        });
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }
                        const data = await response.json();
                        return data;
                    } catch (error) {
                        console.log('Ошибка API запроса:', error);
                        return null;
                    }
                }, apiUrlFull);
            }

            if (chaptersData && chaptersData.data && Array.isArray(chaptersData.data)) {
                console.log(`Получено ${chaptersData.data.length} глав через API`);

                chaptersWithTitles = chaptersData.data.map((chapter: any, index: number) => {
                    const baseUrl = cleanUrl.replace('/book/', '/');

                    let selectedBranch = chapter.branches[0];
                    if (chapter.branches.length > 1) {
                        selectedBranch = chapter.branches.reduce((prev: any, current: any) => {
                            return (prev.branch_id < current.branch_id) ? prev : current;
                        });
                    }

                    const chapterUrl = `${baseUrl}/read/v${chapter.volume}/c${chapter.number}?bid=${selectedBranch.branch_id}&ui=${selectedBranch.id}`;

                    let title = '';
                    if (chapter.name && chapter.name.trim()) {
                        title = `Том ${chapter.volume}, Глава ${chapter.number}: ${chapter.name}`;
                    } else {
                        title = `Том ${chapter.volume}, Глава ${chapter.number}`;
                    }

                    return {
                        id: index,
                        title: title,
                        link: chapterUrl
                    };
                });

                chaptersWithTitles.sort((a, b) => {
                    const parseChapter = (title: string) => {
                        const match = title.match(/Том (\d+), Глава ([0-9.]+)/);
                        if (match) {
                            const volume = parseInt(match[1]);
                            const chapter = parseFloat(match[2]);
                            return volume * 1000 + chapter;
                        }
                        return 0;
                    };

                    return parseChapter(a.title) - parseChapter(b.title);
                });

                chaptersWithTitles.forEach((chapter, index) => {
                    chapter.id = index;
                });

                console.log(`Обработано ${chaptersWithTitles.length} глав из API`);
            }

            if (chaptersWithTitles.length === 0) {
                console.log('API не вернул главы, пробуем парсить DOM...');

                chaptersWithTitles = await page.evaluate(() => {
                    let chapterLinks: NodeListOf<HTMLAnchorElement> = document.querySelectorAll('a[href*="/read/"]');

                    if (chapterLinks.length === 0) {
                        const alternativeSelectors = [
                            '.chapter-item a',
                            '.chapters-list a',
                            '.chapter-link',
                            '[data-chapter] a',
                            '.media-chapter a',
                            '.list-item a[href*="/read/"]'
                        ];

                        for (const selector of alternativeSelectors) {
                            chapterLinks = document.querySelectorAll(selector) as NodeListOf<HTMLAnchorElement>;
                            if (chapterLinks.length > 0) {
                                console.log(`Найдены главы по селектору: ${selector}`);
                                break;
                            }
                        }
                    }

                    const chapters = Array.from(chapterLinks, (link: HTMLAnchorElement, index) => {
                        let title = link.textContent?.trim() || link.innerText?.trim() || `Глава ${index + 1}`;
                        title = title.replace(/^\s*[-–—]\s*/, '').trim();

                        return {
                            id: index,
                            title: title,
                            link: link.href
                        };
                    }).filter(chapter => {
                        return chapter.link && chapter.link.includes('/read/') && chapter.title.length > 0;
                    });

                    chapters.sort((a, b) => {
                        const getVolumeChapter = (url: string) => {
                            const match = url.match(/\/v(\d+)\/c([0-9.]+)/);
                            if (match) {
                                const volume = parseInt(match[1]);
                                const chapter = parseFloat(match[2]);
                                return volume * 1000 + chapter;
                            }
                            return 0;
                        };

                        return getVolumeChapter(a.link) - getVolumeChapter(b.link);
                    });

                    chapters.forEach((chapter, index) => {
                        chapter.id = index;
                    });

                    return chapters;
                });

                console.log(`Найдено ${chaptersWithTitles.length} глав через DOM парсинг`);

                if (chaptersWithTitles.length > 0) {
                    const first = chaptersWithTitles[0];
                    const last = chaptersWithTitles[chaptersWithTitles.length - 1];
                    console.log(`Первая глава: "${first.title}"`);
                    console.log(`Последняя глава: "${last.title}"`);
                }
            }

        } catch (error) {
            console.log('Не удалось загрузить страницу ?section=chapters, пробуем на основной странице...');

            await this.$browserService.gotoPage(page, url);

            try {
                await page.waitForSelector('a[href*="/read/"]', { timeout: 10000 });

                chaptersWithTitles = await page.evaluate(() => {
                    const chapterLinks: NodeListOf<HTMLAnchorElement> = document.querySelectorAll('a[href*="/read/"]') as NodeListOf<HTMLAnchorElement>;

                    return Array.from(chapterLinks, (link: HTMLAnchorElement, index) => {
                        return {
                            id: index,
                            title: link.textContent?.trim() || `Глава ${index + 1}`,
                            link: link.href
                        };
                    }).filter(chapter => chapter.link.includes('/read/'));
                });

                console.log(`Найдено ${chaptersWithTitles.length} глав на основной странице`);
            } catch (e) {
                console.log('Не удалось найти главы и на основной странице');
            }
        }

        await this.$browserService.closeBrowser(browser);

        if (chaptersWithTitles.length === 0) {
            this.$errorService.throwError(ErrorMsgModel.ELEMENT_COULD_NOT_BE_FOUND, 'список глав книги');
        }

        return chaptersWithTitles;
    }

    // Вспомогательная функция для отображения обратного таймера
    private async showCountdown(seconds: number): Promise<void> {
        return new Promise((resolve) => {
            let remaining = seconds;

            process.stdout.write(`\r⏳ Ожидание: ${remaining} секунд...`);

            const interval = setInterval(() => {
                remaining--;

                if (remaining > 0) {
                    process.stdout.write(`\r⏳ Ожидание: ${remaining} секунд...`);
                } else {
                    process.stdout.write(`\r✅ Ожидание завершено!                    \n`);
                    clearInterval(interval);
                    resolve();
                }
            }, 1000);
        });
    }

    /**
     * ВАЖНО: теперь метод принимает уже созданный `page`, а не создаёт браузер сам.
     * Это ключевое изменение для ускорения загрузки.
     */
    private async getChapterContent(url: string, page: Page): Promise<string> {
        console.log(`Загружаем главу: ${url}`);

        // Retry механизм для обработки ошибок соединения
        const maxRetries = 3;
        let currentTry = 1;

        while (currentTry <= maxRetries) {
            try {
                await this.$browserService.gotoPage(page, url);

                // Умное ожидание появления контента главы вместо фиксированной задержки
                const contentSelectors = [
                    'main[data-reader-content]',
                    'main.l1_b[data-reader-content]',
                    '[data-reader-content]',
                    'div.reader-container.container.container_center',
                    '.reader-container',
                    '.chapter-content',
                    '.content',
                    '.reader-content',
                    'main .container',
                    '.text-content'
                ];

                // Пробуем дождаться первого доступного селектора
                let selectorFound = false;
                for (const selector of contentSelectors) {
                    try {
                        await page.waitForSelector(selector, { timeout: 5000 });
                        selectorFound = true;
                        break;
                    } catch (e) {
                        // Пробуем следующий селектор
                    }
                }

                if (!selectorFound) {
                    console.log('⚠️ Ни один из селекторов контента не появился за 5 секунд');
                }

                const getContentWithTimeout = async (timeout: number) => {
                    if (timeout > 0) {
                        await new Promise(r => setTimeout(r, timeout));
                    }

                    return await page.evaluate((selectors: string[]) => {
                        let content = null;
                        let usedSelector = '';

                        for (const selector of selectors) {
                            content = document.querySelector(selector);
                            if (content && content.innerHTML.trim().length > 0) {
                                usedSelector = selector;
                                break;
                            }
                        }

                        if (content) {
                            content.querySelectorAll('img').forEach((img) => img.src = img.src || '')
                            return {
                                content: content.innerHTML,
                                selector: usedSelector
                            };
                        }
                        else {
                            return null;
                        }
                    }, contentSelectors);
                };

                let bookContentResult = await getContentWithTimeout(0);

                if (!bookContentResult) {
                    console.log(`🔄 Содержимое не найдено, пробуем перезагрузить с большим таймаутом...`);

                    await page.reload({ waitUntil: 'networkidle2' });

                    console.log(`⏱️ Ожидаем 5 секунд для полной загрузки контента...`);
                    bookContentResult = await getContentWithTimeout(5000);
                }

                if (!bookContentResult) {
                    console.log(`🔄 Последняя попытка с таймаутом 10 секунд...`);

                    await page.reload({ waitUntil: 'networkidle0' });

                    bookContentResult = await getContentWithTimeout(10000);
                }

                // Проверяем результат и возвращаем
                if (!bookContentResult || !bookContentResult.content) {
                    console.log(`⚠️ Содержимое главы не найдено после всех попыток: ${url}`);
                    return '';
                }

                console.log(`✅ Контент найден по селектору: ${bookContentResult.selector}`);
                return bookContentResult.content;

            } catch (error) {
                console.log(`❌ Попытка ${currentTry}/${maxRetries} неудачна. Ошибка: ${error}`);

                const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
                const errorStatus = (error as any).statusCode;

                const isRateLimitError = errorStatus === 429 || errorMessage.includes('429') || errorMessage.includes('too many requests');

                const isConnectionError = errorMessage.includes('econnreset') ||
                                        errorMessage.includes('aborted') ||
                                        errorMessage.includes('timeout') ||
                                        errorMessage.includes('connection') ||
                                        errorMessage.includes('network');

                if (isRateLimitError && currentTry < maxRetries) {
                    const delaySeconds = 30 * Math.pow(2, currentTry - 1);
                    console.log(`⏸️ Ошибка 429 (Too Many Requests). Ожидание ${delaySeconds} секунд перед повторной попыткой...`);
                    console.log(`💡 Сервер ограничивает количество запросов. Пожалуйста, подождите.`);

                    await this.showCountdown(delaySeconds);

                    currentTry++;
                    continue;
                } else if (isConnectionError && currentTry < maxRetries) {
                    console.log(`🔄 Ошибка соединения. Повторная попытка через ${currentTry * 2} секунд...`);
                    await this.$commonService.delay(currentTry * 2000);
                    currentTry++;
                    continue;
                } else {
                    if (isRateLimitError) {
                        console.log(`❌ Превышен лимит запросов (429) после ${maxRetries} попыток. Попробуйте позже.`);
                        return 'RATE_LIMIT_ERROR';
                    } else {
                        console.log(`❌ Не удалось загрузить главу после ${maxRetries} попыток: ${url}`);
                    }
                    return '';
                }
            }
        }

        return '';
    }

    /**
     * ВАЖНО: метод теперь принимает `browser` и `page` снаружи.
     * Браузер создаётся один раз и переиспользуется для всех глав.
     */
    public async getAllBookContent(
        bookChapters: BookChaptersModel[],
        bookId: string,
        browser: Browser,
        page: Page,
        url?: string,
        allChapters?: BookChaptersModel[]
    ): Promise<BookContentModel[]> {
        const currentUrl = url || '';
        const chaptersToSave = allChapters || bookChapters;

        // Загружаем предыдущий прогресс если есть
        let bookContent = this.loadProgress(bookId);

        const completedChapterIds = new Set(bookContent.map(ch => ch.id));

        // Фильтруем только те главы, которые еще не загружены
        const remainingChapters = bookChapters.filter(ch => !completedChapterIds.has(ch.id));

        console.log(`\n📚 Общая статистика загрузки:`);
        console.log(`   Всего глав: ${bookChapters.length}`);
        console.log(`   Уже загружено: ${bookContent.length}`);
        console.log(`   Осталось загрузить: ${remainingChapters.length}`);

        if (remainingChapters.length === 0) {
            console.log('✅ Все главы уже загружены! Переходим к генерации EPUB...');
            return bookContent;
        }

        let successCount = bookContent.length;
        let errorCount = 0;
        let rateLimitErrorCount = 0;
        let totalSize = bookContent.reduce((sum, ch) => sum + ch.data.length, 0);
        const rateLimitChapters: BookChaptersModel[] = [];

        // Прохожусь по оставшимся главам
        for (let i = 0; i < remainingChapters.length; i++) {
            const chapter = remainingChapters[i];

            try {
                console.log(`\n📖 Загружаем главу ${successCount + 1}/${bookChapters.length}: "${chapter.title}"`);
                const content = await this.getChapterContent(chapter.link, page);

                if (content === 'RATE_LIMIT_ERROR') {
                    console.log(`⏸️ Глава "${chapter.title}" не загружена из-за ошибки 429 (Too Many Requests)`);
                    console.log(`💾 Добавляем в список для повторной попытки в конце.`);
                    errorCount++;
                    rateLimitErrorCount++;
                    rateLimitChapters.push(chapter);

                    this.saveProgress(bookId, bookContent, currentUrl, chaptersToSave);
                    console.log(`📊 Текущий прогресс: ${successCount}/${bookChapters.length} глав загружено`);

                    const baseDelay = 5000;
                    await this.$commonService.delay(baseDelay);
                    continue;
                }

                if (content && content.trim().length > 0) {
                    const cacheData: BookContentModel = {
                        data: content,
                        id: chapter.id,
                        title: chapter.title,
                    }

                    bookContent.push(cacheData);
                    successCount++;

                    const contentSize = content.length;
                    totalSize += contentSize;
                    const contentSizeKB = (contentSize / 1024).toFixed(1);
                    console.log(`✅ Глава загружена успешно (${contentSizeKB} КБ)`);
                } else {
                    console.log(`❌ Глава пустая или не загрузилась`);
                    errorCount++;
                }

                // Сохраняем прогресс каждые 10 глав (в фоне, не блокируя загрузку)
                if ((successCount) % 10 === 0) {
                    // Не ждём завершения записи, чтобы не тормозить процесс
                    this.saveProgress(bookId, bookContent, currentUrl, chaptersToSave).catch(err =>
                        console.log(`⚠️ Ошибка фонового сохранения прогресса: ${err}`)
                    );
                    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);
                    console.log(`\n📊 Прогресс: ${successCount}/${bookChapters.length} глав | Ошибок: ${errorCount} | Размер: ${totalSizeMB} МБ`);
                }

                // Уменьшенная задержка между запросами (браузер переиспользуется, поэтому можно быстрее)
                const baseDelay = 1500;
                const delay = errorCount > 0 ? baseDelay * (1 + errorCount * 0.5) : baseDelay;
                await this.$commonService.delay(delay);

            } catch (error) {
                console.log(`❌ Ошибка при загрузке главы "${chapter.title}": ${error}`);
                errorCount++;

                this.saveProgress(bookId, bookContent, currentUrl, chaptersToSave);
                console.log(`💾 Прогресс сохранен. При следующем запуске программа попробует загрузить эту главу снова.`);
            }
        }

        // Финальное сохранение прогресса
        this.saveProgress(bookId, bookContent, currentUrl, chaptersToSave);

        // Если есть главы с ошибками 429, пытаемся загрузить их еще раз
        if (rateLimitChapters.length > 0) {
            console.log(`\n🔄 === ПОВТОРНАЯ ПОПЫТКА ЗАГРУЗКИ ГЛАВ С ОШИБКОЙ 429 ===`);
            console.log(`📋 Найдено ${rateLimitChapters.length} глав для повторной загрузки`);
            console.log(`⏱️ Делаем паузу 10 секунд перед повторной попыткой...`);
            await this.$commonService.delay(10000);

            let retrySuccessCount = 0;
            let retryErrorCount = 0;

            for (let i = 0; i < rateLimitChapters.length; i++) {
                const chapter = rateLimitChapters[i];

                try {
                    console.log(`\n🔄 Повторная попытка ${i + 1}/${rateLimitChapters.length}: "${chapter.title}"`);
                    const content = await this.getChapterContent(chapter.link, page);

                    if (content === 'RATE_LIMIT_ERROR') {
                        console.log(`❌ Глава "${chapter.title}" все еще недоступна из-за ошибки 429`);
                        retryErrorCount++;
                        await this.$commonService.delay(5000);
                        continue;
                    }

                    if (content && content.trim().length > 0) {
                        const cacheData: BookContentModel = {
                            data: content,
                            id: chapter.id,
                            title: chapter.title,
                        }

                        bookContent.push(cacheData);
                        successCount++;
                        retrySuccessCount++;
                        totalSize += content.length;

                        const contentSizeKB = (content.length / 1024).toFixed(1);
                        console.log(`✅ Глава успешно загружена при повторной попытке (${contentSizeKB} КБ)`);

                        rateLimitChapters.splice(i, 1);
                        i--;

                        this.saveProgress(bookId, bookContent, currentUrl, chaptersToSave);
                    } else {
                        console.log(`❌ Глава пустая или не загрузилась при повторной попытке`);
                        retryErrorCount++;
                    }

                    await this.$commonService.delay(3000);

                } catch (error) {
                    console.log(`❌ Ошибка при повторной загрузке главы "${chapter.title}": ${error}`);
                    retryErrorCount++;
                    await this.$commonService.delay(3000);
                }
            }

            rateLimitErrorCount = rateLimitChapters.length;

            console.log(`\n📊 Статистика повторной попытки:`);
            console.log(`   ✅ Успешно загружено: ${retrySuccessCount}`);
            console.log(`   ❌ Все еще недоступно: ${retryErrorCount}`);

            if (rateLimitChapters.length > 0) {
                console.log(`\n⚠️ После повторной попытки осталось ${rateLimitChapters.length} глав с ошибкой 429`);
            }
        }

        this.saveProgress(bookId, bookContent, currentUrl, chaptersToSave);

        console.log(`\n📋 Итоговая статистика:`);
        console.log(`   Всего глав найдено: ${bookChapters.length}`);
        console.log(`   Успешно загружено: ${successCount}`);
        console.log(`   Ошибок: ${errorCount}`);
        if (rateLimitErrorCount > 0) {
            console.log(`   ⚠️ Ошибок 429 (Too Many Requests): ${rateLimitErrorCount}`);
            console.log(`   💡 Главы с ошибкой 429 не были добавлены в прогресс.`);
            console.log(`   💡 При следующем запуске программа попробует загрузить их снова.`);
        }
        console.log(`   Процент успеха: ${((successCount / bookChapters.length) * 100).toFixed(1)}%`);
        console.log(`   Общий размер контента: ${(totalSize / (1024 * 1024)).toFixed(1)} МБ`);

        if (rateLimitErrorCount > 0) {
            console.log(`\n💾 Прогресс сохранен. Запустите программу снова, чтобы загрузить оставшиеся главы.`);
        }

        bookContent.sort((a, b) => a.id - b.id);

        return {
            content: bookContent,
            hasRateLimitErrors: rateLimitErrorCount > 0,
            rateLimitErrorCount: rateLimitErrorCount,
            totalChapters: bookChapters.length,
            loadedChapters: successCount
        } as any;
    }

    public async generateEpubFromData(bookData: BookDataModel): Promise<any> {
        console.log(`📚 Генерация EPUB с изображениями...`);

        try {
            const processedBookData = this.preprocessImages(bookData);

            const originalListeners = {
                uncaughtException: process.listeners('uncaughtException'),
                unhandledRejection: process.listeners('unhandledRejection')
            };

            let globalErrorCaught = false;

            const globalErrorHandler = (error: any) => {
                const errorMessage = error.message || error.toString();
                if (errorMessage.toLowerCase().includes('econnreset') ||
                    errorMessage.toLowerCase().includes('aborted') ||
                    errorMessage.toLowerCase().includes('socket')) {
                    globalErrorCaught = true;
                    console.log(`🔥 Перехвачена глобальная ошибка: ${errorMessage}`);
                    return;
                }
            };

            process.on('uncaughtException', globalErrorHandler);
            process.on('unhandledRejection', globalErrorHandler);

            try {
                const epub = new EPub(processedBookData, processedBookData.output);

                const result = await Promise.race([
                    epub.promise,
                    new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Таймаут генерации EPUB с изображениями (3 минуты)')), 3 * 60 * 1000);
                    })
                ]);

                process.removeListener('uncaughtException', globalErrorHandler);
                process.removeListener('unhandledRejection', globalErrorHandler);

                console.log('✅ EPUB с изображениями успешно создан!');
                return result;

            } finally {
                process.removeListener('uncaughtException', globalErrorHandler);
                process.removeListener('unhandledRejection', globalErrorHandler);
            }

        } catch (error: any) {
            const errorMessage = error.message || error.toString();

            const isConnectionError = errorMessage.toLowerCase().includes('econnreset') ||
                                    errorMessage.toLowerCase().includes('network') ||
                                    errorMessage.toLowerCase().includes('timeout') ||
                                    errorMessage.toLowerCase().includes('connection') ||
                                    errorMessage.toLowerCase().includes('aborted') ||
                                    errorMessage.toLowerCase().includes('socket') ||
                                    errorMessage.toLowerCase().includes('fetch');

            if (isConnectionError) {
                console.log(`⚠️ Ошибка сети при генерации EPUB с изображениями: ${errorMessage}`);
                console.log(`🚫 Переходим на режим БЕЗ ИЗОБРАЖЕНИЙ...`);

                const fallbackPath = (bookData.output || 'book.epub').replace('.epub', '_без_изображений.epub');
                const fallbackData = { ...bookData, output: fallbackPath };

                return await this.generateEpubFromDataNoImages(fallbackData);
            } else {
                throw error;
            }
        }
    }

    private preprocessImages(bookData: BookDataModel): BookDataModel {
        console.log('🖼️ Предварительная обработка изображений...');

        let totalImages = 0;
        let removedImages = 0;
        let processedImages = 0;

        const processedContent = bookData.content.map((chapter: any) => {
            if (chapter.data && typeof chapter.data === 'string') {
                let processedData = chapter.data;

                const imgMatches = processedData.match(/<img[^>]*>/gi) || [];
                const chapterImages = imgMatches.length;
                totalImages += chapterImages;

                if (chapterImages > 0) {
                    console.log(`🖼️ Глава "${chapter.title}": найдено ${chapterImages} изображений`);

                    processedData = processedData.replace(/<img([^>]*?)>/gi, (match: string, attrs: string) => {
                        if (attrs.includes('src=""') ||
                            attrs.includes("src=''") ||
                            attrs.includes('src="undefined"') ||
                            attrs.includes('src="null"')) {
                            removedImages++;
                            console.log('🗑️ Удалено изображение с пустым/неверным src');
                            return '';
                        }

                        const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
                        if (srcMatch) {
                            const imageUrl = srcMatch[1];

                            if (!imageUrl ||
                                imageUrl.length < 10 ||
                                imageUrl.includes('undefined') ||
                                imageUrl.includes('null') ||
                                imageUrl.startsWith('data:') && imageUrl.length < 50) {
                                removedImages++;
                                console.log(`🗑️ Удалено проблемное изображение: ${imageUrl.substring(0, 50)}...`);
                                return '';
                            }

                            if (imageUrl.startsWith('http') && !imageUrl.includes('ranobelib.me')) {
                                processedImages++;
                                console.log(`🔄 Заменено внешнее изображение на заглушку`);
                                return `<div style="text-align: center; padding: 10px; border: 1px dashed #ccc; margin: 10px 0; color: #666;">
                                    📷 [Внешнее изображение удалено для стабильности]
                                </div>`;
                            }
                        }

                        let improvedAttrs = attrs;

                        if (!improvedAttrs.includes('alt=')) {
                            improvedAttrs += ' alt="Изображение из главы"';
                        }

                        if (!improvedAttrs.includes('loading=')) {
                            improvedAttrs += ' loading="lazy"';
                        }

                        if (!improvedAttrs.includes('style=') && !improvedAttrs.includes('width=')) {
                            improvedAttrs += ' style="max-width: 100%; height: auto;"';
                        }

                        processedImages++;
                        return `<img${improvedAttrs}>`;
                    });

                    processedData = processedData.replace(/<img([^>]*?)>/gi, (match: string) => {
                        return `<div class="image-container">
                            ${match}
                        </div>`;
                    });
                }

                return {
                    ...chapter,
                    data: processedData
                };
            }

            return chapter;
        });

        console.log(`📊 Статистика обработки изображений:`);
        console.log(`   Всего найдено: ${totalImages}`);
        console.log(`   Удалено проблемных: ${removedImages}`);
        console.log(`   Обработано: ${processedImages}`);
        console.log(`   Осталось: ${totalImages - removedImages}`);

        return {
            ...bookData,
            content: processedContent
        };
    }

    public async generateEpubFromDataNoImages(bookData: BookDataModel): Promise<any> {
        console.log('🚫 Генерация EPUB БЕЗ ИЗОБРАЖЕНИЙ (режим восстановления)');

        let removedImages = 0;

        const noImagesContent = bookData.content.map((chapter: any) => {
            if (chapter.data && typeof chapter.data === 'string') {
                let cleanData = chapter.data;

                const imgCount = (cleanData.match(/<img[^>]*>/gi) || []).length;
                removedImages += imgCount;

                cleanData = cleanData
                    .replace(/<img[^>]*>/gi, (match: string) => {
                        const altMatch = match.match(/alt\s*=\s*["']([^"']+)["']/i);
                        const altText = altMatch ? altMatch[1] : 'Изображение';
                        return `<div style="text-align: center; padding: 5px; margin: 5px 0; color: #888; font-size: 12px; font-style: italic;">📷 [${altText}]</div>`;
                    })
                    .replace(/<figure[^>]*>.*?<\/figure>/gis, '<div style="text-align: center; padding: 5px; margin: 5px 0; color: #888; font-size: 12px;">📷 [Изображение удалено]</div>')
                    .replace(/src\s*=\s*["'][^"']*\.(jpg|jpeg|png|gif|webp|svg)["']/gi, 'src=""')
                    .replace(/<div[^>]*class[^>]*image[^>]*>.*?<\/div>/gis, '<div style="text-align: center; padding: 5px; margin: 5px 0; color: #888; font-size: 12px;">📷 [Изображение удалено]</div>')
                    .replace(/src\s*=\s*["']["']/gi, '')
                    .replace(/href\s*=\s*["'][^"']*\.(jpg|jpeg|png|gif|webp|svg)["']/gi, 'href="#"');

                if (imgCount > 0) {
                    console.log(`🗑️ Удалено ${imgCount} изображений из главы "${chapter.title}"`);
                }

                return {
                    ...chapter,
                    data: cleanData
                };
            }
            return chapter;
        });

        console.log(`📊 Всего удалено изображений: ${removedImages}`);

        const noImagesBookData = {
            ...bookData,
            content: noImagesContent,
            css: `
                img { display: none !important; }
                figure { display: none !important; }
                .image-container { display: none !important; }
                body { font-family: serif; line-height: 1.6; }
                p { margin: 1em 0; }
            `
        };

        return new Promise((resolve, reject) => {
            try {
                const epub = new EPub(noImagesBookData, noImagesBookData.output);

                const timeout = setTimeout(() => {
                    reject(new Error('Таймаут генерации EPUB без изображений (2 минуты)'));
                }, 2 * 60 * 1000);

                epub.promise.then((result: any) => {
                    clearTimeout(timeout);
                    console.log('✅ EPUB без изображений успешно создан!');
                    resolve(result);
                }).catch((error: any) => {
                    clearTimeout(timeout);
                    console.log(`❌ Ошибка даже без изображений: ${error}`);
                    reject(error);
                });

            } catch (syncError) {
                console.log(`💥 Критическая ошибка: ${syncError}`);
                reject(syncError);
            }
        });
    }

    // Метод для сохранения прогресса (теперь асинхронный для неблокирующей записи)
    private async saveProgress(bookId: string, completedChapters: BookContentModel[], url?: string, allChapters?: BookChaptersModel[]): Promise<void> {
        try {
            const progressDir = path.join(process.cwd(), 'progress');
            if (!fs.existsSync(progressDir)) {
                fs.mkdirSync(progressDir, { recursive: true });
            }

            const progressFile = path.join(progressDir, `${bookId}_progress.json`);
            const progressData: any = {
                timestamp: new Date().toISOString(),
                completedCount: completedChapters.length,
                chapters: completedChapters
            };

            if (url) {
                progressData.url = url;
            }
            if (allChapters) {
                progressData.allChapters = allChapters;
            }

            // Асинхронная запись, чтобы не блокировать основной поток
            await fs.promises.writeFile(progressFile, JSON.stringify(progressData, null, 2));
            console.log(`💾 Прогресс сохранен: ${completedChapters.length} глав`);
        } catch (error) {
            console.log(`⚠️ Не удалось сохранить прогресс: ${error}`);
        }
    }

    public findProgressFiles(): Array<{bookId: string, filePath: string, progressData: any}> {
        const progressFiles: Array<{bookId: string, filePath: string, progressData: any}> = [];
        try {
            const progressDir = path.join(process.cwd(), 'progress');
            if (!fs.existsSync(progressDir)) {
                return progressFiles;
            }

            const files = fs.readdirSync(progressDir);
            for (const file of files) {
                if (file.endsWith('_progress.json') && !file.includes('_том_')) {
                    const filePath = path.join(progressDir, file);
                    try {
                        const progressData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        const bookId = file.replace('_progress.json', '');
                        progressFiles.push({ bookId, filePath, progressData });
                    } catch (error) {
                        // Игнорируем поврежденные файлы
                    }
                }
            }
        } catch (error) {
            console.log(`⚠️ Ошибка при поиске файлов прогресса: ${error}`);
        }
        return progressFiles;
    }

    private loadProgress(bookId: string): BookContentModel[] {
        try {
            const progressFile = path.join(process.cwd(), 'progress', `${bookId}_progress.json`);
            if (fs.existsSync(progressFile)) {
                const progressData = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
                console.log(`📂 Найден сохраненный прогресс: ${progressData.completedCount} глав от ${progressData.timestamp}`);
                return progressData.chapters || [];
            }
        } catch (error) {
            console.log(`⚠️ Не удалось загрузить прогресс: ${error}`);
        }
        return [];
    }

    public getVolumeFromChapter(chapter: BookChaptersModel): number | null {
        const titleMatch = chapter.title.match(/Том (\d+)/);
        if (titleMatch) {
            return parseInt(titleMatch[1]);
        }

        const urlMatch = chapter.link.match(/\/v(\d+)\//);
        if (urlMatch) {
            return parseInt(urlMatch[1]);
        }

        return null;
    }

    public filterChaptersByVolumes(chapters: BookChaptersModel[], selectedVolumes: number[]): BookChaptersModel[] {
        if (selectedVolumes.length === 2 && selectedVolumes[0] === -1) {
            const maxChapters = selectedVolumes[1];
            console.log(`🔢 Ограничиваем до ${maxChapters} глав`);
            const limitedChapters = chapters.slice(0, maxChapters);
            limitedChapters.forEach((chapter, index) => {
                chapter.id = index;
            });
            return limitedChapters;
        }

        const filteredChapters = chapters.filter(chapter => {
            const volume = this.getVolumeFromChapter(chapter);
            if (volume !== null) {
                return selectedVolumes.includes(volume);
            }
            return false;
        });

        filteredChapters.forEach((chapter, index) => {
            chapter.id = index;
        });

        console.log(`📚 Отфильтровано ${filteredChapters.length} глав из ${chapters.length} по выбранным томам`);

        return filteredChapters;
    }

    public groupChaptersByVolumes(chapters: BookChaptersModel[]): Map<number, BookChaptersModel[]> {
        const volumeGroups = new Map<number, BookChaptersModel[]>();

        chapters.forEach(chapter => {
            const volume = this.getVolumeFromChapter(chapter);
            if (volume !== null) {
                if (!volumeGroups.has(volume)) {
                    volumeGroups.set(volume, []);
                }
                volumeGroups.get(volume)!.push(chapter);
            }
        });

        volumeGroups.forEach((chapters, volume) => {
            chapters.sort((a, b) => {
                const getChapterNumber = (title: string) => {
                    const match = title.match(/Глава ([0-9.]+)/);
                    return match ? parseFloat(match[1]) : 0;
                };
                return getChapterNumber(a.title) - getChapterNumber(b.title);
            });

            chapters.forEach((chapter, index) => {
                chapter.id = index;
            });
        });

        return volumeGroups;
    }

    /**
     * ВАЖНО: теперь для загрузки томов создаётся ОДИН браузер на все тома,
     * который переиспользуется. Это критично для скорости.
     */
    public async processVolumesByOne(chapters: BookChaptersModel[], bookId: string, bookInfo: BookInfoModel, basePath: string, noImagesMode: boolean = false): Promise<string[]> {
        const volumeGroups = this.groupChaptersByVolumes(chapters);
        const volumes = Array.from(volumeGroups.keys()).sort((a, b) => a - b);
        const createdFiles: string[] = [];

        console.log(`\n📚 Будем обрабатывать ${volumes.length} томов по отдельности`);
        console.log(`📖 Тома: ${volumes.join(', ')}`);

        // Создаём ОДИН браузер для всех томов
        const { browser, page } = await this.$browserService.startBrowser();

        try {
            for (let i = 0; i < volumes.length; i++) {
                const volume = volumes[i];
                const volumeChapters = volumeGroups.get(volume)!;

                console.log(`\n🔥 === ОБРАБОТКА ТОМА ${volume} (${i + 1}/${volumes.length}) ===`);
                console.log(`📖 Глав в томе: ${volumeChapters.length}`);
                if (volumeChapters.length === 0) {
                    console.log(`⚠️ В томе ${volume} нет глав!`);
                    continue;
                }

                try {
                    console.log(`\n📥 Загружаем главы тома ${volume}...`);

                    const volumeResult = await this.getAllBookContent(
                        volumeChapters,
                        `${bookId}_том_${volume}`,
                        browser,
                        page,
                        ''
                    );

                    const volumeContent = (volumeResult as any).content || volumeResult;
                    const hasRateLimitErrors = (volumeResult as any).hasRateLimitErrors || false;
                    const rateLimitErrorCount = (volumeResult as any).rateLimitErrorCount || 0;

                    if (hasRateLimitErrors) {
                        console.log(`\n⚠️ === ОШИБКИ 429 В ТОМЕ ${volume} ===`);
                        console.log(`❌ Не удалось загрузить ${rateLimitErrorCount} глав из-за ограничения запросов сервером.`);
                        console.log(`💾 Прогресс сохранен. Загружено глав: ${volumeContent.length} из ${volumeChapters.length}`);
                        console.log(`⏭️ Пропускаем создание EPUB для тома ${volume} и переходим к следующему тому.`);
                        continue;
                    }

                    if (volumeContent.length === 0) {
                        console.log(`⚠️ Том ${volume} пустой, пропускаем`);
                        continue;
                    }

                    if (volumeContent.length < volumeChapters.length) {
                        const missingChapters = volumeChapters.length - volumeContent.length;
                        console.log(`\n⚠️ ВНИМАНИЕ: В томе ${volume} загружено только ${volumeContent.length} из ${volumeChapters.length} глав.`);
                        console.log(`   Отсутствует ${missingChapters} глав.`);
                        console.log(`⏭️ Пропускаем создание EPUB для тома ${volume} и переходим к следующему тому.`);
                        continue;
                    }

                    const volumeFileName = `${bookId}_том_${volume}`;
                    const volumeFilePath = `${basePath}/${volumeFileName}.epub`;

                    volumeContent.sort((a: BookContentModel, b: BookContentModel) => a.id - b.id);

                    console.log(`\n📚 Генерируем EPUB для тома ${volume}...`);
                    const volumeBookOptions: BookDataModel = {
                        ...bookInfo,
                        title: `${bookInfo.title} - Том ${volume}`,
                        content: volumeContent,
                        output: volumeFilePath,
                        verbose: false,
                    };

                    try {
                        if (noImagesMode) {
                            console.log('🚫 Создаем том БЕЗ изображений (выбрано пользователем)');
                            await this.generateEpubFromDataNoImages(volumeBookOptions);
                        } else {
                            await this.generateEpubFromData(volumeBookOptions);
                        }
                    } catch (epubError: any) {
                        const errorMessage = epubError.message || epubError.toString();

                        if (errorMessage.toLowerCase().includes('econnreset') ||
                            errorMessage.toLowerCase().includes('network') ||
                            errorMessage.toLowerCase().includes('timeout') ||
                            errorMessage.toLowerCase().includes('connection') ||
                            errorMessage.toLowerCase().includes('aborted')) {

                            console.log(`⚠️ Ошибка сети при генерации EPUB: ${errorMessage}`);
                            console.log(`🔄 Пробуем создать EPUB без изображений...`);

                            const fallbackPath = volumeFilePath.replace('.epub', '_без_изображений.epub');
                            const fallbackOptions = { ...volumeBookOptions, output: fallbackPath };

                            await this.generateEpubFromDataNoImages(fallbackOptions);
                            createdFiles.push(fallbackPath);

                            console.log(`✅ Том ${volume} сохранен БЕЗ изображений: ${path.basename(fallbackPath)}`);
                            continue;
                        } else {
                            throw epubError;
                        }
                    }
                    createdFiles.push(volumeFilePath);

                    console.log(`✅ Том ${volume} успешно сохранен: ${volumeFileName}.epub`);
                    console.log(`📊 Глав в томе: ${volumeContent.length}`);

                    if (volumeContent.length === volumeChapters.length) {
                        try {
                            const progressFile = path.join(process.cwd(), 'progress', `${bookId}_том_${volume}_progress.json`);
                            if (fs.existsSync(progressFile)) {
                                fs.unlinkSync(progressFile);
                                console.log(`🗑️ Прогресс тома ${volume} очищен`);
                            }
                        } catch (error) {
                            console.log(`⚠️ Не удалось очистить прогресс тома ${volume}`);
                        }
                    } else {
                        console.log(`💾 Прогресс тома ${volume} сохранен (загружено ${volumeContent.length} из ${volumeChapters.length} глав)`);
                    }

                    if (i < volumes.length - 1) {
                        console.log(`⏸️ Пауза 3 секунды перед следующим томом...`);
                        await this.$commonService.delay(3000);
                    }

                } catch (error) {
                    console.log(`❌ Ошибка при обработке тома ${volume}: ${error}`);
                    console.log(`💡 Переходим к следующему тому. Уже сохранены: ${createdFiles.length} томов`);
                    continue;
                }
            }
        } finally {
            // Всегда закрываем браузер после обработки всех томов
            await this.$browserService.closeBrowser(browser);
        }

        console.log(`\n🎉 === ОБРАБОТКА ЗАВЕРШЕНА ===`);
        console.log(`✅ Успешно создано томов: ${createdFiles.length}/${volumes.length}`);
        console.log(`📂 Созданные файлы:`);
        createdFiles.forEach((file, index) => {
            console.log(`   ${index + 1}. ${path.basename(file)}`);
        });

        return createdFiles;
    }
}