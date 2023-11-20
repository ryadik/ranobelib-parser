export enum ErrorMsgModel {
    ELEMENT_COULD_NOT_BE_FOUND = 'Не удалось найти элемент',
    PAGE_LOADING_ERROR = 'Ошибка загрузки страницы. Код ошибки:',
}

export interface ErrorHandlerServiceModel {
    throwError(errorMsg: ErrorMsgModel, values?: string): Error;
}