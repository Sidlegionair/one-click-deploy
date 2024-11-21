import * as path from 'path';


import { OnApplicationBootstrap } from '@nestjs/common';
import {
    EventBus,
    IdentifierChangeEvent,
    Logger,
    Channel,
    ChannelService,
    configureDefaultOrderProcess,
    DefaultProductVariantPriceUpdateStrategy,
    LanguageCode,
    PaymentMethod,
    PaymentMethodService,
    PluginCommonModule,
    RequestContextService,
    TransactionalConnection,
    VendurePlugin,
    AdministratorService,
    RoleService,
    ShippingMethodService,
    StockLocationService, Permission, StockLocation, SellerEvent, CustomSellerFields, ID, Customer, Seller,
} from '@vendure/core';

import { AdminUiExtension } from '@vendure/ui-devkit/compiler';



import { shopApiExtensions } from './api/api-extensions';
import { MultivendorResolver } from './api/mv.resolver';
import { multivendorOrderProcess } from './config/mv-order-process';
import { MultivendorSellerStrategy } from './config/mv-order-seller-strategy';
import { molliePaymentMethodHandler } from './config/mv-payment-handler';
import { multivendorShippingEligibilityChecker } from './config/mv-shipping-eligibility-checker';
import { MultivendorShippingLineAssignmentStrategy } from './config/mv-shipping-line-assignment-strategy';
import { CONNECTED_PAYMENT_METHOD_CODE, MULTIVENDOR_PLUGIN_OPTIONS } from './constants';
import { MultivendorService } from './service/mv.service';
import { CreateSellerInput, MultivendorPluginOptions } from './types';
import { channel } from 'node:diagnostics_channel';
import { compileUiExtensions } from '@vendure/ui-devkit/compiler';
import { MollieController } from './controllers/mollie.controller';



