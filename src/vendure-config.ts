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
import { MultivendorPlugin } from "./plugins/multivendor-plugin/multivendor.plugin";
import { ReviewsPlugin } from "./plugins/reviews/reviews-plugin";

const IS_DEV = process.env.APP_ENV === 'dev';

export const config: VendureConfig = {
    apiOptions: {
        port: +(process.env.PORT || 3000),
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        ...(IS_DEV ? {
            adminApiPlayground: {
                settings: { 'request.credentials': 'include' } as any,
            },
            adminApiDebug: true,
            shopApiPlayground: {
                settings: { 'request.credentials': 'include' } as any,
            },
            shopApiDebug: true,
        } : {
            adminApiPlayground: false,
            shopApiPlayground: false,
        }),
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: process.env.SUPERADMIN_USERNAME,
            password: process.env.SUPERADMIN_PASSWORD,
        },
        cookieOptions: {
            name: { shop: 'shop-token', admin: 'admin-token' }, // Separate cookie names for shop/admin
            secret: process.env.COOKIE_SECRET,
            path: '/',           // Path for which the cookie is valid
            domain: '.boardrush.com', // Allows cookies to be shared across subdomains
            sameSite: 'none',     // Allows cross-origin cookies with `platform.boardrush.com`
            secure: true,      // Ensures cookies are sent over HTTPS in production
            httpOnly: true,       // Prevents JavaScript access to cookies for added security
            signed: true,         // Signs the cookie to prevent tampering
            overwrite: true,      // Allow the cookie to be overwritten if necessary
            maxAge: 60 * 60 * 24 * 7 * 1000, // 1 week in milliseconds
            expires: new Date(Date.now() + 60 * 60 * 24 * 7 * 1000), // Expiry date for the cookie
        },
    },
    dbConnectionOptions: {
        type: 'postgres',
        synchronize: false,
        migrations: [path.join(__dirname, './migrations/*.+(ts|js)')],
        logging: false,
        database: process.env.DB_NAME,
        schema: process.env.DB_SCHEMA,
        host: process.env.DB_HOST,
        url: process.env.DB_URL,
        port: +process.env.DB_PORT,
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_CA_CERT ? {
            ca: process.env.DB_CA_CERT,
        } : { rejectUnauthorized: false }, // Allow self-signed certs if needed
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    customFields: {
        Product: [{
            name: 'test',
            type: 'string',
        }]
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
            devMode: true,
            outputPath: path.join(__dirname, '../static/email/test-emails'),
            route: 'mailbox',
            handlers: defaultEmailHandlers,
            templatePath: path.join(__dirname, '../static/email/templates'),
            globalTemplateVars: {
                fromAddress: '"Boardrush" <noreply@boardrush.com>',
                verifyEmailAddressUrl: 'https://platform.boardrush.com/verify',
                passwordResetUrl: 'https://platform.boardrush.com/password-reset',
                changeEmailAddressUrl: 'https://platform.boardrush.com/verify-email-address-change'
            },
        }),
        AdminUiPlugin.init({
            port: 3002,
            route: 'admin',
            app: {
                path: path.join(__dirname, '/admin-ui/dist'),
            },
        }),
    ],
};

// Optional: Uncomment to set the superadmin email address if needed
// bootstrap(config).then(async (app) => {
//     const connection: Connection = app.get(Connection);
//     await connection
//         .getRepository('Administrator')
//         .update({ identifier: process.env.SUPERADMIN_USERNAME }, { emailAddress: 'superadmin@example.com' });
//     console.log('Superadmin email address set to superadmin@example.com');
// }).catch(err => {
//     console.error(err);
// });
