const { setupMessageHandlers, bot } = require('./src/handlers/messageHandlers');
const { setupCallbackHandlers } = require('./src/handlers/callbackHandlers');
const { checkPrices } = require('./src/services/botService');
const { connectToMongoDB, closeMongoDB } = require('./src/utils/db');
const { schedulePriceChecks } = require('./src/utils/scheduler');
const logger = require('./src/utils/logger');

// Инициализация MongoDB
connectToMongoDB().catch(error => {
    logger.error(`Не удалось подключиться к MongoDB: ${error.message}`);
    process.exit(1);
});

// Инициализация обработчиков
setupMessageHandlers();
setupCallbackHandlers();

// Запуск планировщика
schedulePriceChecks(bot, checkPrices).catch(error => {
    logger.error(`Ошибка при запуске планировщика: ${error.message}`);
});

// Обработка завершения работы
process.on('SIGINT', async () => {
    logger.info('Завершение работы бота...');
    await closeMongoDB();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Завершение работы бота...');
    await closeMongoDB();
    process.exit(0);
});

logger.info('Бот запущен');