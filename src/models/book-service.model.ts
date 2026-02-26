import type {BookInfoModel} from "./book-info.model";
import type {BookChaptersModel} from "./book-chapters.model";
import type {BookContentModel} from "./book-content.model";
import type {Options as BookDataModel} from "epub-gen";

export interface BookServiceModel {
    getBookInfo(url: string): Promise<BookInfoModel>;
    getChapters(url: string): Promise<BookChaptersModel[]>;
    getAllBookContent(bookChapters: BookChaptersModel[], bookId: string, url?: string, allChapters?: BookChaptersModel[]): Promise<BookContentModel[]>;
    generateEpubFromData(bookData: BookDataModel): Promise<any>;
    generateEpubFromDataNoImages(bookData: BookDataModel): Promise<any>;
    filterChaptersByVolumes(chapters: BookChaptersModel[], selectedVolumes: number[]): BookChaptersModel[];
    groupChaptersByVolumes(chapters: BookChaptersModel[]): Map<number, BookChaptersModel[]>;
    processVolumesByOne(chapters: BookChaptersModel[], bookId: string, bookInfo: BookInfoModel, basePath: string, noImagesMode?: boolean): Promise<string[]>;
    findProgressFiles(): Array<{bookId: string, filePath: string, progressData: any}>;
}