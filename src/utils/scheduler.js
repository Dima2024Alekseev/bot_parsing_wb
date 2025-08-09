// src/utils/scheduler.js
const schedule = require('node-schedule');
const logger = require('./logger');
const { loadJson } = require('./fileUtils');
const { DEFAULT_NOTIFICATION_INTERVAL } = require('../config/config');
const { bot } = require('../handlers/messageHandlers');
const { checkPrices } = require('../services/botService');

// Объект для хранения задач планировщика
const scheduledJobs = {};

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

module.exports = { schedulePriceChecks };