/**
 * @description
 * This is an example of how to implement a multivendor marketplace app using the new features introduced in
 * Vendure v2.0.
 *
 * ## Setup
 *
 * Add this plugin to your VendureConfig:
 * ```ts
 *  plugins: [
 *    MultivendorPlugin.init({
 *        platformFeePercent: 10,
 *        platformFeeSKU: 'FEE',
 *    }),
 *    // ...
 *  ]
 * ```
 *
 * ## Create a Seller
 *
 * Now you can create new sellers with the following mutation:
 *
 * ```graphql
 * mutation RegisterSeller {
 *   registerNewSeller(input: {
 *     shopName: "Bob's Parts",
 *     seller {
 *       firstName: "Bob"
 *       lastName: "Dobalina"
 *       emailAddress: "bob@bobs-parts.com"
 *       password: "test",
 *     }
 *   }) {
 *     id
 *     code
 *     token
 *   }
 * }
 * ```
 *
 * This mutation will:
 *
 * - Create a new Seller representing the shop "Bob's Parts"
 * - Create a new Channel and associate it with the new Seller
 * - Create a Role & Administrator for Bob to access his shop admin account
 * - Create a ShippingMethod for Bob's shop
 * - Create a StockLocation for Bob's shop
 *
 * Bob can then go and sign in to the Admin UI using the provided emailAddress & password credentials, and start
 * creating some products.
 *
 * Repeat this process for more Sellers.
 *
 * ## Storefront
 *
 * To create a multivendor Order, use the default Channel in the storefront and add variants to an Order from
 * various Sellers.
 *
 * ### Shipping
 *
 * When it comes to setting the shipping method, the `eligibleShippingMethods` query should just return the
 * shipping methods for the shops from which the OrderLines come. So assuming the Order contains items from 3 different
 * Sellers, there should be at least 3 eligible ShippingMethods (plus any global ones from the default Channel).
 *
 * You should now select the IDs of all the Seller-specific ShippingMethods:
 *
 * ```graphql
 * mutation {
 *   setOrderShippingMethod(shippingMethodId: ["3", "4"]) {
 *     ... on Order {
 *       id
 *     }
 *   }
 * }
 * ```
 *
 * ### Payment
 *
 * This plugin automatically creates a "connected payment method" in the default Channel, which is a simple simulation
 * of something like Stripe Connect.
 *
 * ```graphql
 * mutation {
 *   addPaymentToOrder(input: { method: "connected-payment-method", metadata: {} }) {
 *     ... on Order { id }
 *     ... on ErrorResult {
 *       errorCode
 *       message
 *     }
 *     ... on PaymentFailedError {
 *       paymentErrorMessage
 *     }
 *   }
 * }
 * ```
 *
 * After that, you should be able to see that the Order has been split into an "aggregate" order in the default Channel,
 * and then one or more "seller" orders in each Channel from which the customer bought items.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [MollieController],  // Register the MollieController here

    compatibility: '^3.0.0',
    configuration: config => {
        config.customFields.Customer.push({
            name: 'preferredSeller',
            label: [
                { languageCode: LanguageCode.en, value: 'Preferred Seller' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The preferred seller associated with this customer',
                },
            ],
            type: 'relation',
            entity: Seller, // Ensure this entity is defined and imported
            public: true,
            nullable: true, // Set to false if the field should be required
            ui: {
                component: 'preferred-seller-input', // Should match the registered component name
            },
        });

        const MAX_TABS = 3;

        for (let i = 1; i <= MAX_TABS; i++) {
            config.customFields.Product.push(
                {
                    name: `tab${i}Label`,
                    type: 'string',
                    label: [{ languageCode: LanguageCode.en, value: `Tab ${i} Label` }],
                    nullable: true,
                    public: true,
                    ui: {
                        tab: 'Description Tabs',
                        layout: 'horizontal', // Align this field with the visibility toggle
                    },
                },
                {
                    name: `tab${i}Visible`,
                    type: 'boolean',
                    label: [{ languageCode: LanguageCode.en, value: `Show Tab ${i} on Frontend` }],
                    nullable: false,
                    public: true,
                    defaultValue: false,
                    ui: {
                        tab: 'Description Tabs',
                        layout: 'horizontal', // Align this field horizontally with others
                    },
                },
                {
                    name: `tab${i}Content`,
                    type: 'text',
                    label: [{ languageCode: LanguageCode.en, value: `Tab ${i} Content` }],
                    nullable: true,
                    public: true,
                    ui: {
                        component: 'rich-text-form-input',
                        tab: 'Description Tabs',
                        layout: 'vertical', // Keep this field full-width and below the others
                    },
                }
            );
        }



        config.customFields.Product.push(
            {
                name: 'featured',
                type: 'boolean',
                label: [{ languageCode: LanguageCode.en, value: 'Featured' }],
                description: [{ languageCode: LanguageCode.en, value: 'Mark as featured product' }],
                defaultValue: false,
                nullable: false,
                // Replace `permissions` with `public: false` to restrict it in the API
                public: true, // This will make the field not accessible through public APIs,
            },
            {
                name: 'featuredInMenu',
                type: 'boolean',
                label: [{ languageCode: LanguageCode.en, value: 'Featured in Menu' }],
                description: [{ languageCode: LanguageCode.en, value: 'Show product in the menu' }],
                defaultValue: false,
                nullable: false,
                public: false, // Restrict API access
            },
            {
                name: 'brand',
                type: 'string',
                label: [
                    { languageCode: LanguageCode.en, value: 'Brand' }
                ],
                description: [
                    {
                        languageCode: LanguageCode.en,
                        value: 'The brand of the product'
                    }
                ],
                nullable: true, // Set to false if you want the field to be required
                public: true,    // Make it accessible via the API
            }
        );



        config.customFields.Seller.push({
            name: 'firstName',
            label: [{ languageCode: LanguageCode.en, value: 'First Name' }],
            description: [{ languageCode: LanguageCode.en, value: 'The first name of the seller' }],
            type: 'string',
            public: true,
            nullable: false,
            defaultValue: '', // Add default value
        }, {
            name: 'lastName',
            label: [{ languageCode: LanguageCode.en, value: 'Last Name' }],
            description: [{ languageCode: LanguageCode.en, value: 'The last name of the seller' }],
            type: 'string',
            public: true,
            nullable: false,
            defaultValue: '', // Add default value
        }, {
            name: 'emailAddress',
            label: [{ languageCode: LanguageCode.en, value: 'Email Address' }],
            description: [{ languageCode: LanguageCode.en, value: 'The email address of the seller' }],
            type: 'string',
            public: true,
            nullable: false,
            defaultValue: '', // Add default value
        }, {
            name: 'address',
            label: [{ languageCode: LanguageCode.en, value: 'Vendor Address' }],
            description: [{ languageCode: LanguageCode.en, value: 'The address of the vendor' }],
            type: 'string',
            public: true,
            nullable: false,
            defaultValue: '', // Add default value
        }, {
            name: 'postalCode',
            label: [{ languageCode: LanguageCode.en, value: 'Vendor Postal Code' }],
            description: [{ languageCode: LanguageCode.en, value: 'The postal code of the vendor' }],
            type: 'string',
            public: true,
            nullable: false,
            defaultValue: '', // Add default value
        }, {
            name: 'country',
            label: [{ languageCode: LanguageCode.en, value: 'Country' }],
            description: [{ languageCode: LanguageCode.en, value: 'The country where the vendor is located' }],
            type: 'string',
            public: true,
            nullable: false,
            defaultValue: '', // Add default value
        }, {
            name: 'vendorType',
            label: [{ languageCode: LanguageCode.en, value: 'Vendor Type' }],
            description: [{ languageCode: LanguageCode.en, value: 'The type of vendor' }],
            type: 'string',
            public: true,
            nullable: false,
            defaultValue: 'PHYSICAL_STORE', // Set an appropriate default value
            options: [
                { value: 'PHYSICAL_STORE', label: [{ languageCode: LanguageCode.en, value: 'Physical Store' }] },
                { value: 'MANUFACTURER', label: [{ languageCode: LanguageCode.en, value: 'Manufacturer' }] },
                { value: 'SERVICE_AGENT', label: [{ languageCode: LanguageCode.en, value: 'Service Agent' }] },
                { value: 'BOARDRUSH_PLATFORM', label: [{ languageCode: LanguageCode.en, value: 'Boardrush Platform' }] },
                { value: 'SERVICE_DEALER', label: [{ languageCode: LanguageCode.en, value: 'Service Dealer' }] },
            ],
        });

        config.customFields.Administrator.push(
            {
                name: 'mollieAccessToken',
                type: 'string',
                public: false,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Mollie Access Token' }],
                description: [{ languageCode: LanguageCode.en, value: 'OAuth access token for Mollie' }],
                ui: {
                    component: ''
                }
            },
            {
                name: 'mollieRefreshToken',
                type: 'string',
                public: false,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Mollie Refresh Token' }],
                description: [{ languageCode: LanguageCode.en, value: 'OAuth refresh token for Mollie' }],
                ui: {
                    component: ''
                }
            },
            {
                name: 'mollieConnected',
                type: 'boolean',
                public: false,
                nullable: true,
                defaultValue: false,
                label: [{ languageCode: LanguageCode.en, value: 'Mollie Connected' }],
                description: [{ languageCode: LanguageCode.en, value: 'Whether the administrator is connected to Mollie' }],
                ui: {
                    component: 'mollie-connect-button', // Register the custom React component here
                },
            },

        );


        config.paymentOptions.paymentMethodHandlers.push(molliePaymentMethodHandler);

        const customDefaultOrderProcess = configureDefaultOrderProcess({
            checkFulfillmentStates: false,
        });
        config.orderOptions.process = [customDefaultOrderProcess, multivendorOrderProcess];
        config.orderOptions.orderSellerStrategy = new MultivendorSellerStrategy();
        config.catalogOptions.productVariantPriceUpdateStrategy =
            new DefaultProductVariantPriceUpdateStrategy({
                syncPricesAcrossChannels: true,
            });
        config.shippingOptions.shippingEligibilityCheckers.push(multivendorShippingEligibilityChecker);
        config.shippingOptions.shippingLineAssignmentStrategy =
            new MultivendorShippingLineAssignmentStrategy();
        return config;
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [MultivendorResolver],
    },
    providers: [
        MultivendorService,
        { provide: MULTIVENDOR_PLUGIN_OPTIONS, useFactory: () => MultivendorPlugin.options },
    ],
})





export class MultivendorPlugin implements OnApplicationBootstrap {

    static ui: AdminUiExtension = {
        id: 'multivendor-plugin',
        extensionPath: path.join(__dirname, './ui'),
        providers: ['providers.ts'],
    };


    static options: MultivendorPluginOptions;

    constructor(
        private eventBus: EventBus,
        private multivendorService: MultivendorService,
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private requestContextService: RequestContextService,
        private paymentMethodService: PaymentMethodService,
        private administratorService: AdministratorService,
        private roleService: RoleService,
        private shippingMethodService: ShippingMethodService,
        private stockLocationService: StockLocationService,
    ) {}

    static init(options: MultivendorPluginOptions) {
        MultivendorPlugin.options = options;
        return MultivendorPlugin;
    }

    async onApplicationBootstrap() {
        // Ensure that the connected payment method exists when the application starts
        await this.ensureConnectedPaymentMethodExists();

        // Subscribe to Seller creation events using SellerEvent
        this.eventBus.ofType(SellerEvent).subscribe(async event => {
            if (event.type === 'created') {
                try {
                    const seller = event.entity;

                    // Cast customFields to the appropriate type
                    // const customFields = seller.customFields as CustomSellerFields;
                    const shopName = seller.name;
                    const firstName = seller.customFields?.firstName;
                    const lastName = seller.customFields?.lastName;
                    const emailAddress = seller.customFields?.emailAddress;
                    const password = (Math.random() + 1).toString(36).substring(7); // Generates a random password with 12 characters.
                    const existingSellerId = seller.id;
                    // Ensure that all required fields are available
                    if (!shopName || !firstName || !lastName || !emailAddress || !password) {
                        Logger.error(
                            'Missing required seller details in custom fields',
                            'MultivendorPlugin'
                        );
                        return;
                    }

                    // Prepare the input that registerNewSeller expects
                    const input: { shopName: string; seller: CreateSellerInput; existingSellerId?: ID | null } = {
                        shopName,
                        seller: {
                            firstName,
                            lastName,
                            emailAddress,
                            password,
                        },
                        existingSellerId
                    };

                    // Use the existing request context from the event for admin-level actions
                    const ctx = event.ctx;

                    // Call the existing registerNewSeller method with the prepared input
                    await this.multivendorService.registerNewSeller(ctx, input, false);
                    Logger.info(`Successfully created resources for new seller: ${shopName}`);
                } catch (error) {
                    // Safely handle 'unknown' error type
                    if (error instanceof Error) {
                        Logger.error(`Failed to create resources for seller: ${error.message}`, 'MultivendorPlugin');
                    } else {
                        Logger.error(`An unknown error occurred during seller creation`, 'MultivendorPlugin');
                    }
                }
            }
        });
    }

    private async ensureConnectedPaymentMethodExists() {
        const paymentMethod = await this.connection.rawConnection.getRepository(PaymentMethod).findOne({
            where: {
                code: CONNECTED_PAYMENT_METHOD_CODE,
            },
        });
        if (!paymentMethod) {
            const ctx = await this.requestContextService.create({ apiType: 'admin' });
            const allChannels = await this.connection.getRepository(ctx, Channel).find();
            const createdPaymentMethod = await this.paymentMethodService.create(ctx, {
                code: CONNECTED_PAYMENT_METHOD_CODE,
                enabled: true,
                handler: {
                    code: molliePaymentMethodHandler.code,
                    arguments: [],  // Add missing arguments property as an empty array
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Connected Payments',
                    },
                ],
            });
            await this.channelService.assignToChannels(
                ctx,
                PaymentMethod,
                createdPaymentMethod.id,
                allChannels.map(c => c.id),
            );
        }
    }
}
