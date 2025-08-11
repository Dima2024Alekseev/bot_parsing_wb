const { MongoClient } = require('mongodb');
const logger = require('./logger');
const { MONGODB_URI } = require('../config/config');

const DB_NAME = 'huligan-sport';
const COLLECTION_NAME = 'users';

let client = null;
let db = null;

/**
 * Валидирует структуру данных пользователя.
 * @param {Object} userData - Данные пользователя.
 * @returns {Object} - Валидированные данные пользователя.
 * @throws {Error} - Если структура данных некорректна.
 */
function validateUserData(userData) {
    if (!userData || typeof userData !== 'object') {
        throw new Error('Данные пользователя должны быть объектом');
    }

    const validatedData = {
        chatId: String(userData.chatId),
        products: {},
        notificationInterval: userData.notificationInterval ? String(userData.notificationInterval) : null
    };

    if (userData.products) {
        for (const [article, product] of Object.entries(userData.products)) {
            if (typeof article !== 'string' || !/^\d+$/.test(article)) {
                throw new Error(`Некорректный артикул товара: ${article}`);
            }
            validatedData.products[article] = {
                name: String(product.name || 'Не указано'),
                brand: String(product.brand || 'Не указано'),
                current_price: Number(product.current_price) || 0,
                quantity: Number(product.quantity) || 0, // Добавляем поле quantity
                rating: Number(product.rating) || 0,
                imageUrl: String(product.imageUrl || ''),
                added_date: String(product.added_date || new Date().toISOString()),
                history: Array.isArray(product.history) ? product.history.map(entry => ({
                    date: String(entry.date || new Date().toISOString()),
                    price: Number(entry.price) || 0,
                    quantity: Number(entry.quantity) || 0 // Добавляем quantity в историю
                })) : [{ 
                    date: String(product.added_date || new Date().toISOString()), 
                    price: Number(product.current_price) || 0,
                    quantity: Number(product.quantity) || 0 // Инициализация quantity в истории
                }]
            };
        }
    }

    return validatedData;
}

/**
 * Подключается к MongoDB и создает индекс для chatId.
 * @returns {Promise<void>}
 */
async function connectToMongoDB() {
    if (client && db) {
        return;
    }
    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        await collection.createIndex({ chatId: 1 }, { unique: true });
        logger.info('Успешно подключено к MongoDB, индекс для chatId создан');
    } catch (error) {
        logger.error(`Ошибка подключения к MongoDB: ${error.message}`);
        throw error;
    }
}

/**
 * Получает коллекцию user_wb.
 * @returns {Promise<Collection>}
 */
async function getCollection() {
    if (!db) {
        await connectToMongoDB();
    }
    return db.collection(COLLECTION_NAME);
}

/**
 * Закрывает соединение с MongoDB.
 * @returns {Promise<void>}
 */
async function closeMongoDB() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        logger.info('Соединение с MongoDB закрыто');
    }
}

module.exports = { connectToMongoDB, getCollection, closeMongoDB, validateUserData };