import promptSync from "prompt-sync";
import puppeteer from "puppeteer";
import {ErrorHandler} from "./ErrorHandler/index";
import {BrowserService} from "./BrowserService/index";
import {CommonService} from "./CommonService/index";
import {BookService} from "./BookService/index";

const $errorService = new ErrorHandler();
const $browserService = new BrowserService(puppeteer);
const $commonService = new CommonService(promptSync);
const $bookService = new BookService(
    $errorService,
    $browserService,
    $commonService,
    promptSync
)

export {
    $errorService,
    $browserService,
    $commonService,
    $bookService
}