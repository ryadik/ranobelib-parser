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

    public selectVolumesToDownload(chaptersData: any[]): any[] {
        const prompt = this.$promtSync({ sigint: true });
        
        // Группируем главы по томам
        const volumeMap = new Map<number, number>();
        chaptersData.forEach(chapter => {
            const volumeMatch = chapter.title.match(/Том (\d+)/);
            if (volumeMatch) {
                const volume = parseInt(volumeMatch[1]);
                volumeMap.set(volume, (volumeMap.get(volume) || 0) + 1);
            }
        });
        
        const volumes = Array.from(volumeMap.keys()).sort((a, b) => a - b);
        
        console.log('\n📚 Найдены следующие тома:');
        volumes.forEach(vol => {
            const chapterCount = volumeMap.get(vol) || 0;
            console.log(`   Том ${vol}: ${chapterCount} глав`);
        });
        
        console.log(`\n📊 Всего: ${volumes.length} томов, ${chaptersData.length} глав`);
        console.log('\n⚠️ Загрузка всех глав может занять несколько часов!');
        
        console.log('\nВыберите что загружать:');
        console.log('1. Загрузить все тома');
        console.log('2. Выбрать конкретные тома');
        console.log('3. Загрузить диапазон томов (например, 1-3)');
        console.log('4. Загрузить только первые N глав (для тестирования)');
        
        const choice = prompt('Ваш выбор (1-4): ');
        
        let selectedVolumes: number[] = [];
        
        switch (choice) {
            case '1':
                console.log('✅ Выбраны все тома');
                selectedVolumes = volumes;
                break;
                
            case '2':
                const volumesInput = prompt(`Введите номера томов через запятую (доступно: ${volumes.join(', ')}): `);
                if (volumesInput) {
                    const inputVolumes = volumesInput.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v) && volumes.includes(v));
                    if (inputVolumes.length > 0) {
                        console.log(`✅ Выбраны тома: ${inputVolumes.join(', ')}`);
                        selectedVolumes = inputVolumes;
                        break;
                    }
                }
                console.log('❌ Неверный ввод. Загружаем только том 1');
                selectedVolumes = [1];
                break;
                
            case '3':
                const rangeInput = prompt('Введите диапазон томов (например, 1-3): ');
                if (rangeInput && rangeInput.includes('-')) {
                    const [start, end] = rangeInput.split('-').map(v => parseInt(v.trim()));
                    if (!isNaN(start) && !isNaN(end) && start <= end) {
                        const rangeVolumes = [];
                        for (let i = start; i <= end; i++) {
                            if (volumes.includes(i)) {
                                rangeVolumes.push(i);
                            }
                        }
                        if (rangeVolumes.length > 0) {
                            console.log(`✅ Выбран диапазон: тома ${rangeVolumes.join(', ')}`);
                            selectedVolumes = rangeVolumes;
                            break;
                        }
                    }
                }
                console.log('❌ Неверный диапазон. Загружаем только том 1');
                selectedVolumes = [1];
                break;
                
            case '4':
                const maxChaptersInput = prompt('Введите количество первых глав для загрузки: ');
                const maxChapters = parseInt(maxChaptersInput || '5');
                if (!isNaN(maxChapters) && maxChapters > 0) {
                    console.log(`✅ Выбрано: первые ${maxChapters} глав`);
                    
                    // Выбор режима изображений для тестового режима
                    console.log('\n🖼️ Выберите обработку изображений:');
                    console.log('1. 📷 Включить изображения (красивее, но риск ошибок ECONNRESET)');
                    console.log('2. 🚫 БЕЗ изображений (стабильнее, быстрее, меньше размер)');
                    
                    const imageChoice = prompt('Ваш выбор (1-2): ');
                    
                    if (imageChoice === '2') {
                        console.log('✅ Выбран тестовый режим БЕЗ изображений');
                        return ['NO_IMAGES', -1, maxChapters];
                    } else {
                        console.log('✅ Выбран тестовый режим С изображениями');
                        return [-1, maxChapters]; // -1 означает "ограничить по количеству глав"
                    }
                }
                console.log('❌ Неверное количество. Загружаем первые 5 глав');
                
                // Выбор режима изображений для fallback
                console.log('\n🖼️ Выберите обработку изображений:');
                console.log('1. 📷 Включить изображения');
                console.log('2. 🚫 БЕЗ изображений');
                
                const fallbackImageChoice = prompt('Ваш выбор (1-2): ');
                
                if (fallbackImageChoice === '2') {
                    return ['NO_IMAGES', -1, 5];
                } else {
                    return [-1, 5];
                }
                
            default:
                console.log('❌ Неверный выбор. Загружаем только том 1');
                selectedVolumes = [1];
                break;
        }
        
        // Если выбрано больше одного тома, предлагаем режим обработки
        if (selectedVolumes.length > 1) {
            console.log('\n🔧 Выберите режим обработки:');
            console.log('1. 📚 Объединить все в один EPUB (быстрее, но риск потерять всё при ошибке)');
            console.log('2. 🔥 Обрабатывать тома по отдельности (БЕЗОПАСНО! Рекомендуется)');
            
            const modeChoice = prompt('Ваш выбор (1-2): ');
            
            if (modeChoice === '2') {
                console.log('✅ Выбрана БЕЗОПАСНАЯ обработка по томам');
                console.log('💡 Каждый том будет сохранен как отдельный EPUB файл');
                console.log('🛡️ При ошибке потеряется только текущий том, а не всё');
                
                // Дополнительный выбор по изображениям
                console.log('\n🖼️ Выберите обработку изображений:');
                console.log('1. 📷 Включить изображения (красивее, но риск ошибок ECONNRESET)');
                console.log('2. 🚫 БЕЗ изображений (стабильнее, быстрее, меньше размер)');
                
                const imageChoice = prompt('Ваш выбор (1-2): ');
                
                if (imageChoice === '2') {
                    console.log('✅ Выбран режим БЕЗ изображений');
                    console.log('🛡️ Максимальная стабильность!');
                    return ['VOLUME_BY_VOLUME', 'NO_IMAGES', ...selectedVolumes];
                } else {
                    console.log('✅ Выбран режим С изображениями');
                    console.log('⚠️ При ошибках скачивания будет fallback без изображений');
                    return ['VOLUME_BY_VOLUME', ...selectedVolumes];
                }
            } else {
                console.log('✅ Выбрана обычная обработка (один файл)');
                console.log('⚠️ При ошибке можете потерять весь прогресс!');
                
                // Дополнительный выбор по изображениям и для обычного режима
                console.log('\n🖼️ Выберите обработку изображений:');
                console.log('1. 📷 Включить изображения (красивее, но риск ошибок ECONNRESET)');
                console.log('2. 🚫 БЕЗ изображений (стабильнее, быстрее, меньше размер)');
                
                const imageChoice = prompt('Ваш выбор (1-2): ');
                
                if (imageChoice === '2') {
                    console.log('✅ Выбран режим БЕЗ изображений');
                    return ['NO_IMAGES', ...selectedVolumes];
                } else {
                    console.log('✅ Выбран режим С изображениями');
                    return selectedVolumes;
                }
            }
        }
        
        return selectedVolumes;
    }
}