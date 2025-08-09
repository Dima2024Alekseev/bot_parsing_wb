require('dotenv').config();

const config = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    CHAT_ID: process.env.CHAT_ID || '',
    JSON_FILE: process.env.JSON_FILE || 'wb_products.json',
    HOST_CACHE_FILE: process.env.HOST_CACHE_FILE || 'host_cache.json',
};

if (!config.TELEGRAM_BOT_TOKEN || !config.CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN or CHAT_ID is not defined in .env file');
    process.exit(1);
}

module.exports = config;