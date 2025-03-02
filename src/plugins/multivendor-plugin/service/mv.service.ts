import { Injectable } from '@nestjs/common';
import { CreateAdministratorInput, Permission } from '@vendure/common/lib/generated-types';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import {
    AdministratorService,
    Channel,
    ChannelService,
    ConfigService,
    defaultShippingCalculator, ID,
    InternalServerError,
    isGraphQlErrorResult, Logger,
    manualFulfillmentHandler,
    RequestContext,
    RequestContextService,
    RoleService,
    SellerService,
    ShippingMethod,
    ShippingMethodService,
    StockLocation,
    StockLocationService,
    TaxSetting,
    TransactionalConnection,
    User,
} from '@vendure/core';

import { multivendorShippingEligibilityChecker } from '../config/mv-shipping-eligibility-checker';
import { CreateSellerInput } from '../types';
import { MollieApiError } from '@mollie/api-client';

interface MollieTokenResponse {
    access_token: string;
    refresh_token: string;
}

// Extend CustomAdministratorFields to include Mollie fields
declare module '@vendure/core' {
    interface CustomAdministratorFields {
        mollieAccessToken?: string;
        mollieRefreshToken?: string;
        mollieConnected?: boolean;
    }
}


@Injectable()
export class MultivendorService {
    constructor(
        private administratorService: AdministratorService,
        private sellerService: SellerService,
        private roleService: RoleService,
        private channelService: ChannelService,
        private shippingMethodService: ShippingMethodService,
        private configService: ConfigService,
        private stockLocationService: StockLocationService,
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
    ) {}

    async registerNewSeller(
        ctx: RequestContext,
        input: {
            shopName: string;
            seller: CreateSellerInput;
            existingSellerId?: ID | null;
        } = {
            shopName: 'Default Shop',
            seller: {
                firstName: 'Default',
                lastName: 'Seller',
                emailAddress: 'default@example.com',
                password: 'defaultPassword',
            },
            existingSellerId: null,
        },
        createSellerEntity: boolean = true,
    ): Promise<Channel> {
        // Get a context with super admin privileges.
        const superAdminCtx = await this.getSuperAdminContext(ctx);

        // Use superAdminCtx for all privileged operations.
        const existingSellerId = input.existingSellerId ?? null;

        const channel = await this.createSellerChannelRoleAdmin(
            superAdminCtx, // Pass superAdminCtx here
            input,
            createSellerEntity,
            existingSellerId,
        );

        await this.createSellerShippingMethod(superAdminCtx, input.shopName, channel);
        await this.createSellerStockLocation(superAdminCtx, input.shopName, channel);

        return channel;
    }


    // Method to refresh Mollie tokens using the refresh token grant
    async refreshMollieTokens(refreshToken: string): Promise<MollieTokenResponse> {
        const clientId = process.env.MOLLIE_CLIENT_ID;
        const clientSecret = process.env.MOLLIE_CLIENT_SECRET;
        const hostname = this.configService.apiOptions.hostname || 'https://localhost:3000';
        const redirectUri = `${hostname}/mollie/callback`;

        if (!clientId || !clientSecret) {
            throw new Error('Mollie Client ID or Client Secret is not defined');
        }

        const response = await fetch('https://api.mollie.com/oauth2/tokens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            try {
                const errorJson = JSON.parse(errorBody);
                throw new Error(`Mollie API error: ${errorJson.error} - ${errorJson.error_description}`);
            } catch (parseError) {
                throw new Error(`Mollie API error: ${errorBody}`);
            }
        }

