import type { Browser, Page } from 'puppeteer';

export interface BrowserServiceModel {
  gotoPage(page: Page, url: string): Promise<void>;
  startBrowser(): Promise<{ page: Page; browser: Browser }>;
  closeBrowser(browser: Browser): Promise<void>;
}
