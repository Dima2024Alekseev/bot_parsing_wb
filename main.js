const schedule = require('node-schedule');
const logger = require('./src/utils/logger');
const { setupMessageHandlers, bot } = require('./src/handlers/messageHandlers');
const { setupCallbackHandlers } = require('./src/handlers/callbackHandlers');
const { checkPrices } = require('./src/services/botService');
const { DEFAULT_NOTIFICATION_INTERVAL } = require('./src/config/config');
const { loadJson } = require('./src/utils/fileUtils');
const { JSON_FILE } = require('./src/config/config');

// Инициализация обработчиков
setupMessageHandlers();
setupCallbackHandlers();

// Планировщик автоматической проверки для каждого пользователя
async function schedulePriceChecks() {
    const data = await loadJson(JSON_FILE);
    for (const chatId in data.users) {
        const userData = data.users[chatId];
        if (!userData.products || !Object.keys(userData.products).length) {
            logger.info(`Нет товаров для проверки у chat_id: ${chatId}`);
            continue;
        }
        const cronExpression = userData.notificationInterval || DEFAULT_NOTIFICATION_INTERVAL;
        logger.info(`Запуск планировщика для chat_id: ${chatId} с интервалом: ${cronExpression}`);
        schedule.scheduleJob(cronExpression, async () => {
            logger.info(`Запуск автоматической проверки цен для chat_id: ${chatId}`);
            await checkPrices(bot, chatId, true);
        });
    }
}

// Запуск планировщика
schedulePriceChecks();

logger.info('Бот запущен');