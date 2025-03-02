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
    StockLocationService,
    Permission,
    StockLocation,
    SellerEvent,
    ID,
    Customer,
    Seller,
    Asset,
    DefaultSearchPlugin,
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
import {ViesProxyController} from "./controllers/viesproxy.controller";
import {CustomChannelController} from "./controllers/channel.controller";
import {VendorSelectionResolver} from "./api/vendor-selection.resolver";
import {VendorSelectionService} from "./service/vendor-selection.service";



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
    imports: [PluginCommonModule, DefaultSearchPlugin],
    controllers: [MollieController, ViesProxyController, CustomChannelController],  // Register the MollieController here

    compatibility: '^3.0.0',
    configuration: config => {

        if (!config.customFields.Order) {
            config.customFields.Order = [];
        }

        config.customFields.Order.push({
            name: 'scenario',
            type: 'string',
            nullable: true,
            public: true, // This field indicates which scenario was followed
        });

        config.customFields.Order.push({
            name: 'primaryVendor',
            type: 'relation',
            entity: Seller, // Make sure to import your Seller entity correctly
            public: true,
            nullable: true,
            ui: {
                component: 'preferred-seller-input', // Should match the registered component name
            },
        });

        config.customFields.Order.push({
            name: 'serviceDealer',
            type: 'relation',
            entity: Seller, // Make sure to import your Seller entity correctly
            public: true,
            nullable: true,
            ui: {
                component: 'preferred-seller-input', // Should match the registered component name
            },
        });

        config.customFields.Order.push({
            name: 'serviceAgentAvailable',
            type: 'boolean',
            nullable: true,
            public: true, // Indicates if a service agent was available
        });



        if(!config.customFields.OrderLine) {
            config.customFields.OrderLine = [];
        }
        config.customFields.OrderLine.push({
            name: 'requestedSellerChannel',
            type: 'string',
            nullable: true,
            public: true, // Allows this field to be accessed in API responses
        })


        // ---------------------------------------------------------------------
        // Add VAT Number to the Address entity so it appears in CreateAddressInput
        // ---------------------------------------------------------------------
        if (!config.customFields.Address) {
            config.customFields.Address = [];
        }
        config.customFields.Address.push({
            name: 'vatNumber',
            type: 'string',
            public: true, // Ensures it is exposed via the GraphQL API on inputs
            nullable: true,
            label: [{ languageCode: LanguageCode.en, value: 'VAT Number' }],
            description: [{ languageCode: LanguageCode.en, value: 'The VAT Number for this address' }],
        });

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

        // ------------------------------------------------------------
        // 1) ADDING NEW "Product:" FIELDS (EXCLUDING 'brand' ALREADY ADDED)
        // ------------------------------------------------------------
        config.customFields.Product.push(
            {
                name: 'warranty',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Warranty (Years)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Number of years for product warranty' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Product Details',
                    layout: 'horizontal',
                },
            },
            {
                name: 'eanCode',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'EAN Code' }],
                description: [{ languageCode: LanguageCode.en, value: 'European Article Number for the product' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Product Details',
                    layout: 'horizontal',
                },
            },
            // Remove 'shortDescriptionHtml' if it's mapped elsewhere
            // Commented out to retain structured mapping
            // {
            //     name: 'shortDescriptionHtml',
            //     type: 'rich-text',
            //     label: [{ languageCode: LanguageCode.en, value: 'Short Description (HTML)' }],
            //     description: [{ languageCode: LanguageCode.en, value: 'Short description in HTML format' }],
            //     nullable: true,
            //     public: true,
            //     ui: {
            //         component: 'rich-text-form-input',
            //         tab: 'Descriptions',
            //         layout: 'vertical',
            //     },
            // },
            // Retain 'longDescriptionHtml' if it's part of structured mapping
            // {
            //     name: 'longDescriptionHtml',
            //     type: 'rich-text',
            //     label: [{ languageCode: LanguageCode.en, value: 'Long Description (HTML)' }],
            //     description: [{ languageCode: LanguageCode.en, value: 'Long description in HTML format' }],
            //     nullable: true,
            //     public: true,
            //     ui: {
            //         component: 'rich-text-form-input',
            //         tab: 'Descriptions',
            //         layout: 'vertical',
            //     },
            // },
            {
                name: 'quote',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Quote' }],
                description: [{ languageCode: LanguageCode.en, value: 'A highlight or testimonial quote for the product' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Quotes',
                    layout: 'horizontal',
                },
            },
            {
                name: 'quoteOwner',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Quote Owner' }],
                description: [{ languageCode: LanguageCode.en, value: 'The individual or entity credited for the quote' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Quotes',
                    layout: 'horizontal',
                },
            },
            {
                name: 'boardCategory',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Board Category' }],
                description: [{ languageCode: LanguageCode.en, value: 'Category of the board (e.g., Snowboard, Surfboard)' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Specifications',
                    layout: 'horizontal',
                },
            },
            {
                name: 'terrain',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Terrain' }],
                description: [{ languageCode: LanguageCode.en, value: 'Suitable terrain for the board' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Specifications',
                    layout: 'horizontal',
                },
            },
            {
                name: 'camberProfile',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Camber Profile' }],
                description: [{ languageCode: LanguageCode.en, value: 'Type of camber profile' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Specifications',
                    layout: 'horizontal',
                },
            },
            {
                name: 'profile',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Profile' }],
                description: [{ languageCode: LanguageCode.en, value: 'General shape or style of the board' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Specifications',
                    layout: 'horizontal',
                },
            },
            {
                name: 'baseProfile',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Base Profile' }],
                description: [{ languageCode: LanguageCode.en, value: 'Base shape or underside profile' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Specifications',
                    layout: 'horizontal',
                },
            },
            {
                name: 'rider',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Rider Type' }],
                description: [{ languageCode: LanguageCode.en, value: 'Ideal rider type or style' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Specifications',
                    layout: 'horizontal',
                },
            },
            {
                name: 'taperProfile',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Taper Profile' }],
                description: [{ languageCode: LanguageCode.en, value: 'Overall taper or shape difference between nose and tail' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Specifications',
                    layout: 'horizontal',
                },
            },
            {
                name: 'bindingSize',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Binding Size' }],
                description: [{ languageCode: LanguageCode.en, value: 'Recommended binding sizes' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Bindings',
                    layout: 'horizontal',
                },
            },
            {
                name: 'bindingMount',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Binding Mount' }],
                description: [{ languageCode: LanguageCode.en, value: 'Mounting system for bindings' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Bindings',
                    layout: 'horizontal',
                },
            },
            {
                name: 'edges',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Edges' }],
                description: [{ languageCode: LanguageCode.en, value: 'Type or style of edges' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Construction',
                    layout: 'horizontal',
                },
            },
            {
                name: 'sidewall',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Sidewall' }],
                description: [{ languageCode: LanguageCode.en, value: 'Sidewall construction details' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Construction',
                    layout: 'horizontal',
                },
            },
            {
                name: 'core',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Core' }],
                description: [{ languageCode: LanguageCode.en, value: 'Material or construction of the board’s core' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Construction',
                    layout: 'horizontal',
                },
            },
            {
                name: 'layup1',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Lay-up #1' }],
                description: [{ languageCode: LanguageCode.en, value: 'Lay-up detail #1' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Construction',
                    layout: 'horizontal',
                },
            },
            {
                name: 'layup2',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Lay-up #2' }],
                description: [{ languageCode: LanguageCode.en, value: 'Lay-up detail #2' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Construction',
                    layout: 'horizontal',
                },
            },
            {
                name: 'layup3',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Lay-up #3' }],
                description: [{ languageCode: LanguageCode.en, value: 'Lay-up detail #3' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Construction',
                    layout: 'horizontal',
                },
            },
            {
                name: 'boardbase',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Base' }],
                description: [{ languageCode: LanguageCode.en, value: 'Type or material used for the board base' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Construction',
                    layout: 'horizontal',
                },
            }
        );

        // ------------------------------------------------------------
        // 2) ADDING NEW "variant:" FIELDS (Including Rating Fields)
        // ------------------------------------------------------------
        config.customFields.ProductVariant.push(
            {
                name: 'lengthCm',
                type: 'int',
                label: [{ languageCode: LanguageCode.en, value: 'Length (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Variant length in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Specs',
                    layout: 'horizontal',
                },
            },
            {
                name: 'riderLengthMin',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Rider Length Min (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Minimum recommended rider height in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Specs',
                    layout: 'horizontal',
                },
            },
            {
                name: 'riderLengthMax',
                type: 'float', // Allows for values like '195+'
                label: [{ languageCode: LanguageCode.en, value: 'Rider Length Max (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Maximum recommended rider height in centimeters (use "+" for open-ended)' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Specs',
                    layout: 'horizontal',
                },
            },
            {
                name: 'riderWeightMin',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Rider Weight Min (kg)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Minimum recommended rider weight in kilograms' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Specs',
                    layout: 'horizontal',
                },
            },
            {
                name: 'flex',
                type: 'float', // Allows for values like '95+'
                label: [{ languageCode: LanguageCode.en, value: 'Flex rating' }],
                description: [{ languageCode: LanguageCode.en, value: 'Flex rating for the board' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Specs',
                    layout: 'horizontal',
                },
            },
            {
                name: 'riderWeightMax',
                type: 'float', // Allows for values like '95+'
                label: [{ languageCode: LanguageCode.en, value: 'Rider Weight Max (kg)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Maximum recommended rider weight in kilograms (use "+" for open-ended)' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Specs',
                    layout: 'horizontal',
                },
            },
            {
                name: 'noseWidth',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Nose Width (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Nose width in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'waistWidth',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Waist Width (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Waist width in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'tailWidth',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Tail Width (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Tail width in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'taper',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Taper (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Difference between nose & tail in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'boardWidth',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Board Width (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Overall board width in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'bootLengthMax',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Boot Length Max (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Maximum recommended boot size in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'effectiveEdge',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Effective Edge (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Effective edge length in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'averageSidecutRadius',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Average Sidecut Radius (m)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Approximate sidecut radius in meters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'setback',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Setback (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Stance setback in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'stanceMin',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Stance Min (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Minimum stance width in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'stanceMax',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Stance Max (cm)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Maximum stance width in centimeters' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Geometry',
                    layout: 'horizontal',
                },
            },
            {
                name: 'weightKg',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Weight (kg)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Variant weight in kilograms' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Specs',
                    layout: 'horizontal',
                },
            },
            {
                name: 'bindingSizeVariant',
                type: 'string', // Avoid naming conflict with Product:bindingsize
                label: [{ languageCode: LanguageCode.en, value: 'Variant Binding Size' }],
                description: [{ languageCode: LanguageCode.en, value: 'Binding size specific to this variant' }],
                nullable: true,
                public: true,
                ui: {
                    tab: 'Variant Bindings',
                    layout: 'horizontal',
                },
            }
        );




        const MAX_DESCRIPTION_TABS = 3;
        const MAX_PRODUCT_OPTION_TABS = 3;
        const MAX_PRODUCT_OPTION_BARS = 4;

// Add description tabs to ProductVariant
        for (let i = 1; i <= MAX_DESCRIPTION_TABS; i++) {
            config.customFields.ProductVariant.push(
                {
                    name: `descriptionTab${i}Label`,
                    type: 'string',
                    label: [{ languageCode: LanguageCode.en, value: `Description Tab ${i} Label` }],
                    nullable: true,
                    public: true,
                    ui: {
                        tab: 'Description Tabs',
                        layout: 'horizontal', // Align this field with the visibility toggle
                    },
                },
                {
                    name: `descriptionTab${i}Visible`,
                    type: 'boolean',
                    label: [{ languageCode: LanguageCode.en, value: `Show Description Tab ${i} on Frontend` }],
                    nullable: false,
                    public: true,
                    defaultValue: false,
                    ui: {
                        tab: 'Description Tabs',
                        layout: 'horizontal', // Align this field horizontally with others
                    },
                },
                {
                    name: `descriptionTab${i}Content`,
                    type: 'text',
                    label: [{ languageCode: LanguageCode.en, value: `Description Tab ${i} Content` }],
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

        config.customFields.ProductVariant.push(
            {
                name: 'shortdescription',
                type: 'text',
                label: [{ languageCode: LanguageCode.en, value: `Variation short description` }],
                nullable: true,
                public: true,
                ui: {
                    component: 'rich-text-form-input',
                    tab: 'Short description',
                    layout: 'vertical', // Keep this field full-width and below the others
                },
            }
        );

            config.customFields.ProductVariant.push(
            {
                name: 'frontPhoto',
                type: 'relation', // Create a relation to the Asset entity
                entity: Asset,
                label: [{ languageCode: LanguageCode.en, value: 'Front Photo' }],
                description: [{ languageCode: LanguageCode.en, value: 'Photo of the front side of the board' }],
                nullable: true,
                public: true,
                ui: {
                    component: 'asset-picker-form-input', // Use the built-in asset picker
                    tab: 'Board Photos',
                    layout: 'vertical',
                },
            },
            {
                name: 'backPhoto',
                type: 'relation', // Create a relation to the Asset entity
                entity: Asset,
                label: [{ languageCode: LanguageCode.en, value: 'Back Photo' }],
                description: [{ languageCode: LanguageCode.en, value: 'Photo of the back side of the board' }],
                nullable: true,
                public: true,
                ui: {
                    component: 'asset-picker-form-input', // Use the built-in asset picker
                    tab: 'Board Photos',
                    layout: 'vertical',
                },
            }
        );


// Add product options tabs to ProductVariant
        for (let i = 1; i <= MAX_PRODUCT_OPTION_TABS; i++) {
            config.customFields.ProductVariant.push(
                // Add the main label and visibility toggle for each option tab
                {
                    name: `optionTab${i}Label`,
                    type: 'string',
                    label: [{ languageCode: LanguageCode.en, value: `Option Tab ${i} Label` }],
                    nullable: true,
                    public: true,
                    ui: {
                        tab: `Product Options Tab ${i}`, // Separate tab for each options tab
                        layout: 'horizontal',
                    },
                },
                {
                    name: `optionTab${i}Visible`,
                    type: 'boolean',
                    label: [{ languageCode: LanguageCode.en, value: `Show Option Tab ${i} on Frontend` }],
                    nullable: false,
                    public: true,
                    defaultValue: false,
                    ui: {
                        tab: `Product Options Tab ${i}`, // Separate tab for each options tab
                        layout: 'horizontal',
                    },
                }
            );

            // Add up to MAX_PRODUCT_OPTION_BARS bars (scales) for each option tab
            for (let j = 1; j <= MAX_PRODUCT_OPTION_BARS; j++) {
                config.customFields.ProductVariant.push(
                    {
                        name: `optionTab${i}Bar${j}Name`,
                        type: 'string',
                        label: [{ languageCode: LanguageCode.en, value: `Bar ${j} Name` }],
                        nullable: true,
                        public: true,
                        ui: {
                            tab: `Product Options Tab ${i}`, // Separate tab for each options tab
                            layout: 'horizontal',
                        },
                    },
                    {
                        name: `optionTab${i}Bar${j}Visible`,
                        type: 'boolean',
                        label: [{ languageCode: LanguageCode.en, value: `Bar ${j} on Frontend` }],
                        nullable: false,
                        public: true,
                        defaultValue: false,
                        ui: {
                            tab: `Product Options Tab ${i}`, // Separate tab for each options tab
                            layout: 'horizontal',
                        },
                    },
                    {
                        name: `optionTab${i}Bar${j}Min`,
                        type: 'float',
                        label: [{ languageCode: LanguageCode.en, value: `Bar ${j} Min Value` }],
                        nullable: true,
                        public: true,
                        ui: {
                            tab: `Product Options Tab ${i}`, // Separate tab for each options tab
                            layout: 'horizontal',
                        },
                    },
                    {
                        name: `optionTab${i}Bar${j}Max`,
                        type: 'float',
                        label: [{ languageCode: LanguageCode.en, value: `Bar ${j} Max Value` }],
                        nullable: true,
                        public: true,
                        ui: {
                            tab: `Product Options Tab ${i}`, // Separate tab for each options tab
                            layout: 'horizontal',
                        },
                    },
                    {
                        name: `optionTab${i}Bar${j}MinLabel`,
                        type: 'string',
                        label: [{ languageCode: LanguageCode.en, value: `Bar ${j} Min Label` }],
                        nullable: true,
                        public: true,
                        ui: {
                            tab: `Product Options Tab ${i}`, // Separate tab for each options tab
                            layout: 'horizontal',
                        },
                    },
                    {
                        name: `optionTab${i}Bar${j}MaxLabel`,
                        type: 'string',
                        label: [{ languageCode: LanguageCode.en, value: `Bar ${j} Max Label` }],
                        nullable: true,
                        public: true,
                        ui: {
                            tab: `Product Options Tab ${i}`, // Separate tab for each options tab
                            layout: 'horizontal',
                        },
                    },
                    {
                        name: `optionTab${i}Bar${j}Rating`,
                        type: 'float',
                        label: [{ languageCode: LanguageCode.en, value: `Bar ${j} Rating` }],
                        nullable: true,
                        public: true,
                        ui: {
                            component: 'range-slider-form-input', // Example: Use a slider UI for rating
                            tab: `Product Options Tab ${i}`, // Separate tab for each options tab
                            layout: 'horizontal',
                        },
                    }
                );
            }
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
                { value: 'PHYSICAL_STORE_OR_SERVICE_DEALER', label: [{ languageCode: LanguageCode.en, value: 'Physical Store and/or service dealer' }] },
                { value: 'MANUFACTURER', label: [{ languageCode: LanguageCode.en, value: 'Manufacturer' }] },
                { value: 'AGENT', label: [{ languageCode: LanguageCode.en, value: 'Agent' }] },
                { value: 'BOARDRUSH_PLATFORM', label: [{ languageCode: LanguageCode.en, value: 'Boardrush Platform' }] },
            ],
        },
        {
            name: 'merkDealer',
                label: [{ languageCode: LanguageCode.en, value: 'MERK Dealer' }],
            description: [{ languageCode: LanguageCode.en, value: 'Attached MERK Dealer for the manufacturer' }],
            type: 'relation',
            entity: Seller, // Make sure to import your Seller entity correctly
            public: true,
            nullable: true,
            ui: {
                component: 'preferred-seller-input', // Should match the registered component name
            },
        },
        {
            name: 'merkDistributeur',
                label: [{ languageCode: LanguageCode.en, value: 'MERK Distributeur' }],
            description: [{ languageCode: LanguageCode.en, value: 'Attached MERK Distributeur (agent) for the manufacturer' }],
            type: 'relation',
            entity: Seller, // Make sure to import your Seller entity correctly
            public: true,
            nullable: true,
            ui: {
                component: 'preferred-seller-input', // Should match the registered component name
        },
        }

    );

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
        VendorSelectionService,
        VendorSelectionResolver,
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
