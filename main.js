require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs').promises;
const winston = require('winston');
const schedule = require('node-schedule');

// Конфигурация
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || '';
const JSON_FILE = process.env.JSON_FILE || 'wb_products.json';
const HOST_CACHE_FILE = process.env.HOST_CACHE_FILE || 'host_cache.json';

// Проверка наличия обязательных переменных
if (!TOKEN || !CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN or CHAT_ID is not defined in .env file');
    process.exit(1);
}

// Состояния пользователей для обработки ввода артикула
const userStates = {};

// Настройка логирования
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} - ${level.toUpperCase()} - ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'bot.log' })
    ]
});

// Инициализация бота
const bot = new TelegramBot(TOKEN, { polling: true });

// Показ главного меню
async function showMainMenu(chatId) {
    const keyboard = {
        inline_keyboard: [
            [{ text: 'Добавить товар', callback_data: 'add_product' }],
            [{ text: 'Удалить товар', callback_data: 'remove_product' }],
            [{ text: 'Список товаров', callback_data: 'list_products' }],
            [{ text: 'Проверить цены', callback_data: 'check_prices' }]
        ]
    };
    await bot.sendMessage(chatId, 'Выберите действие:', {
        reply_markup: keyboard,
        parse_mode: 'HTML'
    });
}

// Загрузка данных из JSON
async function loadData() {
    try {
        const exists = await fs.access(JSON_FILE).then(() => true).catch(() => false);
        if (!exists) {
            logger.info(`Файл ${JSON_FILE} не существует, возвращается пустой объект`);
            return { products: {} };
        }

        const content = await fs.readFile(JSON_FILE, 'utf-8');
        if (!content.trim()) {
            logger.info(`Файл ${JSON_FILE} пуст, возвращается пустой объект`);
            return { products: {} };
        }

        const data = JSON.parse(content);
        if (!data.products) data.products = {};
        return data;
    } catch (error) {
        if (error instanceof SyntaxError) {
            logger.error(`Ошибка декодирования JSON в файле ${JSON_FILE}: ${error.message}`);
        } else {
            logger.error(`Ошибка загрузки данных из ${JSON_FILE}: ${error.message}`);
        }
        return { products: {} };
    }
}

// Сохранение данных в JSON
async function saveData(data) {
    try {
        await fs.writeFile(JSON_FILE, JSON.stringify({ products: data.products }, null, 2), 'utf-8');
        logger.info(`Данные успешно сохранены в ${JSON_FILE}`);
    } catch (error) {
        logger.error(`Ошибка сохранения данных: ${error.message}`);
    }
}

// Загрузка кэша серверов
async function loadHostCache() {
    try {
        const exists = await fs.access(HOST_CACHE_FILE).then(() => true).catch(() => false);
        if (!exists) return {};
        const content = await fs.readFile(HOST_CACHE_FILE, 'utf-8');
        return content.trim() ? JSON.parse(content) : {};
    } catch (error) {
        logger.error(`Ошибка загрузки ${HOST_CACHE_FILE}: ${error.message}`);
        return {};
    }
}

