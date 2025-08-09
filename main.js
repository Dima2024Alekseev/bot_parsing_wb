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
    logger.info(`Загружено ${Object.keys(data.users).length} пользователей для планирования проверок`);
    
    for (const chatId in data.users) {
        const userData = data.users[chatId];
        if (!userData.products || !Object.keys(userData.products).length) {
            logger.info(`Нет товаров для проверки у chat_id: ${chatId}`);
            continue;
        }
        const cronExpression = userData.notificationInterval || DEFAULT_NOTIFICATION_INTERVAL;
        logger.info(`Запуск планировщика для chat_id: ${chatId} с интервалом: ${cronExpression}`);
        
        try {
            // Проверяем, доступен ли чат
            await bot.getChat(chatId);
            schedule.scheduleJob(cronExpression, async () => {
                logger.info(`Запуск автоматической проверки цен для chat_id: ${chatId}`);
                try {
                    await checkPrices(bot, chatId, true);
                    logger.info(`Автоматическая проверка цен завершена для chat_id: ${chatId}`);
                } catch (error) {
                    logger.error(`Ошибка при автоматической проверке цен для chat_id: ${chatId}: ${error.message}`);
                }
            });
        } catch (error) {
            logger.error(`Не удалось запланировать проверку для chat_id: ${chatId}, ошибка: ${error.message}`);
        }
    }
}

// Запуск планировщика
schedulePriceChecks().catch(error => {
    logger.error(`Ошибка при запуске планировщика: ${error.message}`);
});

logger.info('Бот запущен');