const { loadJson, saveJson } = require('../utils/fileUtils');
const { showMainMenu, sendMessageWithPhoto, showPaginatedProducts } = require('../utils/telegramUtils');
const { getWbProductInfo } = require('./wbService');
const logger = require('../utils/logger');
const { JSON_FILE } = require('../config/config');
const moment = require('moment-timezone');
const { schedulePriceChecks } = require('../utils/scheduler');

const lastCommandTime = {};

/**
 * Добавляет товар в список отслеживания.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 * @param {string} article - Артикул товара.
 */
async function addProduct(bot, chatId, article) {
    if (!/^\d{7,9}$/.test(article)) {
        logger.info(`Некорректный артикул ${article} для chat_id: ${chatId}`);
        await bot.sendMessage(chatId, 'ℹ️ Артикул должен содержать от 7 до 9 цифр.', { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
        return;
    }

    const data = await loadJson(JSON_FILE);
    data.users[chatId] = data.users[chatId] || { products: {}, notificationInterval: null };

    if (Object.keys(data.users[chatId].products).length >= 50) {
        logger.info(`Достигнут лимит товаров для chat_id: ${chatId}`);
        await bot.sendMessage(chatId, '🚫 Достигнут лимит в 50 товаров. Удалите некоторые товары, чтобы добавить новые.', { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
        return;
    }

    if (data.users[chatId].products[article]) {
        logger.info(`Товар ${article} уже отслеживается, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, `ℹ️ Товар ${article} уже отслеживается!`, { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
        return;
    }

    const waitTimeout = setTimeout(async () => {
        logger.info(`Отправка сообщения ожидания для ${article}, chat_id: ${chatId}`);
        await bot.sendMessage(chatId, '⏳ Пожалуйста, подождите, идёт обработка...', { parse_mode: 'HTML' });
    }, 5000);

    try {
        const productInfo = await getWbProductInfo(article);
        clearTimeout(waitTimeout);

        if (!productInfo.success) {
            let errorMsg = `
❌ Не удалось получить данные о товаре с артикулом ${article}.

Проверьте артикул: <a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">ссылка</a>

Возможные причины:
1. Товар не существует
2. Ограничения Wildberries
3. Проблемы с сетью

Попробуйте позже или используйте VPN.
`;
            if (productInfo.message === 'Товар удалён или не существует') {
                errorMsg = `❌ Товар с артикулом ${article} удалён продавцом на Wildberries и не может быть добавлен.`;
            }
            logger.warn(`Не удалось добавить товар ${article}: ${productInfo.message}, chat_id: ${chatId}`);
            await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
            await showMainMenu(bot, chatId);
            return;
        }

        const currentTime = moment().tz('Asia/Bangkok').format('YYYY-MM-DD HH:mm:ss');
        data.users[chatId].products[article] = {
            name: productInfo.name,
            brand: productInfo.brand,
            current_price: productInfo.price,
            quantity: productInfo.quantity, // Добавляем quantity
            rating: productInfo.rating,
            imageUrl: productInfo.imageUrl,
            added_date: currentTime,
            history: [{ date: currentTime, price: productInfo.price, quantity: productInfo.quantity }], // Добавляем quantity в историю
        };
        await saveJson(JSON_FILE, data);

        let caption = `
✅ <b>Товар добавлен:</b>

🏷️ Название: ${productInfo.name}

🏭 Бренд: ${productInfo.brand}

⭐ Рейтинг: ${productInfo.rating}

💰 Текущая цена: ${productInfo.priceWarning || productInfo.price + ' руб.'}

📦 Количество на складе: ${productInfo.quantity} шт.

🔗 <a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Ссылка</a>
`;
        if (productInfo.rating < 3) {
            caption += '\n⚠️ Товар имеет низкий рейтинг!';
        }
        if (productInfo.quantityWarning) {
            caption += `\n⚠️ ${productInfo.quantityWarning}`;
        }

        await sendMessageWithPhoto(bot, chatId, caption, productInfo.imageUrl);
        await showMainMenu(bot, chatId);
        try {
            await schedulePriceChecks(bot, checkPrices);
            logger.info(`Планировщик перезапущен после добавления товара ${article} для chat_id: ${chatId}`);
        } catch (error) {
            logger.error(`Ошибка при перезапуске планировщика после добавления товара ${article} для chat_id: ${chatId}: ${error.message}`);
        }
        logger.info(`Товар ${article} успешно добавлен для chat_id: ${chatId}`);
    } catch (error) {
        clearTimeout(waitTimeout);
        logger.error(`Ошибка при добавлении товара ${article} для chat_id: ${chatId}: ${error.message}`);
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
    logger.info(`Попытка удаления товара ${article} для chat_id: ${chatId}`);

    try {
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
            try {
                await schedulePriceChecks(bot, checkPrices);
                logger.info(`Планировщик перезапущен после удаления всех товаров для chat_id: ${chatId}`);
            } catch (error) {
                logger.error(`Ошибка при перезапуске планировщика после удаления всех товаров для chat_id: ${chatId}: ${error.message}`);
            }
        }
        await saveJson(JSON_FILE, data);
        await bot.sendMessage(chatId, `🗑️ Товар удалён: ${productName} (арт. ${article})`, { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
        logger.info(`Товар ${article} успешно удалён для chat_id: ${chatId}`);
    } catch (error) {
        logger.error(`Ошибка при удалении товара ${article} для chat_id: ${chatId}: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Произошла ошибка при удалении товара ${article}. Попробуйте позже.`, { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
    }
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

    for (const [article, product] of currentProducts) {
        const caption = `
🔹 <b>${product.name}</b>

Артикул: <code>${article}</code>

Цена: ${product.current_price} руб.

Количество на складе: ${product.quantity} шт.

Добавлен: ${product.added_date}

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть на WB</a>
`;
        if (product.quantity === 0) {
            caption += '\n⚠️ Товар отсутствует на складе!';
        }
        await sendMessageWithPhoto(bot, chatId, caption, product.imageUrl);
    }

    const keyboard = {
        inline_keyboard: [],
    };

    if (totalPages > 1) {
        const navigationButtons = [];
        if (page > 1) {
            navigationButtons.push({ text: '⬅️ Предыдущая', callback_data: `page_prev_${page - 1}` });
        }
        if (page < totalPages) {
            navigationButtons.push({ text: 'Следующая ➡️', callback_data: `page_next_${page + 1}` });
        }
        keyboard.inline_keyboard.push(navigationButtons);
    }

    keyboard.inline_keyboard.push([{ text: 'Вернуться в главное меню', callback_data: 'main_menu' }]);

    await bot.sendMessage(chatId, `📄 Страница ${page} из ${totalPages}`, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
    });
    logger.info(`Список товаров показан для chat_id: ${chatId}, страница: ${page}`);
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
                logger.info(`Нет товаров для проверки для chat_id: ${chatId}`);
            } catch (error) {
                logger.error(`Не удалось отправить сообщение о пустом списке товаров для chat_id: ${chatId}: ${error.message}`);
            }
        }
        return;
    }

    if (!isAuto) {
        try {
            await bot.sendMessage(chatId, '🔄 Начинаю проверку цен...', { parse_mode: 'HTML' });
            logger.info(`Начало проверки цен для chat_id: ${chatId}`);
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
                let caption = `
❌ <b>${product.name}</b>

Артикул: <code>${article}</code>

Ошибка: ${productInfo.message}

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
                if (productInfo.message === 'Товар удалён или не существует') {
                    caption = `
🗑️ <b>${product.name}</b> (арт. <code>${article}</code>) был удалён продавцом на Wildberries!

Товар удалён из вашего списка отслеживания.

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Проверить</a>
`;
                    delete data.users[chatId].products[article];
                    await saveJson(JSON_FILE, data);
                    if (!Object.keys(data.users[chatId].products).length) {
                        delete data.users[chatId];
                        await saveJson(JSON_FILE, data);
                        try {
                            await schedulePriceChecks(bot, checkPrices);
                            logger.info(`Планировщик перезапущен после удаления всех товаров для chat_id: ${chatId}`);
                        } catch (error) {
                            logger.error(`Ошибка при перезапуске планировщика после удаления всех товаров для chat_id: ${chatId}: ${error.message}`);
                        }
                    }
                }
                changes.push({ caption, imageUrl: product.imageUrl });
                continue;
            }

            const oldPrice = product.current_price;
            const oldQuantity = product.quantity || 0; // Добавляем, учитываем старые данные без quantity
            const newPrice = productInfo.price;
            const newQuantity = productInfo.quantity;

            let changeMessage = '';
            if (newPrice !== oldPrice) {
                changeMessage += `
Старая цена: ${oldPrice} руб.
Новая цена: ${newPrice} руб.
Разница: ${(newPrice - oldPrice).toFixed(2)} руб.
`;
            }
            if (newQuantity !== oldQuantity) {
                changeMessage += `
Старое количество: ${oldQuantity} шт.
Новое количество: ${newQuantity} шт.
Разница: ${newQuantity - oldQuantity} шт.
`;
            }

            if (changeMessage) {
                const currentTime = moment().tz('Asia/Bangkok').format('YYYY-MM-DD HH:mm:ss');
                data.users[chatId].products[article].current_price = newPrice;
                data.users[chatId].products[article].quantity = newQuantity;
                data.users[chatId].products[article].imageUrl = productInfo.imageUrl;
                data.users[chatId].products[article].history.push({
                    date: currentTime,
                    price: newPrice,
                    quantity: newQuantity
                });
                const caption = `
🔔 <b>${product.name}</b>

Артикул: <code>${article}</code>
${changeMessage}
<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
                if (productInfo.quantityWarning) {
                    caption += `\n⚠️ ${productInfo.quantityWarning}`;
                }
                changes.push({ caption, imageUrl: productInfo.imageUrl });
                updated++;
            } else if (isAuto) {
                const caption = `
🔹 <b>${product.name}</b>

Артикул: <code>${article}</code>

Цена: ${newPrice} руб. (без изменений)

Количество: ${newQuantity} шт. (без изменений)

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть</a>
`;
                changes.push({ caption, imageUrl: productInfo.imageUrl });
            }
        } catch (error) {
            logger.error(`Ошибка при проверке товара ${article} для chat_id: ${chatId}: ${error.message}`);
            const caption = `
❌ <b>${product.name}</b>

Артикул: <code>${article}</code>

Ошибка: Не удалось проверить цену или количество

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
                await new Promise(resolve => setTimeout(resolve, 300));
                logger.info(`Сообщение об изменении отправлено для chat_id: ${chatId}, артикул: ${change.caption.match(/Артикул: <code>(\d+)<\/code>/)?.[1]}`);
            } catch (error) {
                logger.error(`Не удалось отправить сообщение для chat_id: ${chatId}: ${error.message}`);
            }
        }
        if (!isAuto && updated > 0) {
            try {
                await bot.sendMessage(chatId, `📊 Обновлено ${updated} записей (цены или количество)`, { parse_mode: 'HTML' });
                logger.info(`Отправлено сообщение об обновлении ${updated} записей для chat_id: ${chatId}`);
            } catch (error) {
                logger.error(`Не удалось отправить сообщение об обновлении записей для chat_id: ${chatId}: ${error.message}`);
            }
        } else if (!isAuto) {
            try {
                await bot.sendMessage(chatId, 'ℹ️ Изменений цен или количества не обнаружено.', { parse_mode: 'HTML' });
                logger.info(`Отправлено сообщение об отсутствии изменений для chat_id: ${chatId}`);
            } catch (error) {
                logger.error(`Не удалось отправить сообщение об отсутствии изменений для chat_id: ${chatId}: ${error.message}`);
            }
        }
    } else if (!isAuto) {
        try {
            await bot.sendMessage(chatId, 'ℹ️ Изменений цен или количества не обнаружено.', { parse_mode: 'HTML' });
            logger.info(`Отправлено сообщение об отсутствии изменений для chat_id: ${chatId}`);
        } catch (error) {
            logger.error(`Не удалось отправить сообщение об отсутствии изменений для chat_id: ${chatId}: ${error.message}`);
        }
    }

    if (!isAuto) {
        try {
            await showMainMenu(bot, chatId);
            logger.info(`Главное меню показано для chat_id: ${chatId}`);
        } catch (error) {
            logger.error(`Не удалось показать главное меню для chat_id: ${chatId}: ${error.message}`);
        }
    }
    logger.info(`Проверка цен и количества завершена для chat_id: ${chatId}, обновлено: ${updated} записей`);
}

module.exports = { addProduct, removeProduct, listProducts, checkPrices };