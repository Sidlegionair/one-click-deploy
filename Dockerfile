FROM node:20

# Declare build-time arguments
ARG MOLLIE_API_KEY
ARG MOLLIE_CLIENT_ID
ARG MOLLIE_CLIENT_SECRET
ARG FRONTEND_URLS
ARG FRONTEND_URL
ARG VENDURE_HOST
ARG COOKIE_SECRET
ARG APP_ENV
ARG RESEND_API_KEY
ARG KLAVIYO_API_KEY

# Set environment variables for runtime
ENV MOLLIE_API_KEY=${MOLLIE_API_KEY}
ENV MOLLIE_CLIENT_ID=${MOLLIE_CLIENT_ID}
ENV MOLLIE_CLIENT_SECRET=${MOLLIE_CLIENT_SECRET}
ENV FRONTEND_URLS=${FRONTEND_URLS}
ENV VENDURE_HOST=${VENDURE_HOST}
ENV COOKIE_SECRET=${COOKIE_SECRET}
ENV APP_ENV=${APP_ENV}
ENV RESEND_API_KEY=${RESEND_API_KEY}
ENV FRONTEND_URL=${FRONTEND_URL}
ENV KLAVIYO_API_KEY=${KLAVIYO_API_KEY}


# Railway Volume Mount Path (Automatically provided)
ENV STATIC_ASSETS_PATH="/static/assets"

WORKDIR /usr/src/app

# Install dependencies
COPY package.json ./
COPY yarn.lock ./
RUN yarn install

# Install Angular CLI globally to make 'ng' command available
RUN yarn global add @angular/cli

# Copy the source files
COPY . .


# Ensure /static/assets exists and has correct permissions
RUN mkdir -p $STATIC_ASSETS_PATH && chmod -R 777 $STATIC_ASSETS_PATH



# Run the build commands
RUN npm run build:prod
