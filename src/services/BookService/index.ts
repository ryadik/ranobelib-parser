import EPub from 'epub-gen'
import type {Options as BookDataModel} from 'epub-gen'
import type {BookServiceModel} from "../../models/book-service.model";
import type {BookInfoModel} from "../../models/book-info.model";
import type {BookChaptersModel} from "../../models/book-chapters.model";
import type {BookContentModel} from "../../models/book-content.model";
import {ErrorMsgModel} from "../../models/error-handler-service.model";
import {ErrorHandler} from "../ErrorHandler/index";
import {BrowserService} from "../BrowserService/index";
import {CommonService} from "../CommonService/index";
import {Config, Prompt} from "prompt-sync";

export class BookService implements BookServiceModel {
  constructor(
    private $errorService: ErrorHandler,
    private $browserService: BrowserService,
    private $commonService: CommonService,
    private $promptSync: (config?: Config) => Prompt
  ) {}

    public async getBookInfo(url: string): Promise<BookInfoModel> {


        const { browser, page } = await this.$browserService.startBrowser();

        await this.$browserService.gotoPage(page, url)

        // Паршу инфу по книге на ее главной странице
        const bookInfo = await page.evaluate(() => {
            const title = document.querySelector('div.media-name__body > div.media-name__main');
            const author = document.querySelector('div.media-info-list__item > div.media-info-list__value > a');
            const coverImg: HTMLImageElement | null = document.querySelector('div.media-sidebar__cover.paper > img');
            const coverPlaceholder = 'https://aeroclub-issoire.fr/wp-content/uploads/2020/05/image-not-found.jpg'

            return {
                title: title?.textContent || '',
                author: author?.textContent || '',
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

        await this.$browserService.gotoPage(page, url);

        // Нахожу кнопку "Начать читать" или "Продолжить" и кликаю по ней
        const gotoBookButton =
            await page.waitForSelector(
                'div.media-sidebar__buttons.section > a.button.button_block.button_primary'
            );

        if (gotoBookButton)
            await gotoBookButton.click();
        else
            this.$errorService.throwError(ErrorMsgModel.ELEMENT_COULD_NOT_BE_FOUND, 'кнопку чтения книги')

        // Нахожу кнопку открытия модалки с главами и кликаю по ней
        const chapterButton =
            await page.waitForSelector(
                'div.reader-header-actions > div.reader-header-action[data-reader-modal="chapters"][data-media-down="md"]'
            )
        // const chapterButton = await page.waitForSelector('div.reader-header-action[data-reader-modal="chapters"]')
        if (chapterButton)
            await chapterButton.click();
        else
            this.$errorService.throwError(ErrorMsgModel.ELEMENT_COULD_NOT_BE_FOUND, 'кнопку для открытия списка глав')

        try {
          // Находим див в котором выводятся все доступные команды перевода
          const teamsDiv = await page.waitForSelector("div.team-list", {timeout: 5000});

          if (teamsDiv) {
            // Если таковой есть - получаем все варианты, даем выбор в промпту
            const teamsButtons = await page.evaluate(() => {
              const data: NodeListOf<HTMLElement> =
                document.querySelectorAll("div.team-item-wrap");
              return Array.from(data).map(
                (elem) =>
                  elem.querySelector("div.team-list-item__name > span")
                    ?.textContent || "Неизвестно"
              );
            });
            const prompt = this.$promptSync({ sigint: true });
            console.log(
              `Найдено ${teamsButtons.length} команд, выберите одну (нужно ввести цифру)`
            );
            teamsButtons.forEach((team, index) => console.log(`${index + 1} ` + team.trim()));

            const selectedTeam = prompt({});

            if (+selectedTeam > teamsButtons.length) {
              this.$errorService.throwError(
                ErrorMsgModel.ELEMENT_COULD_NOT_BE_FOUND,
                "выбранную команду"
              );
            }
            
            const teamButton = await page.waitForSelector(`div.team-item-wrap:nth-child(${selectedTeam})`)
            
            if (teamButton) await teamButton.click();
            else
              this.$errorService.throwError(
                ErrorMsgModel.ELEMENT_COULD_NOT_BE_FOUND,
                "выбранную команду"
              );  
          }
        } catch {}

        // Собираю все главы с называниями в один массив
        // Со страницы книги, простым путем, это сделать не получится
        // Так как там lazyloading на главах
        // С прокруткой страницы в контейнер добавляются новые главы и убираются старые
        const chaptersWithTitles = await page.evaluate(() => {
            const data: NodeListOf<HTMLAnchorElement> =
                document.querySelectorAll(
                    'div.modal__body > a.menu__item.text-truncate'
                );

            // Массив с главами надо отсортировать, так как он в обратном порядке
            return Array.from(
                data,
                (item: HTMLAnchorElement, k) =>
                    ({ id: k, title: item.textContent ?? '', link: item.href ?? '' })
            )
                .sort((a, b) => b.id - a.id);
        });

        await this.$browserService.closeBrowser(browser);

        return chaptersWithTitles;
    }

    private async getChapterContent(url: string): Promise<string> {
        const { browser, page } = await this.$browserService.startBrowser();

        await this.$browserService.gotoPage(page, url)

        // Получаю контент главы, переданной в функцию
        const bookContent = await page.evaluate(() => {
            const content = document.querySelector('div.reader-container.container.container_center')

            if (content) {
                // Если img.src - undfined, заменяем на пустую строку чтоб избежать ошибки epub-gen
                content.querySelectorAll('img').forEach((img) => img.src = img.src || '')
                return content.innerHTML;
            }
            else {
                this.$errorService.throwError(ErrorMsgModel.ELEMENT_COULD_NOT_BE_FOUND, 'кнопку чтения книги')
                return '';
            }
        });

        await this.$browserService.closeBrowser(browser);

        return bookContent;
    }

    public async getAllBookContent(bookChapters: BookChaptersModel[]): Promise<BookContentModel[]> {
        const bookContent = [] as BookContentModel[];

        // Прохожусь по всем главам, собираю с них весь контент и кладу его в один массив
        for (const chapter of bookChapters) {
            const content = await this.getChapterContent(chapter.link);

            await this.$commonService.delay(2000)

            const cacheData: BookContentModel = {
                data: content,
                id: chapter.id,
                title: chapter.title,
            }

            bookContent.push(cacheData);
        }

        // Сортирую главы по порядку
        // сделал именно сортировкой, так как решил перестраховаться, что все главы в правильном порядке будут
        bookContent.sort((a, b) => b.id - a.id);

        return bookContent;
    }

    public generateEpubFromData(bookData: BookDataModel): any {
        return new EPub(bookData, bookData.output);
    }
}