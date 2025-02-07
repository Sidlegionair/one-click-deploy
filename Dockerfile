# -------------------------
# Stage 1: Build the Vendure app
# -------------------------
FROM node:20 AS builder

# Declare build-time arguments
ARG MOLLIE_API_KEY
ARG MOLLIE_CLIENT_ID
ARG MOLLIE_CLIENT_SECRET
ARG FRONTEND_URLS
ARG FRONTEND_URL
ARG COOKIE_SECRET
ARG APP_ENV

# Set environment variables for build and runtime
ENV MOLLIE_API_KEY=${MOLLIE_API_KEY} \
    MOLLIE_CLIENT_ID=${MOLLIE_CLIENT_ID} \
    MOLLIE_CLIENT_SECRET=${MOLLIE_CLIENT_SECRET} \
    FRONTEND_URLS=${FRONTEND_URLS} \
    FRONTEND_URL=${FRONTEND_URL} \
    COOKIE_SECRET=${COOKIE_SECRET} \
    APP_ENV=${APP_ENV}

WORKDIR /usr/src/app

# Copy dependency manifests and install dependencies
COPY package.json yarn.lock ./
RUN yarn install

# Install Angular CLI globally if your build requires it
RUN yarn global add @angular/cli

# Copy the source files and run the build commands
COPY . .
RUN npm run build:prod

# -------------------------
# Stage 2: Set up the runtime image with Nginx
# -------------------------
FROM node:20-slim

# Install Nginx and envsubst for runtime variable substitution
RUN apt-get update && apt-get install -y nginx gettext-base && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy the built app from the builder stage
COPY --from=builder /usr/src/app /usr/src/app

# Remove default Nginx config
RUN rm /etc/nginx/sites-enabled/default

# Copy our custom Nginx config template
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template

# Copy the startup script and ensure it’s executable
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Expose the Vendure port (if needed) and HTTP port
EXPOSE 3000
EXPOSE 80

# Let Railway start with our preferred command
CMD ["/usr/local/bin/start.sh"]
