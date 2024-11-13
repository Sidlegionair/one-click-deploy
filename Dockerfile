FROM node:20

# Declare build-time arguments
ARG MOLLIE_API_KEY
ARG MOLLIE_CLIENT_ID
ARG MOLLIE_CLIENT_SECRET

# Set environment variables for runtime
ENV MOLLIE_API_KEY=${MOLLIE_API_KEY}
ENV MOLLIE_CLIENT_ID=${MOLLIE_CLIENT_ID}
ENV MOLLIE_CLIENT_SECRET=${MOLLIE_CLIENT_SECRET}

WORKDIR /usr/src/app

# Install dependencies
COPY package.json ./
COPY package-lock.json ./
RUN npm install

# Copy the source files
COPY . .

# Run the build commands
RUN npm run build && npm run build:prod

# Ensure that `dist/index.js` exists
RUN test -f dist/index.js || echo "dist/index.js not found" && exit 1

# Set the command to run the app
CMD ["node", "dist/index.js"]
