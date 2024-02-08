import type {BookInfoModel} from "./book-info.model";
import type {BookChaptersModel} from "./book-chapters.model";
import type {BookContentModel} from "./book-content.model";
import type {Options as BookDataModel} from "epub-gen";

export interface BookServiceModel {
    getBookInfo(url: string): Promise<BookInfoModel>;
    getChapters(url: string): Promise<BookChaptersModel[]>;
    getAllBookContent(bookChapters: BookChaptersModel[]): Promise<BookContentModel[]>;
    generateEpubFromData(bookData: BookDataModel): any
}