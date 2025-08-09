const TelegramBot = require('node-telegram-bot-api');
const { showMainMenu } = require('../utils/telegramUtils');
const { addProduct, removeProduct, listProducts, checkPrices } = require('../services/botService');
const logger = require('../utils/logger');
const { TELEGRAM_BOT_TOKEN } = require('../config/config');

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const userStates = {};

/**
 * Инициализирует обработчики сообщений и команд.
 */
function setupMessageHandlers() {
    // Команда /start
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        logger.info(`Команда /start, chat_id: ${chatId}`);
        const helpText = `
🛍️ <b>Бот для отслеживания цен на Wildberries</b>

Ваш chat_id: ${chatId}

Выберите действие ниже:
`;
        await bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
        await showMainMenu(bot, chatId);
    });

    // Команда /menu
    bot.onText(/\/menu/, async (msg) => {
        const chatId = msg.chat.id;
        logger.info(`Команда /menu, chat_id: ${chatId}`);
        await showMainMenu(bot, chatId);
    });

    // Команда /add
    bot.onText(/\/add(?:\s+(\d+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!match[1]) {
            logger.info(`Команда /add без артикула, chat_id: ${chatId}`);
            userStates[chatId] = 'awaiting_article';
            await bot.sendMessage(chatId, 'ℹ️ Введите артикул товара:', { parse_mode: 'HTML' });
            return;
        }
        await addProduct(bot, chatId, match[1]);
    });

    // Команда /remove
    bot.onText(/\/remove(?:\s+(\d+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!match[1]) {
            logger.info(`Команда /remove без артикула, chat_id: ${chatId}`);
            const data = await require('../utils/fileUtils').loadJson(require('../config/config').JSON_FILE);
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
            return;
        }
        await removeProduct(bot, chatId, match[1]);
    });

    // Команда /list
    bot.onText(/\/list/, async (msg) => {
        const chatId = msg.chat.id;
        await listProducts(bot, chatId);
    });

    // Команда /check
    bot.onText(/\/check/, async (msg) => {
        const chatId = msg.chat.id;
        await checkPrices(bot, chatId);
    });

    // Обработка текстовых сообщений (ввод артикула или нажатие кнопок)
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (text.startsWith('/')) return;

        // Обработка состояния ожидания артикула
        if (userStates[chatId] === 'awaiting_article') {
            const article = text.trim();
            if (!/^\d+$/.test(article)) {
                await bot.sendMessage(chatId, 'ℹ️ Артикул должен содержать только цифры.', { parse_mode: 'HTML' });
                await showMainMenu(bot, chatId);
                delete userStates[chatId];
                return;
            }
            await addProduct(bot, chatId, article);
            delete userStates[chatId];
            return;
        }

        // Обработка нажатий на кнопки
        switch (text) {
            case '🛒 Добавить товар':
                userStates[chatId] = 'awaiting_article';
                await bot.sendMessage(chatId, 'ℹ️ Введите артикул товара:', { parse_mode: 'HTML' });
                break;
            case '🛍️ Список товаров':
                await listProducts(bot, chatId);
                break;
            case '❌ Удалить товар':
                const data = await require('../utils/fileUtils').loadJson(require('../config/config').JSON_FILE);
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
                break;
            case '🔍 Проверить цены':
                await checkPrices(bot, chatId);
                break;
            default:
                await showMainMenu(bot, chatId); // Возвращаем меню при неизвестном сообщении
        }
    });

    // Обработка ошибок polling
    bot.on('polling_error', (error) => {
        logger.error(`Ошибка polling: ${error.message}`);
    });
}

module.exports = { setupMessageHandlers, bot, userStates };