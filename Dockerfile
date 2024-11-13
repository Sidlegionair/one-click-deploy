FROM node:20

ARG RAILWAY_ENVIRONMENT

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./
RUN npm install
COPY . .
RUN npm run build:prod
