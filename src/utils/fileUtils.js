const { getCollection, validateUserData } = require('./db');
const logger = require('./logger');
const fs = require('fs').promises;

/**
 * Загружает данные пользователей из MongoDB.
 * @param {string} filePath - Путь к файлу (игнорируется, для совместимости).
 * @returns {Promise<Object>} - Данные в формате { users: { [chatId]: { products, notificationInterval } } }
 */
async function loadJson(filePath) {
    try {
        const collection = await getCollection();
        const users = await collection.find({}).toArray();
        const usersData = { users: {} };
        users.forEach(user => {
            usersData.users[user.chatId] = {
                products: user.products || {},
                notificationInterval: user.notificationInterval || null
            };
        });
        logger.info('Данные пользователей загружены из MongoDB');
        return usersData;
    } catch (error) {
        logger.error(`Ошибка загрузки данных из MongoDB: ${error.message}`);
        return { users: {} };
    }
}

/**
 * Сохраняет данные пользователей в MongoDB.
 * @param {string} filePath - Путь к файлу (игнорируется, для совместимости).
 * @param {Object} data - Данные в формате { users: { [chatId]: { products, notificationInterval } } }
 */
async function saveJson(filePath, data) {
    try {
        const collection = await getCollection();
        for (const [chatId, userData] of Object.entries(data.users)) {
            const validatedData = validateUserData({ chatId, ...userData });
            await collection.updateOne(
                { chatId: validatedData.chatId },
                { $set: { products: validatedData.products, notificationInterval: validatedData.notificationInterval } },
                { upsert: true }
            );
        }
        // Удаляем пользователей, отсутствующих в новых данных
        const existingChatIds = Object.keys(data.users);
        await collection.deleteMany({ chatId: { $nin: existingChatIds } });
        logger.info('Данные пользователей сохранены в MongoDB');
    } catch (error) {
        logger.error(`Ошибка сохранения данных в MongoDB: ${error.message}`);
    }
}

/**
 * Загружает данные из host_cache.json
 * @param {string} filePath - Путь к файлу.
 * @returns {Promise<Object>} - Данные кэша хостов.
 */
async function loadHostCache(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        if (!data.trim()) { // Проверка на пустой файл
            logger.info(`Файл ${filePath} пуст, возвращается пустой объект`);
            return { products: {} };
        }
        logger.info(`Успешно загружен файл ${filePath}: ${data}`);
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.info(`Файл ${filePath} не найден, возвращается пустой объект`);
            return { products: {} };
        }
        logger.error(`Ошибка чтения ${filePath}: ${error.message}`);
        throw error;
    }
}

/**
 * Сохраняет данные в host_cache.json
 * @param {string} filePath - Путь к файлу.
 * @param {Object} data - Данные для сохранения.
 */
async function saveHostCache(filePath, data) {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        logger.info(`Данные успешно сохранены в ${filePath}: ${JSON.stringify(data)}`);
    } catch (error) {
        logger.error(`Ошибка записи в ${filePath}: ${error.message}`);
        throw error;
    }
}

module.exports = { loadJson, saveJson, loadHostCache, saveHostCache };