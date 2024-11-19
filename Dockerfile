FROM node:20

# Declare build-time arguments
ARG MOLLIE_API_KEY
ARG MOLLIE_CLIENT_ID
ARG MOLLIE_CLIENT_SECRET
ARG FRONTEND_URL
ARG COOKIE_SECRET

# Set environment variables for runtime
ENV MOLLIE_API_KEY=${MOLLIE_API_KEY}
ENV MOLLIE_CLIENT_ID=${MOLLIE_CLIENT_ID}
ENV MOLLIE_CLIENT_SECRET=${MOLLIE_CLIENT_SECRET}
ENV FRONTEND_URL=${FRONTEND_URL}
ENV COOKIE_SECRET=${COOKIE_SECRET}

WORKDIR /usr/src/app

# Install dependencies
COPY package.json ./
COPY yarn.lock ./
RUN yarn install

# Copy the source files
COPY . .

# Run the build commands
RUN npm run build:prod