import type {Config, Prompt} from "prompt-sync";
import type {CommonServiceModel} from "../../models/common-service.model";

export class CommonService implements CommonServiceModel {
    private readonly $promtSync: (config?: Config) => Prompt;

    constructor($promtSync: (config?: Config) => Prompt) {
        this.$promtSync = $promtSync;
    }

    public userAlert(): void {
        console.log('Здравствуйте, это программа загрузки книг с сайта ranobelib.me')
        console.log('Пожалуйста, прочитайте информацию ниже.')
        console.log('\nВо время загрузки у Вас, несколько раз, будет открываться и закрываться окно браузера.')
        console.log('Пожалуйста, не беспокойтесь, так и должно быть.')
        console.log('Во время загрузки, пожалуйста, не трогайте окно браузера, это может привести к сбоям.')
    }

    public getBookURL(): string {
        const prompt = this.$promtSync({ sigint: true });

        console.log("\nВведите, пожалуйста, адрес книги с сайта ranobelib.me");
        console.log("Пример адреса: https://ranobelib.me/sakurasou-no-pet-na-kanojo-novel")
        console.log('Пожалуйста, указывайте верный адрес, во избежания проблем с работой программы.')

        const URL: string = prompt({});

        console.log(`\nСейчас начнется загрузка книги, по адресу: ${URL}`)

        return URL;
    }

    public delay(time: number): Promise<void> {
        return new Promise(function(resolve) {
            setTimeout(resolve, time)
        });
    }
}