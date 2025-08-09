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

module.exports = { showMainMenu, sendMessageWithPhoto, showNotificationMenu };