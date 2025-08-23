require('dotenv').config();

const config = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    HOST_CACHE_FILE: process.env.HOST_CACHE_FILE || 'host_cache.json',
    DEFAULT_NOTIFICATION_INTERVAL: process.env.DEFAULT_NOTIFICATION_INTERVAL || '*/5 * * * *',
    MONGODB_URI: process.env.MONGODB_URI
};

if (!config.TELEGRAM_BOT_TOKEN || !config.CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN or CHAT_ID is not defined in .env file');
    process.exit(1);
}

module.exports = config;