        const tokens = (await response.json()) as MollieTokenResponse;
        return tokens;
    }



    // Method to exchange code for Mollie tokens
    async exchangeCodeForTokens(code: string): Promise<MollieTokenResponse> {
        const clientId = process.env.MOLLIE_CLIENT_ID;
        const clientSecret = process.env.MOLLIE_CLIENT_SECRET;
        const hostname = this.configService.apiOptions.hostname || 'https://localhost:3000'; // Default to 'https://localhost'
        const redirectUri = `${hostname}/mollie/callback`; // Redirect URL for authorization callback

        // Ensure that clientId and clientSecret are defined
        if (!clientId || !clientSecret) {
            throw new Error('Mollie Client ID or Client Secret is not defined');
        }

        const response = await fetch('https://api.mollie.com/oauth2/tokens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
            }),
        });

        // Check if the response is not OK (e.g., 4xx or 5xx status code)
        if (!response.ok) {
            const errorBody = await response.text(); // Get the error response as text

            // Optionally parse the error if it's in JSON format
            try {
                const errorJson = JSON.parse(errorBody);
                throw new Error(`Mollie API error: ${errorJson.error} - ${errorJson.error_description}`);
            } catch (parseError) {
                // If parsing fails, use the raw error body
                throw new Error(`Mollie API error: ${errorBody}`);
            }
        }

        const tokens = await response.json() as MollieTokenResponse;  // Properly cast to MollieTokenResponse

        return tokens;
    }

    // Save tokens in Administrator's custom fields
    async saveMollieTokens(
        ctx: RequestContext, // Pass the context
        adminId: ID,     // Administrator ID as a string
        accessToken: string,
        refreshToken: string
    ): Promise<void> {
        // Retrieve the administrator using the context and ID
        const admin = await this.administratorService.findOne(ctx, adminId);

        if (admin) {
            // Update the custom fields with Mollie tokens
            admin.customFields.mollieAccessToken = accessToken;
            admin.customFields.mollieRefreshToken = refreshToken;
            admin.customFields.mollieConnected = true;

            // Persist the updated administrator
            await this.administratorService.update(ctx, admin);
        } else {
            throw new Error('Administrator not found');
        }
    }

    private async createSellerChannelRoleAdmin(
        ctx: RequestContext,
        input: { shopName: string; seller: CreateSellerInput; existingSellerId?: ID | null },
        createSellerEntity: boolean,
        existingSellerId: ID | null,
    ): Promise<Channel> {
        Logger.info('Starting createSellerChannelRoleAdmin...', 'MultivendorPlugin');

        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const shopCode = normalizeString(input.shopName, '-');
        Logger.info(`Default channel: ${defaultChannel.code}`, 'MultivendorPlugin');

        let sellerId: ID | undefined = existingSellerId || undefined;

        if (!existingSellerId && createSellerEntity) {
            Logger.info('Creating a new seller entity...', 'MultivendorPlugin');
            const seller = await this.sellerService.create(ctx, {
                name: input.shopName,
                customFields: {
                    connectedAccountId: Math.random().toString(30).substring(3),
                },
            });
            sellerId = seller.id;
            Logger.info(`New seller created with ID: ${sellerId}`, 'MultivendorPlugin');
        }

        Logger.info('Creating a new channel...', 'MultivendorPlugin');
        const channel = await this.channelService.create(ctx, {
            code: shopCode,
            sellerId: sellerId,
            token: `${shopCode}-token`,
            currencyCode: defaultChannel.defaultCurrencyCode,
            defaultLanguageCode: defaultChannel.defaultLanguageCode,
            pricesIncludeTax: defaultChannel.pricesIncludeTax,
            defaultShippingZoneId: defaultChannel.defaultShippingZone.id,
            defaultTaxZoneId: defaultChannel.defaultTaxZone.id,
        });

        if (isGraphQlErrorResult(channel)) {
            Logger.error(`Failed to create channel: ${channel.message}`, 'MultivendorPlugin');
            throw new InternalServerError(channel.message);
        }

        Logger.info(`Channel created with ID: ${channel.id}`, 'MultivendorPlugin');
        await this.createRoleAndAdministrator(ctx, input, shopCode, channel);

        Logger.info('Finished createSellerChannelRoleAdmin', 'MultivendorPlugin');
        return channel;
    }

    private async createRoleAndAdministrator(
        ctx: RequestContext, // Should be superAdminCtx
        input: { shopName: string; seller: CreateSellerInput },
        shopCode: string,
        channel: Channel
    ): Promise<void> {
        try {
            Logger.info(`Creating role for shop ${input.shopName}...`, 'MultivendorPlugin');


            const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
            const customerRole = await this.roleService.getCustomerRole(ctx);
            await this.roleService.assignRoleToChannel(ctx, superAdminRole.id, channel.id);

            const role = await this.roleService.create(ctx, {
                code: `${shopCode}-admin`,
                channelIds: [channel.id],
                description: `Administrator of ${input.shopName}`,
                permissions: [
                    Permission.CreateCatalog,
                    Permission.UpdateCatalog,
                    Permission.ReadCatalog,
                    Permission.DeleteCatalog,
                    Permission.CreateOrder,
                    Permission.ReadOrder,
                    Permission.UpdateOrder,
                    Permission.DeleteOrder,
                    Permission.ReadCustomer,
                    Permission.ReadPaymentMethod,
                    Permission.ReadShippingMethod,
                    Permission.ReadPromotion,
                    Permission.ReadCountry,
                    Permission.ReadZone,
                    Permission.CreateCustomer,
                    Permission.UpdateCustomer,
                    Permission.DeleteCustomer,
                    Permission.CreateTag,
                    Permission.ReadTag,
                    Permission.UpdateTag,
                    Permission.DeleteTag,
                ],
            });

            Logger.info(`Role created with ID: ${role.id}`, 'MultivendorPlugin');

            Logger.info(`Creating administrator for shop ${input.shopName}...`, 'MultivendorPlugin');

            const admin = await this.administratorService.create(ctx, {
                firstName: input.seller.firstName,
                lastName: input.seller.lastName,
                emailAddress: input.seller.emailAddress,
                password: input.seller.password,
                roleIds: [role.id],
            });

            Logger.info(`Administrator created with ID: ${admin.id} for shop ${input.shopName}`, 'MultivendorPlugin');
        } catch (error) {
            if (error instanceof Error) {
                Logger.error(
                    `Failed to create role or administrator for ${input.shopName}: ${error.message}`,
                    'MultivendorPlugin'
                );
            } else {
                Logger.error(
                    `An unknown error occurred while creating role or administrator for ${input.shopName}`,
                    'MultivendorPlugin'
                );
            }
            throw error; // Re-throw the error after logging.
        }
    }


    private async createSellerShippingMethod(ctx: RequestContext, shopName: string, sellerChannel: Channel) {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const { shippingEligibilityCheckers, shippingCalculators, fulfillmentHandlers } =
            this.configService.shippingOptions;
        const shopCode = normalizeString(shopName, '-');
        const checker = shippingEligibilityCheckers.find(
            c => c.code === multivendorShippingEligibilityChecker.code,
        );
        const calculator = shippingCalculators.find(c => c.code === defaultShippingCalculator.code);
        const fulfillmentHandler = fulfillmentHandlers.find(h => h.code === manualFulfillmentHandler.code);
        if (!checker) {
            throw new InternalServerError(
                'Could not find a suitable ShippingEligibilityChecker for the seller',
            );
        }
        if (!calculator) {
            throw new InternalServerError('Could not find a suitable ShippingCalculator for the seller');
        }
        if (!fulfillmentHandler) {
            throw new InternalServerError('Could not find a suitable FulfillmentHandler for the seller');
        }
        const shippingMethod = await this.shippingMethodService.create(ctx, {
            code: `${shopCode}-shipping`,
            checker: {
                code: checker.code,
                arguments: [],
            },
            calculator: {
                code: calculator.code,
                arguments: [
                    { name: 'rate', value: '500' },
                    { name: 'includesTax', value: TaxSetting.auto },
                    { name: 'taxRate', value: '20' },
                ],
            },
            fulfillmentHandler: fulfillmentHandler.code,
            translations: [
                {
                    languageCode: defaultChannel.defaultLanguageCode,
                    name: `Standard Shipping for ${shopName}`,
                },
            ],
        });

        await this.channelService.assignToChannels(ctx, ShippingMethod, shippingMethod.id, [
            sellerChannel.id,
        ]);
    }

    private async createSellerStockLocation(ctx: RequestContext, shopName: string, sellerChannel: Channel) {
        const stockLocation = await this.stockLocationService.create(ctx, {
            name: `${shopName} Warehouse`,
        });
        await this.channelService.assignToChannels(ctx, StockLocation, stockLocation.id, [sellerChannel.id]);
    }

    private async getSuperAdminContext(ctx: RequestContext): Promise<RequestContext> {
        const { superadminCredentials } = this.configService.authOptions;
        const superAdminUser = await this.connection.getRepository(ctx, User).findOne({
            where: {
                identifier: superadminCredentials.identifier,
            },
        });
        return this.requestContextService.create({
            apiType: 'shop',
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            user: superAdminUser!,
        });
    }}
