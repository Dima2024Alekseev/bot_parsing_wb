const { showMainMenu, showNotificationMenu } = require('../utils/telegramUtils');
const { addProduct, removeProduct, listProducts, checkPrices } = require('../services/botService');
const { bot, userStates } = require('./messageHandlers');
const logger = require('../utils/logger');
const { loadJson, saveJson } = require('../utils/fileUtils');
const { JSON_FILE } = require('../config/config');
const { schedulePriceChecks } = require('../utils/scheduler');

/**
 * Инициализирует обработчики callback-запросов.
 */
function setupCallbackHandlers() {
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const callbackData = query.data;

        logger.info(`Callback_query: ${callbackData}, chat_id: ${chatId}`);

        try {
            await bot.deleteMessage(chatId, query.message.message_id);
        } catch (error) {
            logger.warn(`Не удалось удалить сообщение: ${error.message}`);
        }

        if (callbackData === 'add_product') {
            userStates[chatId] = 'awaiting_article';
            await bot.sendMessage(chatId, 'ℹ️ Введите артикул товара:', { parse_mode: 'HTML' });
        } else if (callbackData === 'remove_product') {
            const data = await loadJson(JSON_FILE);
            if (!data.users[chatId] || !Object.keys(data.users[chatId].products).length) {
                await bot.sendMessage(chatId, '📭 Список отслеживаемых товаров пуст.', { parse_mode: 'HTML' });
                await showMainMenu(bot, chatId);
                return;
            }
            const keyboard = {
                inline_keyboard: Object.entries(data.users[chatId].products).map(([article, product]) => [
                    { text: `${product.name} (арт. ${article})`, callback_data: `remove_${article}` },
                ]),
            };
            await bot.sendMessage(chatId, 'Выберите товар для удаления:', {
                reply_markup: keyboard,
                parse_mode: 'HTML',
            });
        } else if (callbackData === 'list_products') {
            await listProducts(bot, chatId, 1);
        } else if (callbackData.startsWith('page_prev_') || callbackData.startsWith('page_next_')) {
            const page = parseInt(callbackData.split('_')[2]);
            await listProducts(bot, chatId, page);
        } else if (callbackData === 'check_prices') {
            await checkPrices(bot, chatId);
        } else if (callbackData.startsWith('remove_')) {
            const article = callbackData.split('_')[1];
            await removeProduct(bot, chatId, article);
        } else if (callbackData.startsWith('interval_')) {
            const intervalMinutes = parseInt(callbackData.split('_')[1]);
            const intervals = {
                5: '*/5 * * * *',
                15: '*/15 * * * *',
                30: '*/30 * * * *',
                60: '0 * * * *',
                120: '0 */2 * * *',
            };
            const cronExpression = intervals[intervalMinutes];
            if (cronExpression) {
                const data = await loadJson(JSON_FILE);
                data.users[chatId] = data.users[chatId] || { products: {}, notificationInterval: null };
                data.users[chatId].notificationInterval = cronExpression;
                await saveJson(JSON_FILE, data);
                await bot.sendMessage(chatId, `⏰ Интервал уведомлений установлен: каждые ${intervalMinutes} минут`, { parse_mode: 'HTML' });
                await showMainMenu(bot, chatId);
                try {
                    await schedulePriceChecks(bot, checkPrices);
                    logger.info(`Планировщик перезапущен после установки интервала ${intervalMinutes} минут для chat_id: ${chatId}`);
                } catch (error) {
                    logger.error(`Ошибка при перезапуске планировщика для chat_id: ${chatId}: ${error.message}`);
                }
            }
        } else if (callbackData === 'main_menu') {
            await showMainMenu(bot, chatId);
        }

        await bot.answerCallbackQuery(query.id);
    });
}

module.exports = { setupCallbackHandlers };