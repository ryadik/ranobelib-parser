import type { Browser, Page, PuppeteerNode } from "puppeteer";
import type {BrowserServiceModel} from "../../models/browser-service.model";
import {ErrorMsgModel} from "../../models/error-handler-service.model";
import {$errorService} from "../index";

export class BrowserService implements BrowserServiceModel {
    private $puppeteer: PuppeteerNode;

    constructor($puppeteer: PuppeteerNode) {
        this.$puppeteer = $puppeteer;
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
        const response = await page.goto(url, { timeout: 0 });
        const status = response?.status() ?? 404;
        this.checkPageStatus(status, url);
    }

    public async startBrowser(): Promise<{ page: Page; browser: Browser }> {
        const browser = await this.$puppeteer.launch(
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

        return {browser, page};
    }

    public async closeBrowser(browser: Browser): Promise<void> {
        await browser.close();
    }
}