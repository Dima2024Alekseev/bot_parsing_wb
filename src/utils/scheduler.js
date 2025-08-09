const schedule = require('node-schedule');
const logger = require('./logger');
const { loadJson, saveJson } = require('./fileUtils');
const { DEFAULT_NOTIFICATION_INTERVAL } = require('../config/config');

const scheduledJobs = {};

async function schedulePriceChecks(bot, checkPrices) {
    logger.info('Начало планирования проверок цен');
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

        if (scheduledJobs[chatId]) {
            scheduledJobs[chatId].cancel();
            logger.info(`Отменена предыдущая задача для chat_id: ${chatId}`);
        }

        try {
            await bot.getChat(chatId);
            scheduledJobs[chatId] = schedule.scheduleJob(cronExpression, async () => {
                logger.info(`Запуск автоматической проверки цен для chat_id: ${chatId}`);
                try {
                    await checkPrices(bot, chatId, true);
                    logger.info(`Автоматическая проверка цен успешно завершена для chat_id: ${chatId}`);
                } catch (error) {
                    logger.error(`Ошибка при автоматической проверке цен для chat_id: ${chatId}: ${error.message}`);
                }
            });
            logger.info(`Задача планировщика успешно создана для chat_id: ${chatId} с интервалом ${cronExpression}`);
        } catch (error) {
            logger.error(`Не удалось запланировать проверку для chat_id: ${chatId}, ошибка: ${error.message}`);
            try {
                const data = await loadJson();
                delete data.users[chatId];
                await saveJson(data);
                logger.info(`Пользователь chat_id: ${chatId} удален из базы данных из-за недоступности чата`);
            } catch (deleteError) {
                logger.error(`Ошибка при удалении пользователя chat_id: ${chatId} из базы данных: ${deleteError.message}`);
            }
        }
    }
    logger.info('Планирование проверок цен завершено');
}

module.exports = { schedulePriceChecks };