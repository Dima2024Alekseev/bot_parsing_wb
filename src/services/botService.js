const { loadJson, saveJson } = require('../utils/fileUtils');
const { showMainMenu, sendMessageWithPhoto } = require('../utils/telegramUtils');
const { getWbProductInfo } = require('./wbService');
const logger = require('../utils/logger');
const { JSON_FILE } = require('../config/config');

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

        data.users[chatId].products[article] = {
            name: productInfo.name,
            brand: productInfo.brand,
            current_price: productInfo.price,
            rating: productInfo.rating,
            imageUrl: productInfo.imageUrl,
            added_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
            history: [{ date: new Date().toISOString().slice(0, 19).replace('T', ' '), price: productInfo.price }],
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
        delete data.users[chatId]; // Удаляем пользователя, если у него больше нет товаров
    }
    await saveJson(JSON_FILE, data);
    await bot.sendMessage(chatId, `🗑 Товар удалён: ${productName} (арт. ${article})`, { parse_mode: 'HTML' });
    await showMainMenu(bot, chatId);
}

/**
 * Показывает список отслеживаемых товаров.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 */
async function listProducts(bot, chatId) {
    const data = await loadJson(JSON_FILE);
    if (!data.users[chatId] || !Object.keys(data.users[chatId].products).length) {
        logger.info(`Список товаров пуст, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, '📭 Список отслеживаемых товаров пуст.', { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
        return;
    }

    logger.info(`Отправка списка товаров, chat_id: ${chatId}`);
    for (const [article, product] of Object.entries(data.users[chatId].products)) {
        const caption = `
🔹 <b>${product.name}</b>

Артикул: <code>${article}</code>

Цена: ${product.current_price} руб.

Добавлен: ${product.added_date}

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть на WB</a>
`;
        await sendMessageWithPhoto(bot, chatId, caption, product.imageUrl);
    }
    await showMainMenu(bot, chatId);
}

/**
 * Проверяет цены всех отслеживаемых товаров.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 * @param {boolean} [isAuto=false] - Автоматическая проверка.
 */
async function checkPrices(bot, chatId, isAuto = false) {
    const data = await loadJson(JSON_FILE);
    if (!data.users[chatId] || !Object.keys(data.users[chatId].products).length) {
        logger.info(`Нет товаров для проверки, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, 'ℹ️ Нет товаров для проверки.', { parse_mode: 'HTML' });
        if (!isAuto) await showMainMenu(bot, chatId);
        return;
    }

    if (!isAuto) {
        await bot.sendMessage(chatId, '🔄 Начинаю проверку цен...', { parse_mode: 'HTML' });
    }

    let updated = 0;
    const changes = [];

    for (const [article, product] of Object.entries(data.users[chatId].products)) {
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
            data.users[chatId].products[article].current_price = newPrice;
            data.users[chatId].products[article].imageUrl = productInfo.imageUrl;
            data.users[chatId].products[article].history.push({
                date: new Date().toISOString().slice(0, 19).replace('T', ' '),
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
    }

    if (changes.length > 0) {
        await saveJson(JSON_FILE, data);
        for (const change of changes) {
            await sendMessageWithPhoto(bot, chatId, change.caption, change.imageUrl);
        }
        if (!isAuto && updated > 0) {
            await bot.sendMessage(chatId, `📊 Обновлено ${updated} цен`, { parse_mode: 'HTML' });
        } else if (!isAuto) {
            await bot.sendMessage(chatId, 'ℹ️ Изменений цен не обнаружено.', { parse_mode: 'HTML' });
        }
    } else if (!isAuto) {
        await bot.sendMessage(chatId, 'ℹ️ Изменений цен не обнаружено.', { parse_mode: 'HTML' });
    }

    if (!isAuto) await showMainMenu(bot, chatId);
}

module.exports = { addProduct, removeProduct, listProducts, checkPrices };