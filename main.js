const schedule = require('node-schedule');
const logger = require('./src/utils/logger');
const { setupMessageHandlers, bot } = require('./src/handlers/messageHandlers');
const { setupCallbackHandlers } = require('./src/handlers/callbackHandlers');
const { checkPrices } = require('./src/services/botService');
const { DEFAULT_NOTIFICATION_INTERVAL } = require('./src/config/config');
const { loadJson } = require('./src/utils/fileUtils');
const { connectToMongoDB, closeMongoDB } = require('./src/utils/db');

// Объект для хранения задач планировщика
const scheduledJobs = {};

// Инициализация MongoDB
connectToMongoDB().catch(error => {
    logger.error(`Не удалось подключиться к MongoDB: ${error.message}`);
    process.exit(1);
});

// Инициализация обработчиков
setupMessageHandlers();
setupCallbackHandlers();

// Планировщик автоматической проверки для каждого пользователя
async function schedulePriceChecks() {
    const data = await loadJson();
    logger.info(`Загружено ${Object.keys(data.users).length} пользователей для планирования проверок`);

    for (const chatId in data.users) {
        const userData = data.users[chatId];
        if (!userData.products || !Object.keys(userData.products).length) {
            logger.info(`Нет товаров для проверки у chat_id: ${chatId}`);
            continue;
        }
        const cronExpression = userData.notificationInterval || DEFAULT_NOTIFICATION_INTERVAL;
        logger.info(`Запуск планировщика для chat_id: ${chatId} с интервалом: ${cronExpression}`);

        // Отменяем существующую задачу, если она есть
        if (scheduledJobs[chatId]) {
            scheduledJobs[chatId].cancel();
            logger.info(`Отменена предыдущая задача для chat_id: ${chatId}`);
        }

        try {
            // Проверяем, доступен ли чат
            await bot.getChat(chatId);
            // Создаем новую задачу
            scheduledJobs[chatId] = schedule.scheduleJob(cronExpression, async () => {
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

// Обработка завершения работы
process.on('SIGINT', async () => {
    logger.info('Завершение работы бота...');
    for (const chatId in scheduledJobs) {
        scheduledJobs[chatId].cancel();
        logger.info(`Остановлена задача для chat_id: ${chatId}`);
    }
    await closeMongoDB();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Завершение работы бота...');
    for (const chatId in scheduledJobs) {
        scheduledJobs[chatId].cancel();
        logger.info(`Остановлена задача для chat_id: ${chatId}`);
    }
    await closeMongoDB();
    process.exit(0);
});

logger.info('Бот запущен');

// Экспортируем функцию для использования в callbackHandlers.js
module.exports = { schedulePriceChecks };