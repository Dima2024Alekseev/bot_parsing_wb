const { loadJson, saveJson } = require('../utils/fileUtils');
const { showMainMenu, sendMessageWithPhoto, showPaginatedProducts } = require('../utils/telegramUtils');
const { getWbProductInfo } = require('./wbService');
const logger = require('../utils/logger');
const { JSON_FILE } = require('../config/config');
const moment = require('moment-timezone');
const { schedulePriceChecks } = require('../../main'); // Импортируем функцию

/**
 * Добавляет товар в список отслеживания.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 * @param {string} article - Артикул товара.
 */
async function addProduct(bot, chatId, article) {
    const data = await loadJson(JSON_FILE);
    data.users[chatId] = data.users[chatId] || { products: {}, notificationInterval: null };
    
    if (data.users[chatId].products[article]) {
        logger.info(`Товар ${article} уже отслеживается, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, `ℹ️ Товар ${article} уже отслеживается!`, { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
        return;
    }

    const waitTimeout = setTimeout(async () => {
        logger.info(`Отправка сообщения ожидания для ${article}`);
        await bot.sendMessage(chatId, '⏳ Пожалуйста, подождите, идёт обработка...', { parse_mode: 'HTML' });
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
            await showMainMenu(bot, chatId);
            return;
        }

        const currentTime = moment().tz('Asia/Bangkok').format('YYYY-MM-DD HH:mm:ss'); // GMT+7
        data.users[chatId].products[article] = {
            name: productInfo.name,
            brand: productInfo.brand,
            current_price: productInfo.price,
            rating: productInfo.rating,
            imageUrl: productInfo.imageUrl,
            added_date: currentTime,
            history: [{ date: currentTime, price: productInfo.price }],
        };
        await saveJson(JSON_FILE, data);

        const caption = `
✅ <b>Товар добавлен:</b>

🏷️ Название: ${productInfo.name}

🏭 Бренд: ${productInfo.brand}

⭐ Рейтинг: ${productInfo.rating}

💰 Текущая цена: ${productInfo.priceWarning || productInfo.price + ' руб.'}

🔗 <a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Ссылка</a>
`;
        await sendMessageWithPhoto(bot, chatId, caption, productInfo.imageUrl);
        await showMainMenu(bot, chatId);
        // Перезапускаем планировщик, так как добавлен новый товар
        await schedulePriceChecks();
    } catch (error) {
        clearTimeout(waitTimeout);
        logger.error(`Ошибка при добавлении товара ${article}: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Произошла ошибка при добавлении товара ${article}. Попробуйте позже.`, {
            parse_mode: 'HTML',
        });
        await showMainMenu(bot, chatId);
    }
}

/**
 * Удаляет товар из списка отслеживания.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 * @param {string} article - Артикул товара.
 */
async function removeProduct(bot, chatId, article) {
    const data = await loadJson(JSON_FILE);
    if (!data.users[chatId] || !data.users[chatId].products[article]) {
        logger.info(`Товар ${article} не найден, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, `ℹ️ Товар ${article} не найден в списке отслеживаемых.`, { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
        return;
    }

    const productName = data.users[chatId].products[article].name;
    delete data.users[chatId].products[article];
    if (!Object.keys(data.users[chatId].products).length) {
        delete data.users[chatId];
        // Перезапускаем планировщик, так как у пользователя больше нет товаров
        await schedulePriceChecks();
    }
    await saveJson(JSON_FILE, data);
    await bot.sendMessage(chatId, `🗑 Товар удалён: ${productName} (арт. ${article})`, { parse_mode: 'HTML' });
    await showMainMenu(bot, chatId);
}

/**
 * Показывает список отслеживаемых товаров с пагинацией (1 товар на страницу).
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 * @param {number} [page=1] - Номер текущей страницы.
 */
async function listProducts(bot, chatId, page = 1) {
    const data = await loadJson(JSON_FILE);
    if (!data.users[chatId] || !Object.keys(data.users[chatId].products).length) {
        logger.info(`Нет товаров для chat_id: ${chatId}`);
        await bot.sendMessage(chatId, '📭 Список отслеживаемых товаров пуст.', { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
        return;
    }

    const products = Object.entries(data.users[chatId].products);
    const totalPages = Math.ceil(products.length);
    const productsPerPage = 1;
    const startIndex = (page - 1) * productsPerPage;
    const endIndex = startIndex + productsPerPage;
    const currentProducts = products.slice(startIndex, endIndex);

    await showPaginatedProducts(bot, chatId, currentProducts, page, totalPages);
}

/**
 * Проверяет цены всех отслеживаемых товаров пользователя.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 * @param {boolean} isAuto - Флаг автоматической проверки.
 */
async function checkPrices(bot, chatId, isAuto = false) {
    const data = await loadJson(JSON_FILE);
    if (!data.users[chatId] || !Object.keys(data.users[chatId].products).length) {
        if (!isAuto) {
            try {
                await bot.sendMessage(chatId, 'ℹ️ Нет товаров для проверки.', { parse_mode: 'HTML' });
                await showMainMenu(bot, chatId);
            } catch (error) {
                logger.error(`Не удалось отправить сообщение о пустом списке товаров для chat_id: ${chatId}: ${error.message}`);
            }
        }
        return;
    }

    if (!isAuto) {
        try {
            await bot.sendMessage(chatId, '🔄 Начинаю проверку цен...', { parse_mode: 'HTML' });
        } catch (error) {
            logger.error(`Не удалось отправить сообщение о начале проверки цен для chat_id: ${chatId}: ${error.message}`);
            return;
        }
    }

    let updated = 0;
    const changes = [];

    for (const [article, product] of Object.entries(data.users[chatId].products)) {
        logger.info(`Проверка товара ${article} для chat_id: ${chatId}`);
        try {
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
                const currentTime = moment().tz('Asia/Bangkok').format('YYYY-MM-DD HH:mm:ss'); // GMT+7
                data.users[chatId].products[article].current_price = newPrice;
                data.users[chatId].products[article].imageUrl = productInfo.imageUrl;
                data.users[chatId].products[article].history.push({
                    date: currentTime,
                    price: newPrice,
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
            } else if (isAuto) {
                const caption = `
🔹 <b>${product.name}</b>

Артикул: <code>${article}</code>

Цена: ${newPrice} руб. (без изменений)

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
                changes.push({ caption, imageUrl: productInfo.imageUrl });
            }
        } catch (error) {
            logger.error(`Ошибка при проверке товара ${article} для chat_id: ${chatId}: ${error.message}`);
            const caption = `
❌ <b>${product.name}</b>

Артикул: <code>${article}</code>

Ошибка: Не удалось проверить цену

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
            changes.push({ caption, imageUrl: product.imageUrl });
        }
    }

    if (changes.length > 0) {
        await saveJson(JSON_FILE, data);
        for (const change of changes) {
            try {
                await sendMessageWithPhoto(bot, chatId, change.caption, change.imageUrl);
                await new Promise(resolve => setTimeout(resolve, 300)); // Задержка 300 мс
            } catch (error) {
                logger.error(`Не удалось отправить сообщение для chat_id: ${chatId}: ${error.message}`);
            }
        }
        if (!isAuto && updated > 0) {
            try {
                await bot.sendMessage(chatId, `📊 Обновлено ${updated} цен`, { parse_mode: 'HTML' });
            } catch (error) {
                logger.error(`Не удалось отправить сообщение об обновлении цен для chat_id: ${chatId}: ${error.message}`);
            }
        } else if (!isAuto) {
            try {
                await bot.sendMessage(chatId, 'ℹ️ Изменений цен не обнаружено.', { parse_mode: 'HTML' });
            } catch (error) {
                logger.error(`Не удалось отправить сообщение об отсутствии изменений цен для chat_id: ${chatId}: ${error.message}`);
            }
        }
    } else if (!isAuto) {
        try {
            await bot.sendMessage(chatId, 'ℹ️ Изменений цен не обнаружено.', { parse_mode: 'HTML' });
        } catch (error) {
            logger.error(`Не удалось отправить сообщение об отсутствии изменений цен для chat_id: ${chatId}: ${error.message}`);
        }
    }

    if (!isAuto) {
        try {
            await showMainMenu(bot, chatId);
        } catch (error) {
            logger.error(`Не удалось показать главное меню для chat_id: ${chatId}: ${error.message}`);
        }
    }
}

module.exports = { addProduct, removeProduct, listProducts, checkPrices };