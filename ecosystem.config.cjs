module.exports = {
  apps: [
    {
      name: "kanban-server",
      script: "server/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4010,
        HOST: "127.0.0.1"
      }
    }
  ]
};
