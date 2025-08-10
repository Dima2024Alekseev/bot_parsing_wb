const axios = require('axios');
const { loadHostCache, saveHostCache } = require('../utils/fileUtils');
const logger = require('../utils/logger');
const { HOST_CACHE_FILE } = require('../config/config');

/**
 * Проверяет доступность изображения.
 * @param {string} url - URL изображения.
 * @param {Object} headers - Заголовки запроса.
 * @returns {Promise<boolean>} - Доступно ли изображение.
 */
async function verifyImageUrl(url, headers) {
    try {
        const response = await axios.head(url, { headers, timeout: 5000 });
        logger.info(`Изображение доступно: ${url}`);
        return response.status === 200;
    } catch (error) {
        logger.warn(`Изображение недоступно: ${url}, ошибка: ${error.message}`);
        return false;
    }
}

/**
 * Получает информацию о товаре с Wildberries.
 * @param {string} article - Артикул товара.
 * @returns {Promise<Object>} - Информация о товаре или ошибка.
 */
async function getWbProductInfo(article) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        Accept: '*/*',
        Referer: `https://www.wildberries.ru/catalog/${article}/detail.aspx`,
        Origin: 'https://www.wildberries.ru',
    };

    const nm = parseInt(article);
    const vol = Math.floor(nm / 100000);
    const part = Math.floor(nm / 1000);
    const hostCache = await loadHostCache(HOST_CACHE_FILE);
    const possibleHosts = Array.from({ length: 100 }, (_, i) => String(i + 1).padStart(2, '0'));
    let cardData = null;
    let latestPrice = 0;
    let imageUrl = '';
    let host = hostCache.products?.[vol] || possibleHosts[0];
    let reviewRating = 0; // Changed variable name to reflect reviewRating

    // Попытка запросов к серверам
    for (const attemptHost of [host, ...possibleHosts.filter(h => h !== host)]) {
        const cardUrl = `https://basket-${attemptHost}.wbbasket.ru/vol${vol}/part${part}/${article}/info/ru/card.json`;
        logger.info(`Запрос к card API: ${cardUrl}`);
        try {
            const cardResponse = await axios.get(cardUrl, { headers, timeout: 15000 });
            if (cardResponse.status === 200) {
                cardData = cardResponse.data;
                hostCache.products = hostCache.products || {};
                hostCache.products[vol] = attemptHost;
                await saveHostCache(HOST_CACHE_FILE, hostCache);
                imageUrl = `https://basket-${attemptHost}.wbbasket.ru/vol${vol}/part${part}/${article}/images/big/1.webp`;
                break;
            }
        } catch (error) {
            logger.warn(`Ошибка card API: ${error.message}, URL: ${cardUrl}`);
            continue;
        }
    }

    if (!cardData) {
        logger.error(`Не удалось получить данные card API для ${article}`);
        return { success: false, message: 'Не удалось получить данные из card API' };
    }

    // Проверка изображения
    if (imageUrl && !(await verifyImageUrl(imageUrl, headers))) {
        imageUrl = `https://basket-${hostCache.products[vol]}.wbbasket.ru/vol${vol}/part${part}/${article}/images/tm/1.webp`;
        if (!(await verifyImageUrl(imageUrl, headers))) {
            imageUrl = `https://images.wbstatic.net/big/new/${vol}/${article}-1.jpg`;
            if (!(await verifyImageUrl(imageUrl, headers))) {
                imageUrl = '';
            }
        }
    }

    // Запрос к price-history API
    const priceUrl = `https://basket-${hostCache.products[vol]}.wbbasket.ru/vol${vol}/part${part}/${article}/info/price-history.json`;
    try {
        logger.info(`Запрос к price API: ${priceUrl}`);
        const priceResponse = await axios.get(priceUrl, { headers, timeout: 15000 });
        if (priceResponse.status === 200 && priceResponse.data.length) {
            latestPrice = priceResponse.data[priceResponse.data.length - 1].price?.RUB / 100 || 0;
        }
    } catch (error) {
        logger.warn(`Ошибка price API: ${error.message}, URL: ${priceUrl}`);
    }

    // Запрос к wb_card API
    const wbCardUrl = `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=123585822&spp=30&hide_dtype=13&ab_testid=no_reranking&lang=ru&nm=${article}`;
    try {
        logger.info(`Запрос к wb_card API: ${wbCardUrl}`);
        const wbCardResponse = await axios.get(wbCardUrl, { headers, timeout: 15000 });
        if (wbCardResponse.status === 200) {
            const wbCardData = wbCardResponse.data;
            for (const product of wbCardData.products || []) {
                if (String(product.id) === article) {
                    if (product.totalQuantity === 0) {
                        logger.warn(`Товар ${article} отсутствует на складе`);
                        return { success: false, message: 'Товар отсутствует на складе' };
                    }
                    for (const size of product.sizes || []) {
                        latestPrice = (size.price?.product / 100) || latestPrice;
                        break;
                    }
                    if (product.colors?.length && product.colors[0].big_photo) {
                        imageUrl = product.colors[0].big_photo;
                        if (!(await verifyImageUrl(imageUrl, headers))) {
                            imageUrl = '';
                        }
                    }
                    // Извлекаем reviewRating из wb_card API
                    reviewRating = product.reviewRating || reviewRating;
                    break;
                }
            }
        }
    } catch (error) {
        logger.warn(`Ошибка wb_card API: ${error.message}, URL: ${wbCardUrl}`);
    }

    if (cardData.imt_name) {
        logger.info(`Успешно получены данные для ${article}, imageUrl: ${imageUrl}`);
        return {
            success: true,
            name: cardData.imt_name || 'Не указано',
            price: latestPrice,
            brand: cardData.selling?.brand_name || 'Не указано',
            rating: reviewRating, // Return reviewRating as rating
            priceWarning: latestPrice === 0 ? 'Цена недоступна' : null,
            imageUrl,
        };
    }
    logger.warn(`Отсутствуют данные card API для ${article}`);
    return { success: false, message: 'Отсутствуют ключевые данные в ответе card API' };
}

module.exports = { getWbProductInfo };