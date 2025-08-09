const logger = require('./logger');

/**
 * Показывает главное меню в Telegram.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 */
async function showMainMenu(bot, chatId) {
    const keyboard = {
        keyboard: [
            ['🛒 Добавить товар', '🛍️ Список товаров'],
            ['❌ Удалить товар', '🔍 Проверить цены'],
            ['⏰ Настроить уведомления'],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
    };
    await bot.sendMessage(chatId, 'Выберите действие:', {
        reply_markup: keyboard,
        parse_mode: 'HTML',
    });
}

/**
 * Показывает меню выбора интервала уведомлений.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 */
async function showNotificationMenu(bot, chatId) {
    const keyboard = {
        inline_keyboard: [
            [
                { text: '5 минут', callback_data: 'interval_5' },
                { text: '15 минут', callback_data: 'interval_15' },
                { text: '30 минут', callback_data: 'interval_30' },
            ],
            [
                { text: '1 час', callback_data: 'interval_60' },
                { text: '2 часа', callback_data: 'interval_120' },
            ],
            [{ text: 'Вернуться в главное меню', callback_data: 'main_menu' }],
        ],
    };
    await bot.sendMessage(chatId, 'Выберите интервал уведомлений:', {
        reply_markup: keyboard,
        parse_mode: 'HTML',
    });
}

/**
 * Отправляет сообщение с фото или без, если фото недоступно.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 * @param {string} caption - Текст сообщения.
 * @param {string} [imageUrl] - URL изображения.
 */
async function sendMessageWithPhoto(bot, chatId, caption, imageUrl) {
    logger.info(`Отправка сообщения, imageUrl: ${imageUrl || 'нет изображения'}`);
    if (imageUrl) {
        await bot.sendPhoto(chatId, imageUrl, {
            caption,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
    } else {
        await bot.sendMessage(chatId, `${caption}\n⚠️ Изображение недоступно`, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
    }
}

/**
 * Показывает товары текущей страницы с кнопками пагинации.
 * @param {Object} bot - Экземпляр Telegram-бота.
 * @param {number} chatId - ID чата.
 * @param {Array} products - Список товаров для текущей страницы.
 * @param {number} currentPage - Текущая страница.
 * @param {number} totalPages - Общее количество страниц.
 */
async function showPaginatedProducts(bot, chatId, products, currentPage, totalPages) {
    for (const [article, product] of products) {
        const caption = `
🔹 <b>${product.name}</b>

Артикул: <code>${article}</code>

Цена: ${product.current_price} руб.

Добавлен: ${product.added_date}

<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx">Открыть на WB</a>
`;
        await sendMessageWithPhoto(bot, chatId, caption, product.imageUrl);
    }

    const keyboard = {
        inline_keyboard: [],
    };

    if (totalPages > 1) {
        const navigationButtons = [];
        if (currentPage > 1) {
            navigationButtons.push({ text: '⬅️ Предыдущая', callback_data: `page_prev_${currentPage - 1}` });
        }
        if (currentPage < totalPages) {
            navigationButtons.push({ text: 'Следующая ➡️', callback_data: `page_next_${currentPage + 1}` });
        }
        keyboard.inline_keyboard.push(navigationButtons);
    }

    keyboard.inline_keyboard.push([{ text: 'Вернуться в главное меню', callback_data: 'main_menu' }]);

    await bot.sendMessage(chatId, `📄 Страница ${currentPage} из ${totalPages}`, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
    });
}

module.exports = { showMainMenu, sendMessageWithPhoto, showNotificationMenu, showPaginatedProducts };