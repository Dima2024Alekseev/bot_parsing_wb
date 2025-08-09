const fs = require('fs').promises;
const logger = require('./logger');

/**
 * Загружает данные из JSON-файла.
 * @param {string} filePath - Путь к файлу.
 * @returns {Promise<Object>} - Данные из файла или пустой объект.
 */
async function loadJson(filePath) {
    try {
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (!exists) {
            logger.info(`Файл ${filePath} не существует, возвращается пустой объект`);
            return { users: {} };
        }

        const content = await fs.readFile(filePath, 'utf-8');
        if (!content.trim()) {
            logger.info(`Файл ${filePath} пуст, возвращается пустой объект`);
            return { users: {} };
        }

        const data = JSON.parse(content);
        return { users: data.users || {} };
    } catch (error) {
        logger.error(`Ошибка загрузки ${filePath}: ${error.message}`);
        return { users: {} };
    }
}

/**
 * Сохраняет данные в JSON-файл.
 * @param {string} filePath - Путь к файлу.
 * @param {Object} data - Данные для сохранения.
 */
async function saveJson(filePath, data) {
    try {
        await fs.writeFile(filePath, JSON.stringify({ users: data.users }, null, 2), 'utf-8');
        logger.info(`Данные успешно сохранены в ${filePath}`);
    } catch (error) {
        logger.error(`Ошибка сохранения ${filePath}: ${error.message}`);
    }
}

module.exports = { loadJson, saveJson };