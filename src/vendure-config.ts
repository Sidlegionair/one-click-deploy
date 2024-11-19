import {
    dummyPaymentHandler,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    VendureConfig, bootstrap,
} from '@vendure/core';
import { defaultEmailHandlers, EmailPlugin } from '@vendure/email-plugin';
import { AssetServerPlugin, configureS3AssetStorage } from '@vendure/asset-server-plugin';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import 'dotenv/config';
import path from 'path';
import {MultivendorPlugin} from "./plugins/multivendor-plugin/multivendor.plugin";
import {ReviewsPlugin} from "./plugins/reviews/reviews-plugin";

const IS_DEV = process.env.APP_ENV === 'dev';

export const config: VendureConfig = {
    apiOptions: {
        port: +(process.env.PORT || 3000),
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        ...(IS_DEV
            ? {
                adminApiPlayground: { settings: { 'request.credentials': 'include' } },
                adminApiDebug: true,
            }
            : {}),
        cors: {
            origin: [
                'https://localhost:3001', // Local development
                process.env.FRONTEND_URL || 'https://platform.boardrush.com', // Production frontend URL
                process.env.VENDURE_HOST || 'https://staging-backend.boardrush.com' // Staging backend URL
            ],
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allow common HTTP methods

            credentials: true, // Allow credentials (cookies, authorization headers)
            maxAge: 86400, // Cache preflight response for 24 hours
            preflightContinue: false, // Don't pass preflight to next handler
            optionsSuccessStatus: 200 // Use 200 for successful OPTIONS requests
        },
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: process.env.SUPERADMIN_USERNAME,
            password: process.env.SUPERADMIN_PASSWORD,
        },
        cookieOptions: {
            name: {
                shop: 'shop_session',
                admin: 'admin_session',
            },
            secret: process.env.COOKIE_SECRET,
            path: '/',
            sameSite: !IS_DEV ? 'none' : 'lax',
            secure: !IS_DEV,
            secureProxy: !IS_DEV,
            httpOnly: true,
            signed: true,
            overwrite: true,
        },

    },
    dbConnectionOptions: {
        type: 'postgres',
        database: process.env.DB_NAME,
        schema: process.env.DB_SCHEMA,
        host: process.env.DB_HOST,
        port: +process.env.DB_PORT,
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        url: process.env.DB_URL,
        synchronize: false,
        migrations: [path.join(__dirname, './migrations/*.+(ts|js)')],
        logging: false,
        ssl: process.env.DB_CA_CERT ? {
            ca: process.env.DB_CA_CERT,
        } : undefined,
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    customFields: {
        Product: [{ name: 'test', type: 'string' }],
    },
    plugins: [
        ReviewsPlugin,
        MultivendorPlugin.init({
            platformFeePercent: 10,
            platformFeeSKU: 'FEE',
        }),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: process.env.ASSET_UPLOAD_DIR || path.join(__dirname, '../static/assets'),
            storageStrategyFactory: process.env.MINIO_ENDPOINT
                ? configureS3AssetStorage({
                    bucket: 'vendure-assets',
                    credentials: {
                        accessKeyId: process.env.MINIO_ACCESS_KEY,
                        secretAccessKey: process.env.MINIO_SECRET_KEY,
                    },
                    nativeS3Configuration: {
                        endpoint: process.env.MINIO_ENDPOINT,
                        forcePathStyle: true,
                        signatureVersion: 'v4',
                        region: 'eu-west-1',
                    },
                })
                : undefined,
        }),
        DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        EmailPlugin.init({
            devMode: true,
            outputPath: path.join(__dirname, '../static/email/test-emails'),
            route: 'mailbox',
            handlers: defaultEmailHandlers,
            templatePath: path.join(__dirname, '../static/email/templates'),
            globalTemplateVars: {
                fromAddress: '"example" <noreply@example.com>',
                verifyEmailAddressUrl: `${process.env.FRONTEND_URL}/verify`,
                passwordResetUrl: `${process.env.FRONTEND_URL}/password-reset`,
                changeEmailAddressUrl: `${process.env.FRONTEND_URL}/verify-email-address-change`,
            },
        }),
        AdminUiPlugin.init({
            port: 3002,
            route: 'admin',
            app: {
                path: path.join(__dirname, '/admin-ui/dist'), // Use precompiled Admin UI bundle
            },
        }),
    ],
};
