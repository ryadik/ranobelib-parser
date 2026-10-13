import type { Browser, Page, PuppeteerNode } from "puppeteer";
import type { BrowserServiceModel } from "../../models/browser-service.model";
import { ErrorMsgModel } from "../../models/error-handler-service.model";
import { $errorService } from "../index";

export class BrowserService implements BrowserServiceModel {
    private $puppeteer: PuppeteerNode;

    constructor(puppeteer: PuppeteerNode) {
        this.$puppeteer = puppeteer;
    }

    private checkPageStatus(status: number, url?: string): void {
        if (status === 429) {
            // Специальная обработка для ошибки 429 (Too Many Requests)
            const error = new Error(`Ошибка загрузки страницы. Код ошибки: 429`);
            (error as any).statusCode = 429;
            throw error;
        }
        if (status !== 200) {
            $errorService.throwError(ErrorMsgModel.PAGE_LOADING_ERROR, `${status}`);
        }
    }

    public async gotoPage(page: Page, url: string): Promise<void> {
        const response = await page.goto(url, { timeout: 0, waitUntil: 'domcontentloaded' });
        const status = response?.status() ?? 404;
        this.checkPageStatus(status, url);
    }

    public async startBrowser(): Promise<{ page: Page; browser: Browser }> {
        const browser = await this.$puppeteer.launch({
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--ignore-certificate-errors',
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();

        // Перехватываем запросы и отменяем загрузку тяжелых медиафайлов
        // Также блокируем script/xhr/fetch для ускорения рендеринга страниц глав
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });

        return { browser, page };
    }

    public async closeBrowser(browser: Browser): Promise<void> {
        try {
            await browser.close();
        } catch (e) {
            // Игнорируем ошибки закрытия
        }
    }
}