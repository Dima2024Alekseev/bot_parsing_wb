const schedule = require('node-schedule');
const logger = require('./src/utils/logger');
const { setupMessageHandlers, bot } = require('./src/handlers/messageHandlers');
const { setupCallbackHandlers } = require('./src/handlers/callbackHandlers');
const { checkPrices } = require('./src/services/botService');
const { CHAT_ID } = require('./src/config/config');

// Инициализация обработчиков
setupMessageHandlers();
setupCallbackHandlers();

// Планировщик автоматической проверки (каждые 5 минут)
schedule.scheduleJob('*/5 * * * *', async () => {
  logger.info('Запуск автоматической проверки цен');
  await checkPrices(bot, CHAT_ID, true);
});

logger.info('Бот запущен');