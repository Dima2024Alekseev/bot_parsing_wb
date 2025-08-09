require('dotenv').config();

const config = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    CHAT_ID: process.env.CHAT_ID || '',
    JSON_FILE: process.env.JSON_FILE || 'wb_products.json',
    HOST_CACHE_FILE: process.env.HOST_CACHE_FILE || 'host_cache.json',
    DEFAULT_NOTIFICATION_INTERVAL: process.env.DEFAULT_NOTIFICATION_INTERVAL || '*/5 * * * *', // Default: every 5 minutes
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://user:qadcdczs38281@cluster0.gc2mk.mongodb.net/huligan-sport?retryWrites=true&w=majority&appName=Cluster0'
};

if (!config.TELEGRAM_BOT_TOKEN || !config.CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN or CHAT_ID is not defined in .env file');
    process.exit(1);
}

module.exports = config;