import {
    dummyPaymentHandler,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    VendureConfig,
    bootstrap,
    StockDisplayStrategy,
    RequestContext,
    ProductVariant, VendurePlugin, PluginCommonModule, DefaultLogger, LogLevel,
} from '@vendure/core';
import { defaultEmailHandlers, EmailPlugin } from '@vendure/email-plugin';
import { AssetServerPlugin, configureS3AssetStorage } from '@vendure/asset-server-plugin';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import 'dotenv/config';
import path from 'path';
import { MultivendorPlugin } from './plugins/multivendor-plugin/multivendor.plugin';
import { ReviewsPlugin } from './plugins/reviews/reviews-plugin';
import { Application } from 'express';
import {SendcloudPlugin} from "@pinelab/vendure-plugin-sendcloud";
import {compileUiExtensions} from "@vendure/ui-devkit/compiler"; // Import the Express Application type
import { ResendEmailSender } from './config/resend-email-sender';

const IS_DEV = process.env.APP_ENV === 'dev' || false;



export class ExactStockDisplayStrategy implements StockDisplayStrategy {
    getStockLevel(
        ctx: RequestContext,
        productVariant: ProductVariant,
        saleableStockLevel: number
    ): string {
        return saleableStockLevel.toString();
    }
}


export const config: VendureConfig = {
    logger: new DefaultLogger({ level: LogLevel.Debug }),
    catalogOptions: {
        stockDisplayStrategy: new ExactStockDisplayStrategy(),
    },
    apiOptions: {
        port: +(process.env.PORT || 3000),
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        ...(IS_DEV
            ? {
                adminApiPlayground: { settings: { 'request.credentials': 'include' } },
                adminApiDebug: true,
                shopApiPlayground: {
                    settings: {
                        'request.credentials': 'include',
                    },
                },
                shopApiDebug: true,
            }
            : {}),
        cors: {
            origin: (origin, callback) => {
                const allowedOrigins = process.env.FRONTEND_URLS
                    ? process.env.FRONTEND_URLS.split(',').map((url) => url.trim())
                    : ['http://localhost:3000']; // Default for local dev

                if (!origin || allowedOrigins.includes(origin)) {
                    callback(null, true); // Allow the origin
                } else {
                    callback(new Error(`Origin ${origin} is not allowed by CORS`));
                }
            },
            credentials: true, // Allow cookies with cross-origin requests
        },
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: process.env.SUPERADMIN_USERNAME,
            password: process.env.SUPERADMIN_PASSWORD,
        },
        cookieOptions: {
            ...(IS_DEV ? {} : { domain: '.boardrush.com' }),
            secret: process.env.COOKIE_SECRET,
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
        synchronize: true,
        migrations: [path.join(__dirname, './migrations/*.+(ts|js)')],
        logging: false,
        ssl: process.env.DB_CA_CERT
            ? {
                ca: process.env.DB_CA_CERT,
            }
            : undefined,
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    plugins: [
        SendcloudPlugin.init({}),
        ReviewsPlugin,
        MultivendorPlugin.init({
            platformFeePercent: 10,
            platformFeeSKU: 'FEE',
        }),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: process.env.ASSET_UPLOAD_DIR || path.join(__dirname, '../static/assets'),
            storageStrategyFactory: process.env.MINIO_ENDPOINT ? configureS3AssetStorage({
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
            }) : undefined,
        }),

        DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        EmailPlugin.init({
            transport: { type: 'none' },
            emailSender: new ResendEmailSender(process.env.RESEND_API_KEY || ''),
            // ...(IS_DEV ? { devMode: true } : {}),
            outputPath: path.join(__dirname, '../static/email/test-emails'),
            route: 'mailbox',
            handlers: defaultEmailHandlers,
            templatePath: path.join(__dirname, '../static/email/templates'),
            globalTemplateVars: {
                fromAddress: '"Boardrush" <no-reply@transactional.boardrush.com>',
                verifyEmailAddressUrl: `${process.env.FRONTEND_URL}/customer/verify`,
                passwordResetUrl: `${process.env.FRONTEND_URL}/customer/password-reset`,
                changeEmailAddressUrl: `${process.env.FRONTEND_URL}/customer/verify-email-address-change`,
            },
        }),
        AdminUiPlugin.init({
            port: 3002,
            route: 'admin',
            app: compileUiExtensions({
                // Use your existing output path; ensure it matches where your static Admin UI is built.
                outputPath: path.join(__dirname, '/admin-ui/'),
                extensions: [SendcloudPlugin.ui, ReviewsPlugin.uiExtensions, MultivendorPlugin.ui],
            }),
        })
        // AdminUiPlugin.init({
        //     port: 3002,
        //     route: 'admin',
        //     app: {
        //         path: path.join(__dirname, '/admin-ui/dist'),
        //     },
        // }),

    ],
};
