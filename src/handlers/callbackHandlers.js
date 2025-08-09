const { showMainMenu } = require('../utils/telegramUtils');
const { addProduct, removeProduct, listProducts, checkPrices } = require('../services/botService');
const { bot, userStates } = require('./messageHandlers');
const logger = require('../utils/logger');
const { loadJson } = require('../utils/fileUtils');
const { JSON_FILE } = require('../config/config');

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
            if (!Object.keys(data.products).length) {
                await bot.sendMessage(chatId, '📭 Список отслеживаемых товаров пуст.', { parse_mode: 'HTML' });
                await showMainMenu(bot, chatId);
                return;
            }
            const keyboard = {
                inline_keyboard: Object.entries(data.products).map(([article, product]) => [
                    { text: `${product.name} (арт. ${article})`, callback_data: `remove_${article}` },
                ]),
            };
            await bot.sendMessage(chatId, 'Выберите товар для удаления:', {
                reply_markup: keyboard,
                parse_mode: 'HTML',
            });
        } else if (callbackData === 'list_products') {
            await listProducts(bot, chatId);
        } else if (callbackData === 'check_prices') {
            await checkPrices(bot, chatId);
        } else if (callbackData.startsWith('remove_')) {
            const article = callbackData.split('_')[1];
            await removeProduct(bot, chatId, article);
        }

        await bot.answerCallbackQuery(query.id);
    });
}

module.exports = { setupCallbackHandlers };