// Сохранение кэша серверов
async function saveHostCache(cache) {
    try {
        await fs.writeFile(HOST_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
        logger.info(`Кэш хостов успешно сохранён в ${HOST_CACHE_FILE}`);
    } catch (error) {
        logger.error(`Ошибка сохранения ${HOST_CACHE_FILE}: ${error.message}`);
    }
}

// Проверка доступности изображения
async function verifyImageUrl(url, headers) {
    try {
        const response = await axios.head(url, { headers, timeout: 5000 });
        logger.info(`Изображение доступно: ${url}`);
        return response.status === 200;
    } catch (error) {
        logger.warn(`Изображение недоступно: ${url}, ошибка: ${error.message}`);
        return false;
    }
}

// Получение данных о товаре с Wildberries
async function getWbProductInfo(article) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': '*/*',
        'Referer': `https://www.wildberries.ru/catalog/${article}/detail.aspx`,
        'Origin': 'https://www.wildberries.ru'
    };

    const nm = parseInt(article);
    const vol = Math.floor(nm / 100000);
    const part = Math.floor(nm / 1000);
    const hostCache = await loadHostCache();
    const possibleHosts = Array.from({ length: 100 }, (_, i) => String(i + 1).padStart(2, '0'));
    let cardData = null;
    let latestPrice = 0;
    let imageUrl = '';
    let host = hostCache[vol] || possibleHosts[0];

    // Попытка запросов к серверам
    for (const attemptHost of [host, ...possibleHosts.filter(h => h !== host)]) {
        const cardUrl = `https://basket-${attemptHost}.wbbasket.ru/vol${vol}/part${part}/${article}/info/ru/card.json`;
        logger.info(`Инициирован запрос к card API: ${cardUrl}`);

        try {
            const cardResponse = await axios.get(cardUrl, { headers, timeout: 15000 });
            logger.info(`Получен ответ от card API: статус ${cardResponse.status}, host: ${attemptHost}`);

            if (cardResponse.status === 200) {
                cardData = cardResponse.data;
                hostCache[vol] = attemptHost;
                await saveHostCache(hostCache);
                // Формируем URL изображения с путём /images/big/
                imageUrl = `https://basket-${attemptHost}.wbbasket.ru/vol${vol}/part${part}/${article}/images/big/1.webp`;
                break;
            }
        } catch (error) {
            logger.warn(`Ошибка при запросе к card API: ${error.message}, URL: ${cardUrl}`);
            continue;
        }
    }

    if (!cardData) {
        logger.error(`Не удалось получить данные из card API для артикула ${article} после попыток на всех серверах`);
        return { success: false, message: 'Не удалось получить данные из card API' };
    }

    // Проверка доступности изображения
    if (imageUrl && !(await verifyImageUrl(imageUrl, headers))) {
        // Пробуем альтернативный путь /images/tm/
        imageUrl = `https://basket-${hostCache[vol]}.wbbasket.ru/vol${vol}/part${part}/${article}/images/tm/1.webp`;
        if (!(await verifyImageUrl(imageUrl, headers))) {
            // Пробуем JPG как запасной вариант
            imageUrl = `https://images.wbstatic.net/big/new/${vol}/${article}-1.jpg`;
            if (!(await verifyImageUrl(imageUrl, headers))) {
                imageUrl = ''; // Если изображение недоступно
            }
        }
    }

    // Запрос к price-history API
    const priceUrl = `https://basket-${hostCache[vol]}.wbbasket.ru/vol${vol}/part${part}/${article}/info/price-history.json`;
    try {
        logger.info(`Инициирован запрос к price API: ${priceUrl}`);
        const priceResponse = await axios.get(priceUrl, { headers, timeout: 15000 });
        logger.info(`Получен ответ от price API: статус ${priceResponse.status}`);
        if (priceResponse.status === 200 && priceResponse.data.length) {
            const priceData = priceResponse.data;
            latestPrice = priceData[priceData.length - 1].price?.RUB / 100 || 0;
        }
    } catch (priceError) {
        logger.warn(`Ошибка при запросе к price API: ${priceError.message}, URL: ${priceUrl}`);
    }

    // Запрос к wb_card API
    const wbCardUrl = `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=123585822&spp=30&hide_dtype=13&ab_testid=no_reranking&lang=ru&nm=${article}`;
    try {
        logger.info(`Инициирован запрос к wb_card API: ${wbCardUrl}`);
        const wbCardResponse = await axios.get(wbCardUrl, { headers, timeout: 15000 });
        logger.info(`Получен ответ от wb_card API: статус ${wbCardResponse.status}`);
        if (wbCardResponse.status === 200) {
            const wbCardData = wbCardResponse.data;
            for (const product of wbCardData.products || []) {
                if (String(product.id) === article) {
                    if (product.totalQuantity === 0) {
                        logger.warn(`Товар с артикулом ${article} отсутствует на складе`);
                        return { success: false, message: 'Товар отсутствует на складе' };
                    }
                    for (const size of product.sizes || []) {
                        latestPrice = (size.price?.product / 100) || latestPrice;
                        break;
                    }
                    // Проверяем, есть ли изображение в wb_card API
                    if (product.colors?.length && product.colors[0].big_photo) {
                        imageUrl = product.colors[0].big_photo;
                        if (!(await verifyImageUrl(imageUrl, headers))) {
                            imageUrl = `https://basket-${hostCache[vol]}.wbbasket.ru/vol${vol}/part${part}/${article}/images/big/1.webp`;
                            if (!(await verifyImageUrl(imageUrl, headers))) {
                                imageUrl = `https://basket-${hostCache[vol]}.wbbasket.ru/vol${vol}/part${part}/${article}/images/tm/1.webp`;
                                if (!(await verifyImageUrl(imageUrl, headers))) {
                                    imageUrl = `https://images.wbstatic.net/big/new/${vol}/${article}-1.jpg`;
                                    if (!(await verifyImageUrl(imageUrl, headers))) {
                                        imageUrl = '';
                                    }
                                }
                            }
                        }
                    }
                    break;
                }
            }
        }
    } catch (wbCardError) {
        logger.warn(`Ошибка при запросе к wb_card API: ${wbCardError.message}, URL: ${wbCardUrl}`);
    }

    if (cardData && cardData.imt_name) {
        logger.info(`Успешно получены данные для артикула ${article}, imageUrl: ${imageUrl}`);
        return {
            success: true,
            name: cardData.imt_name || 'Не указано',
            price: latestPrice,
            brand: cardData.selling?.brand_name || 'Не указано',
            rating: cardData.rating || 0,
            priceWarning: latestPrice === 0 ? 'Цена недоступна' : null,
            imageUrl
        };
    } else {
        logger.warn(`Отсутствуют ключевые данные в ответе card API для артикула ${article}`);
        return { success: false, message: 'Отсутствуют ключевые данные в ответе card API' };
    }
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`Команда /start получена, chat_id: ${chatId}`);

    const helpText = `
🛍️ <b>Бот для отслеживания цен на Wildberries</b>

Ваш chat_id: ${chatId}

Выберите действие ниже:
`;

    await bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
    await showMainMenu(chatId);
});

// Команда /menu
bot.onText(/\/menu/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`Команда /menu получена, chat_id: ${chatId}`);
    await showMainMenu(chatId);
});

// Обработка callback-запросов от кнопок
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const callbackData = query.data;

    logger.info(`Получен callback_query: ${callbackData}, chat_id: ${chatId}`);

    // Удаляем предыдущее сообщение с меню
    try {
        await bot.deleteMessage(chatId, query.message.message_id);
    } catch (error) {
        logger.warn(`Не удалось удалить сообщение: ${error.message}`);
    }

    if (callbackData === 'add_product') {
        userStates[chatId] = 'awaiting_article';
        await bot.sendMessage(chatId, 'ℹ️ Введите артикул товара:', { parse_mode: 'HTML' });
    } else if (callbackData === 'remove_product') {
        const data = await loadData();
        if (!Object.keys(data.products).length) {
            await bot.sendMessage(chatId, '📭 Список отслеживаемых товаров пуст.', { parse_mode: 'HTML' });
            await showMainMenu(chatId);
            return;
        }

        const keyboard = {
            inline_keyboard: Object.entries(data.products).map(([article, product]) => [
                { text: `${product.name} (арт. ${article})`, callback_data: `remove_${article}` }
            ])
        };
        await bot.sendMessage(chatId, 'Выберите товар для удаления:', {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
    } else if (callbackData === 'list_products') {
        const data = await loadData();
        if (!Object.keys(data.products).length) {
            await bot.sendMessage(chatId, '📭 Список отслеживаемых товаров пуст.', { parse_mode: 'HTML' });
            await showMainMenu(chatId);
            return;
        }

        logger.info(`Отправка списка товаров, chat_id: ${chatId}`);
        for (const [article, product] of Object.entries(data.products)) {
            const caption = `
🔹 <b>${product.name}</b>

Артикул: <code>${article}</code>

Цена: ${product.current_price} руб.

Добавлен: ${product.added_date}

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть на WB</a>
`;
            logger.info(`Отправка данных для артикула ${article}, imageUrl: ${product.imageUrl}`);
            if (product.imageUrl) {
                await bot.sendPhoto(chatId, product.imageUrl, {
                    caption,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            } else {
                await bot.sendMessage(chatId, caption + '\n⚠️ Изображение недоступно', {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            }
        }
        await showMainMenu(chatId);
    } else if (callbackData === 'check_prices') {
        const data = await loadData();
        if (!Object.keys(data.products).length) {
            logger.info(`Нет товаров для проверки, chat_id: ${chatId}`);
            await bot.sendMessage(chatId, 'ℹ️ Нет товаров для проверки.', { parse_mode: 'HTML' });
            await showMainMenu(chatId);
            return;
        }

        logger.info(`Начинаю проверку цен, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, '🔄 Начинаю проверку цен...', { parse_mode: 'HTML' });

        let updated = 0;
        const changes = [];

        for (const [article, product] of Object.entries(data.products)) {
            logger.info(`Проверка товара ${article}`);
            const productInfo = await getWbProductInfo(article);
            if (!productInfo.success) {
                const caption = `
❌ <b>${product.name}</b>

Артикул: <code>${article}</code>

Ошибка: ${productInfo.message}

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
                changes.push({ caption, imageUrl: product.imageUrl });
                continue;
            }

            const oldPrice = product.current_price;
            const newPrice = productInfo.price;

            if (newPrice !== oldPrice) {
                data.products[article].current_price = newPrice;
                data.products[article].imageUrl = productInfo.imageUrl;
                data.products[article].history.push({
                    date: new Date().toISOString().slice(0, 19).replace('T', ' '),
                    price: newPrice
                });
                const caption = `
🔔 <b>${product.name}</b>

Артикул: <code>${article}</code>

Старая цена: ${oldPrice} руб.

Новая цена: ${newPrice} руб.

Разница: ${(newPrice - oldPrice).toFixed(2)} руб.

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
                changes.push({ caption, imageUrl: productInfo.imageUrl });
                updated++;
            }
        }

        if (changes.length > 0) {
            logger.info(`Сохранение данных после проверки, обновлено: ${updated}`);
            await saveData(data);
            for (const change of changes) {
                logger.info(`Отправка сообщения об изменении, imageUrl: ${change.imageUrl}`);
                if (change.imageUrl) {
                    await bot.sendPhoto(chatId, change.imageUrl, {
                        caption: change.caption,
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    });
                } else {
                    await bot.sendMessage(chatId, change.caption + '\n⚠️ Изображение недоступно', {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    });
                }
            }
            if (updated > 0) {
                await bot.sendMessage(chatId, `📊 Обновлено ${updated} цен`, { parse_mode: 'HTML' });
            } else {
                await bot.sendMessage(chatId, 'ℹ️ Изменений цен не обнаружено.', { parse_mode: 'HTML' });
            }
        } else {
            await bot.sendMessage(chatId, 'ℹ️ Изменений цен не обнаружено.', { parse_mode: 'HTML' });
        }
        await showMainMenu(chatId);
    } else if (callbackData.startsWith('remove_')) {
        const article = callbackData.split('_')[1];
        const data = await loadData();
        if (!data.products[article]) {
            logger.info(`Товар ${article} не найден в списке отслеживаемых, chat_id: ${chatId}`);
            await bot.sendMessage(chatId, `ℹ️ Товар ${article} не найден в списке отслеживаемых.`, { parse_mode: 'HTML' });
            await showMainMenu(chatId);
            return;
        }

        const productName = data.products[article].name;
        delete data.products[article];
        logger.info(`Удаление товара ${article}`);
        await saveData(data);
        await bot.sendMessage(chatId, `🗑 Товар удалён: ${productName} (арт. ${article})`, { parse_mode: 'HTML' });
        await showMainMenu(chatId);
    }

    // Подтверждаем обработку callback
    await bot.answerCallbackQuery(query.id);
});

// Обработка текстовых сообщений для ввода артикула
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Игнорируем команды
    if (text.startsWith('/')) return;

    if (userStates[chatId] === 'awaiting_article') {
        const article = text.trim();
        if (!/^\d+$/.test(article)) {
            await bot.sendMessage(chatId, 'ℹ️ Артикул должен содержать только цифры.', { parse_mode: 'HTML' });
            await showMainMenu(chatId);
            delete userStates[chatId];
            return;
        }

        const data = await loadData();
        if (data.products[article]) {
            logger.info(`Товар ${article} уже отслеживается, chat_id: ${chatId}`);
            await bot.sendMessage(chatId, `ℹ️ Товар ${article} уже отслеживается!`, { parse_mode: 'HTML' });
            await showMainMenu(chatId);
            delete userStates[chatId];
            return;
        }

        logger.info(`Попытка добавить товар с артикулом ${article}`);

        let waitMessageSent = false;
        const waitTimeout = setTimeout(async () => {
            logger.info(`Отправка сообщения ожидания для артикула ${article}`);
            await bot.sendMessage(chatId, '⏳ Пожалуйста, подождите, идёт обработка...', { parse_mode: 'HTML' });
            waitMessageSent = true;
        }, 5000);

        try {
            const productInfo = await getWbProductInfo(article);
            clearTimeout(waitTimeout);

            if (!productInfo.success) {
                logger.warn(`Не удалось добавить товар ${article}: ${productInfo.message}`);
                const errorMsg = `
❌ Не удалось получить данные о товаре с артикулом ${article}.

Проверьте артикул: <a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">ссылка</a>

Возможные причины:
1. Товар не существует
2. Ограничения Wildberries
3. Проблемы с сетью

Попробуйте позже или используйте VPN.
`;
                await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
                await showMainMenu(chatId);
                delete userStates[chatId];
                return;
            }

            data.products[article] = {
                name: productInfo.name,
                brand: productInfo.brand,
                current_price: productInfo.price,
                rating: productInfo.rating,
                imageUrl: productInfo.imageUrl,
                added_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
                history: [{
                    date: new Date().toISOString().slice(0, 19).replace('T', ' '),
                    price: productInfo.price
                }]
            };
            logger.info(`Сохранение данных для артикула ${article}`);
            await saveData(data);

            const caption = `
✅ <b>Товар добавлен:</b>

🏷️ Название: ${productInfo.name}

🏭 Бренд: ${productInfo.brand}

⭐ Рейтинг: ${productInfo.rating}

💰 Текущая цена: ${productInfo.priceWarning || productInfo.price + ' руб.'}

🔗 <a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Ссылка</a>
`;

            logger.info(`Отправка сообщения для артикула ${article}, imageUrl: ${productInfo.imageUrl}`);
            if (productInfo.imageUrl) {
                await bot.sendPhoto(chatId, productInfo.imageUrl, {
                    caption,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            } else {
                await bot.sendMessage(chatId, caption + '\n⚠️ Изображение недоступно', {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            }
            await showMainMenu(chatId);
            delete userStates[chatId];
        } catch (error) {
            clearTimeout(waitTimeout);
            logger.error(`Ошибка при добавлении товара ${article}: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Произошла ошибка при добавлении товара ${article}. Попробуйте позже.`, { parse_mode: 'HTML' });
            await showMainMenu(chatId);
            delete userStates[chatId];
        }
    }
});

// Команда /add (для совместимости)
bot.onText(/\/add(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!match[1]) {
        logger.info(`Команда /add без артикула, chat_id: ${chatId}`);
        userStates[chatId] = 'awaiting_article';
        await bot.sendMessage(chatId, 'ℹ️ Введите артикул товара:', { parse_mode: 'HTML' });
        return;
    }

    const article = match[1];
    const data = await loadData();
    if (data.products[article]) {
        logger.info(`Товар ${article} уже отслеживается, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, `ℹ️ Товар ${article} уже отслеживается!`, { parse_mode: 'HTML' });
        await showMainMenu(chatId);
        return;
    }

    logger.info(`Попытка добавить товар с артикулом ${article}`);

    let waitMessageSent = false;
    const waitTimeout = setTimeout(async () => {
        logger.info(`Отправка сообщения ожидания для артикула ${article}`);
        await bot.sendMessage(chatId, '⏳ Пожалуйста, подождите, идёт обработка...', { parse_mode: 'HTML' });
        waitMessageSent = true;
    }, 5000);

    try {
        const productInfo = await getWbProductInfo(article);
        clearTimeout(waitTimeout);

        if (!productInfo.success) {
            logger.warn(`Не удалось добавить товар ${article}: ${productInfo.message}`);
            const errorMsg = `
❌ Не удалось получить данные о товаре с артикулом ${article}.

Проверьте артикул: <a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">ссылка</a>

Возможные причины:
1. Товар не существует
2. Ограничения Wildberries
3. Проблемы с сетью

Попробуйте позже или используйте VPN.
`;
            await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
            await showMainMenu(chatId);
            return;
        }

        data.products[article] = {
            name: productInfo.name,
            brand: productInfo.brand,
            current_price: productInfo.price,
            rating: productInfo.rating,
            imageUrl: productInfo.imageUrl,
            added_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
            history: [{
                date: new Date().toISOString().slice(0, 19).replace('T', ' '),
                price: productInfo.price
            }]
        };
        logger.info(`Сохранение данных для артикула ${article}`);
        await saveData(data);

        const caption = `
✅ <b>Товар добавлен:</b>

🏷️ Название: ${productInfo.name}

🏭 Бренд: ${productInfo.brand}

⭐ Рейтинг: ${productInfo.rating}

💰 Текущая цена: ${productInfo.priceWarning || productInfo.price + ' руб.'}

🔗 <a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Ссылка</a>
`;

        logger.info(`Отправка сообщения для артикула ${article}, imageUrl: ${productInfo.imageUrl}`);
        if (productInfo.imageUrl) {
            await bot.sendPhoto(chatId, productInfo.imageUrl, {
                caption,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        } else {
            await bot.sendMessage(chatId, caption + '\n⚠️ Изображение недоступно', {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        }
        await showMainMenu(chatId);
    } catch (error) {
        clearTimeout(waitTimeout);
        logger.error(`Ошибка при добавлении товара ${article}: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Произошла ошибка при добавлении товара ${article}. Попробуйте позже.`, { parse_mode: 'HTML' });
        await showMainMenu(chatId);
    }
});

// Команда /remove (для совместимости)
bot.onText(/\/remove(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!match[1]) {
        logger.info(`Команда /remove без артикула, chat_id: ${chatId}`);
        const data = await loadData();
        if (!Object.keys(data.products).length) {
            await bot.sendMessage(chatId, '📭 Список отслеживаемых товаров пуст.', { parse_mode: 'HTML' });
            await showMainMenu(chatId);
            return;
        }

        const keyboard = {
            inline_keyboard: Object.entries(data.products).map(([article, product]) => [
                { text: `${product.name} (арт. ${article})`, callback_data: `remove_${article}` }
            ])
        };
        await bot.sendMessage(chatId, 'Выберите товар для удаления:', {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
        return;
    }

    const article = match[1];
    const data = await loadData();
    if (!data.products[article]) {
        logger.info(`Товар ${article} не найден в списке отслеживаемых, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, `ℹ️ Товар ${article} не найден в списке отслеживаемых.`, { parse_mode: 'HTML' });
        await showMainMenu(chatId);
        return;
    }

    const productName = data.products[article].name;
    delete data.products[article];
    logger.info(`Удаление товара ${article}`);
    await saveData(data);
    await bot.sendMessage(chatId, `🗑 Товар удалён: ${productName} (арт. ${article})`, { parse_mode: 'HTML' });
    await showMainMenu(chatId);
});

// Команда /list (для совместимости)
bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadData();
    if (!Object.keys(data.products).length) {
        logger.info(`Список товаров пуст, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, '📭 Список отслеживаемых товаров пуст.', { parse_mode: 'HTML' });
        await showMainMenu(chatId);
        return;
    }

    logger.info(`Отправка списка товаров, chat_id: ${chatId}`);
    for (const [article, product] of Object.entries(data.products)) {
        const caption = `
🔹 <b>${product.name}</b>

Артикул: <code>${article}</code>

Цена: ${product.current_price} руб.

Добавлен: ${product.added_date}

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть на WB</a>
`;
        logger.info(`Отправка данных для артикула ${article}, imageUrl: ${product.imageUrl}`);
        if (product.imageUrl) {
            await bot.sendPhoto(chatId, product.imageUrl, {
                caption,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        } else {
            await bot.sendMessage(chatId, caption + '\n⚠️ Изображение недоступно', {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        }
    }
    await showMainMenu(chatId);
});

// Команда /check (для совместимости)
bot.onText(/\/check/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadData();
    if (!Object.keys(data.products).length) {
        logger.info(`Нет товаров для проверки, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, 'ℹ️ Нет товаров для проверки.', { parse_mode: 'HTML' });
        await showMainMenu(chatId);
        return;
    }

    logger.info(`Начинаю проверку цен, chat_id: ${chatId}`);
    await bot.sendMessage(chatId, '🔄 Начинаю проверку цен...', { parse_mode: 'HTML' });

    let updated = 0;
    const changes = [];

    for (const [article, product] of Object.entries(data.products)) {
        logger.info(`Проверка товара ${article}`);
        const productInfo = await getWbProductInfo(article);
        if (!productInfo.success) {
            const caption = `
❌ <b>${product.name}</b>

Артикул: <code>${article}</code>

Ошибка: ${productInfo.message}

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
            changes.push({ caption, imageUrl: product.imageUrl });
            continue;
        }

        const oldPrice = product.current_price;
        const newPrice = productInfo.price;

        if (newPrice !== oldPrice) {
            data.products[article].current_price = newPrice;
            data.products[article].imageUrl = productInfo.imageUrl;
            data.products[article].history.push({
                date: new Date().toISOString().slice(0, 19).replace('T', ' '),
                price: newPrice
            });
            const caption = `
🔔 <b>${product.name}</b>

Артикул: <code>${article}</code>

Старая цена: ${oldPrice} руб.

Новая цена: ${newPrice} руб.

Разница: ${(newPrice - oldPrice).toFixed(2)} руб.

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
            changes.push({ caption, imageUrl: productInfo.imageUrl });
            updated++;
        }
    }

    if (changes.length > 0) {
        logger.info(`Сохранение данных после проверки, обновлено: ${updated}`);
        await saveData(data);
        for (const change of changes) {
            logger.info(`Отправка сообщения об изменении, imageUrl: ${change.imageUrl}`);
            if (change.imageUrl) {
                await bot.sendPhoto(chatId, change.imageUrl, {
                    caption: change.caption,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            } else {
                await bot.sendMessage(chatId, change.caption + '\n⚠️ Изображение недоступно', {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            }
        }
        if (updated > 0) {
            await bot.sendMessage(chatId, `📊 Обновлено ${updated} цен`, { parse_mode: 'HTML' });
        } else {
            await bot.sendMessage(chatId, 'ℹ️ Изменений цен не обнаружено.', { parse_mode: 'HTML' });
        }
    } else {
        await bot.sendMessage(chatId, 'ℹ️ Изменений цен не обнаружено.', { parse_mode: 'HTML' });
    }
    await showMainMenu(chatId);
});

// Функция автоматической проверки цен
async function autoCheckPrices() {
    const data = await loadData();
    if (!Object.keys(data.products).length) {
        logger.info(`Нет товаров для автоматической проверки, chat_id: ${CHAT_ID}`);
        await bot.sendMessage(CHAT_ID, 'ℹ️ Нет товаров для проверки.', { parse_mode: 'HTML' });
        return;
    }

    const changes = [];

    for (const [article, product] of Object.entries(data.products)) {
        logger.info(`Автоматическая проверка товара ${article}`);
        const productInfo = await getWbProductInfo(article);
        if (!productInfo.success) {
            const caption = `
❌ <b>${product.name}</b>

Артикул: <code>${article}</code>

Ошибка: ${productInfo.message}

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
            changes.push({ caption, imageUrl: product.imageUrl });
            continue;
        }

        const oldPrice = product.current_price;
        const newPrice = productInfo.price;

        if (newPrice !== oldPrice) {
            data.products[article].current_price = newPrice;
            data.products[article].imageUrl = productInfo.imageUrl;
            data.products[article].history.push({
                date: new Date().toISOString().slice(0, 19).replace('T', ' '),
                price: newPrice
            });
            const caption = `
🔔 <b>${product.name}</b>

Артикул: <code>${article}</code>

Старая цена: ${oldPrice} руб.

Новая цена: ${newPrice} руб.

Разница: ${(newPrice - oldPrice).toFixed(2)} руб.

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
            changes.push({ caption, imageUrl: productInfo.imageUrl });
        } else {
            const caption = `
🔹 <b>${product.name}</b>

Артикул: <code>${article}</code>

Цена: ${newPrice} руб. (без изменений)

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
            changes.push({ caption, imageUrl: productInfo.imageUrl });
        }
    }

    if (changes.length > 0) {
        logger.info(`Сохранение данных после автоматической проверки`);
        await saveData(data);
        for (const change of changes) {
            logger.info(`Отправка сообщения об автоматической проверке, imageUrl: ${change.imageUrl}`);
            if (change.imageUrl) {
                await bot.sendPhoto(CHAT_ID, change.imageUrl, {
                    caption: change.caption,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            } else {
                await bot.sendMessage(CHAT_ID, change.caption + '\n⚠️ Изображение недоступно', {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            }
        }
    }
}

// Обработка ошибок
bot.on('polling_error', (error) => {
    logger.error(`Ошибка polling: ${error.message}`);
});

// Планировщик автоматической проверки (каждые 5 минут)
schedule.scheduleJob('*/5 * * * *', async () => {
    logger.info('Запуск автоматической проверки цен');
    await autoCheckPrices();
});

// Запуск бота
logger.info('Бот запущен');