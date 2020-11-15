module.exports = {
    apps : [{
        name: 'vk_group_day_autopost',

        script: 'npm',
        args: 'run go',

        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',

        env: {
            NODE_ENV: 'development',
        },
        env_production: {
            NODE_ENV: 'production'
        }
    }],
};
