import { ErrorMsgModel } from "../../models/error-handler-service.model";
import type { ErrorHandlerServiceModel } from "../../models/error-handler-service.model";

export class ErrorHandler implements ErrorHandlerServiceModel {
    public throwError(errorMsg: ErrorMsgModel, values?: string): Error {
        throw new Error(`${errorMsg} ${values ?? ''}`);
    }
}