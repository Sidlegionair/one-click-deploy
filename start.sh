#!/bin/sh
# Substitute FRONTEND_URL in the Nginx config template
envsubst '$FRONTEND_URL' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# Start the Vendure server in the background (adjust this if your entry point is different)
node dist/index.js &

# Start Nginx in the foreground
nginx -g "daemon off;"
