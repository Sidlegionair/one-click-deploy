import {
    AdministratorService,
    Channel,
    ChannelService,
    CreatePaymentResult,
    ID,
    LanguageCode,
    Order,
    OrderService,
    PaymentMethodHandler,
    RequestContext,
    RoleService,
    TransactionalConnection,
    Seller as VendureSeller,
    EntityHydrator,
} from '@vendure/core';
import createMollieClient from '@mollie/api-client';
import { CreateParameters } from '@mollie/api-client/dist/types/binders/payments/parameters';
import { MultivendorService } from "../service/mv.service";

// Ensure the Mollie API key is provided
const mollieApiKey: string | undefined = process.env.MOLLIE_API_KEY;
if (!mollieApiKey) {
    throw new Error('Mollie API key is not defined in the environment variables.');
}

/**
 * Returns a service dealer seller if available.
 * For a physical store, the vendor is its own service dealer.
 * For a manufacturer, it returns the merkDealer if set, otherwise the merkDistributeur.
 * For BOARDRUSH_PLATFORM, no service dealer is set.
 */
function determineServiceDealer(seller: VendureSeller): VendureSeller | null {
    const vendorType = seller.customFields?.vendorType;
    if (vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER') {
        return null;
    } else if (vendorType === 'MANUFACTURER') {
        if (seller.customFields?.merkDealer) {
            return seller.customFields.merkDealer;
        } else if (seller.customFields?.merkDistributeur) {
            return seller.customFields.merkDistributeur;
        } else {
            return null;
        }
    }
    return null;
}

/**
 * Computes dynamic fee percentages based on the vendor seller’s custom fields and the order’s custom fields.
 * Returns:
 * - boardrush: Platform fee (not routed externally)
 * - serviceDealer: Fee to be routed to the service dealer (if any)
 * - vendor: Fee to be routed to the vendor
 */
function computeDynamicFeePercentagesForSeller(
    seller: VendureSeller,
    order: Order
): { boardrush: number; serviceDealer: number; vendor: number } {
    const vendorType = seller.customFields?.vendorType;
    const serviceAgentAvailable = order.customFields?.serviceAgentAvailable === true;
    if (vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER') {
        return { boardrush: 14, serviceDealer: 0, vendor: 86 };
    } else if (vendorType === 'MANUFACTURER') {
        if (seller.customFields?.merkDealer) {
            return serviceAgentAvailable
                ? { boardrush: 18, serviceDealer: 10, vendor: 72 }
                : { boardrush: 23, serviceDealer: 10, vendor: 67 };
        } else if (seller.customFields?.merkDistributeur) {
            return serviceAgentAvailable
                ? { boardrush: 18, serviceDealer: 7, vendor: 75 }
                : { boardrush: 23, serviceDealer: 7, vendor: 70 };
        } else {
            return serviceAgentAvailable
                ? { boardrush: 18, serviceDealer: 0, vendor: 82 }
                : { boardrush: 23, serviceDealer: 0, vendor: 77 };
        }
    } else if (vendorType === 'BOARDRUSH_PLATFORM') {
        return { boardrush: 100, serviceDealer: 0, vendor: 0 };
    }
    return { boardrush: 14, serviceDealer: 0, vendor: 86 };
}

// Global services (initialized in init())
let roleService: RoleService;
let administratorService: AdministratorService;
let orderService: OrderService;
let channelService: ChannelService;
let connection: TransactionalConnection;
let entityHydrator: EntityHydrator;
let multivendorService: MultivendorService;

interface ExtendedCreateParameters extends CreateParameters {
    routing?: Array<{
        amount: { value: string; currency: string };
        destination: { type: 'organization'; organizationId: string };
    }>;
}

export const molliePaymentMethodHandler = new PaymentMethodHandler({
    init(injector) {
        roleService = injector.get(RoleService);
        orderService = injector.get(OrderService);
        administratorService = injector.get(AdministratorService);
        multivendorService = injector.get(MultivendorService);
        channelService = injector.get(ChannelService);
        connection = injector.get(TransactionalConnection);
        entityHydrator = injector.get(EntityHydrator);
    },
    code: 'mollie-connect-payment-method',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Mollie Payment Provider',
        },
    ],
    args: {},
    createPayment: async (
        ctx: RequestContext,
        order: Order,
        amount: number,
        args: Record<string, unknown>,
        metadata: Record<string, unknown>
    ): Promise<CreatePaymentResult> => {
        // Always create payment for the aggregate order.
        return await createAggregatePayment(ctx, order, amount, metadata);
    },
    settlePayment: async (ctx: RequestContext, order: Order, payment: any, args: Record<string, unknown>) => {
        return { success: true };
    },
});

async function createAggregatePayment(
    ctx: RequestContext,
    order: Order,
    amount: number,
    metadata: Record<string, unknown>
): Promise<CreatePaymentResult> {
    const mollieClient = createMollieClient({ apiKey: mollieApiKey as string });

    // Hydrate the aggregate order and its channels.
    console.log(`[createAggregatePayment] Hydrating aggregate order ${order.code}`);
    await entityHydrator.hydrate(ctx, order, { relations: ['channels'] });
    // If needed, you can hydrate additional order customFields here.
    // (Assuming customFields are plain columns, they should already be available.)

    const {
        vendorRoutingArray,
        serviceDealerRoutingArray,
        totalVendorAmount,
        totalServiceDealerAmount,
    } = await buildRoutingArray(ctx, order);

    const orderAmountEuros = amount / 100;
    console.log(`[createAggregatePayment] Order total EUR: ${orderAmountEuros}`);
    console.log(`[createAggregatePayment] Vendor fee total EUR: ${totalVendorAmount}`);
    console.log(`[createAggregatePayment] Service Dealer fee total EUR: ${totalServiceDealerAmount}`);

    // Only route external fees (vendor and service dealer). Boardrush fee remains in-house.
    const finalRoutingArray = [
        ...vendorRoutingArray,
        ...serviceDealerRoutingArray,
    ];

    console.log(`[createAggregatePayment] Final Routing Array: ${JSON.stringify(finalRoutingArray, null, 2)}`);

    try {
        const result = await mollieClient.payments.create(<ExtendedCreateParameters>{
            amount: { value: orderAmountEuros.toFixed(2), currency: 'EUR' },
            description: `Order ${order.code}`,
            redirectUrl: `${process.env.FRONTEND_URL}/checkout/confirmation/${order.code}`,
            routing: finalRoutingArray,
        });

        console.log(`Mollie payment created successfully for order ${order.code} with transaction ID: ${result.id}`);

        return {
            amount,
            state: 'Authorized' as const,
            transactionId: result.id,
            metadata: {
                public: { redirectUrl: result._links.checkout?.href, transactionId: result.id },
                private: { molliePaymentId: result.id, transfer_group: order.code },
            },
        };
    } catch (error: any) {
        console.error('Error creating payment with Mollie:', error);
        return {
            amount,
            state: 'Declined' as const,
            metadata: {
                errorMessage: `Payment failed: ${error.message}`,
            },
        };
    }
}

async function buildRoutingArray(ctx: RequestContext, order: Order) {
    let vendorRoutingArray: Array<{
        amount: { value: string; currency: string };
        destination: { type: string; organizationId: string };
    }> = [];
    let serviceDealerRoutingArray: Array<{
        amount: { value: string; currency: string };
        destination: { type: string; organizationId: string };
    }> = [];
    let totalVendorAmount = 0;
    let totalServiceDealerAmount = 0;

    console.log(`[buildRoutingArray] Processing ${order.lines.length} order line(s) for order ${order.code}`);
    for (const line of order.lines) {
        const sellerChannelId = line.sellerChannelId;
        const linePriceEuros = line.linePriceWithTax / 100;
        console.log(`[buildRoutingArray] OrderLine ${line.id}: sellerChannelId=${sellerChannelId}, linePriceEuros=${linePriceEuros}`);
        if (sellerChannelId) {
            const {
                vendorRoutingEntries,
                serviceDealerRoutingEntries,
                vendorAmount,
                serviceDealerAmount,
            } = await fetchSellerRoutingInfo(ctx, sellerChannelId, linePriceEuros, order);
            vendorRoutingArray = vendorRoutingArray.concat(vendorRoutingEntries);
            serviceDealerRoutingArray = serviceDealerRoutingArray.concat(serviceDealerRoutingEntries);
            totalVendorAmount += vendorAmount;
            totalServiceDealerAmount += serviceDealerAmount;
        }
    }

    console.log(`[buildRoutingArray] Total Vendor fee: ${totalVendorAmount} EUR, Total Service Dealer fee: ${totalServiceDealerAmount} EUR`);
    return { vendorRoutingArray, serviceDealerRoutingArray, totalVendorAmount, totalServiceDealerAmount };
}

async function fetchSellerRoutingInfo(
    ctx: RequestContext,
    sellerChannelId: ID,
    linePriceEuros: number,
    order: Order
): Promise<{
    vendorRoutingEntries: Array<{ amount: { value: string; currency: string }; destination: { type: string; organizationId: string } }>;
    serviceDealerRoutingEntries: Array<{ amount: { value: string; currency: string }; destination: { type: string; organizationId: string } }>;
    vendorAmount: number;
    serviceDealerAmount: number;
}> {
    // Load the seller channel and ensure its seller is loaded.
    const sellerChannel = await channelService.findOne(ctx, sellerChannelId);
    if (!sellerChannel) {
        throw new Error(`No associated seller channel found for channel ID ${sellerChannelId}`);
    }
    console.log(`[fetchSellerRoutingInfo] Found sellerChannel ${sellerChannel.code}`);
    await entityHydrator.hydrate(ctx, sellerChannel, { relations: ['seller'] });
    if (!sellerChannel.seller) {
        throw new Error(`Seller not found for seller channel ${sellerChannel.code}`);
    }
    // Hydrate the seller's customFields for merkDealer and merkDistributeur.
    await entityHydrator.hydrate(ctx, sellerChannel.seller, { relations: ['customFields.merkDealer', 'customFields.merkDistributeur'] });
    const seller: VendureSeller = sellerChannel.seller;
    console.log(`[fetchSellerRoutingInfo] Seller ${seller.id} loaded for channel ${sellerChannel.code}`);

    // Compute fee percentages based on the vendor seller.
    let percentages = computeDynamicFeePercentagesForSeller(seller, order);
    console.log(`[fetchSellerRoutingInfo] Initial computed percentages: ${JSON.stringify(percentages)}`);

    // // Use the same logic as our strategy to determine the service dealer.
    const serviceDealerSeller = determineServiceDealer(seller);
    // if (serviceDealerSeller) {
    //     console.log(`[fetchSellerRoutingInfo] Service dealer determined from seller customFields: ${serviceDealerSeller.id}`);
    //     // Override percentages to enforce a service dealer fee.
    //     percentages = { boardrush: percentages.boardrush, serviceDealer: 10, vendor: percentages.vendor - 10 };
    // }
    console.log(`[fetchSellerRoutingInfo] Final percentages used for routing: ${JSON.stringify(percentages)}`);

    // Calculate fee amounts for this order line.
    const vendorAmount = parseFloat((linePriceEuros * (percentages.vendor / 100)).toFixed(2));
    const serviceDealerAmount = parseFloat((linePriceEuros * (percentages.serviceDealer / 100)).toFixed(2));
    console.log(`[fetchSellerRoutingInfo] Calculated amounts for line: vendor=${vendorAmount} EUR, serviceDealer=${serviceDealerAmount} EUR`);

    const admins = await administratorService.findAll(ctx, {}, ['user', 'user.roles', 'user.roles.channels']);

    // Build vendor routing entry if vendor fee is > 0.
    let vendorRoutingEntries: Array<{ amount: { value: string; currency: string }; destination: { type: string; organizationId: string } }> = [];
    if (vendorAmount > 0) {
        const eligibleAdmin = admins.items.find(admin =>
            admin.user.roles.some(role =>
                role.channels?.some((channel: Channel) => channel.id === sellerChannel.id)
            ) && admin.customFields.mollieAccessToken
        );
        if (!eligibleAdmin) {
            throw new Error(`No eligible administrator with a Mollie access token found for seller channel ${sellerChannel.code}`);
        }
        let mollieAccessToken = eligibleAdmin.customFields.mollieAccessToken;
        const adminId = eligibleAdmin.id;
        const mollieRefreshToken = eligibleAdmin.customFields.mollieRefreshToken;
        if (!mollieRefreshToken) {
            throw new Error(`Mollie refresh token is missing for admin ID: ${adminId}`);
        }
        let vendorOrganizationId: string;
        try {
            vendorOrganizationId = await fetchMollieOrganizationId(mollieAccessToken as string);
            console.log(`[fetchSellerRoutingInfo] Vendor organization ID: ${vendorOrganizationId}`);
        } catch (error: any) {
            if (error && error.statusCode === 401) {
                const mollieTokens = await multivendorService.refreshMollieTokens(mollieRefreshToken);
                await multivendorService.saveMollieTokens(ctx, adminId, mollieTokens.access_token, mollieTokens.refresh_token);
                vendorOrganizationId = await fetchMollieOrganizationId(mollieTokens.access_token);
            } else {
                throw new Error(`Failed to fetch Mollie organization ID, ${error.message}`);
            }
        }
        vendorRoutingEntries.push({
            amount: { value: vendorAmount.toFixed(2), currency: 'EUR' },
            destination: { type: 'organization', organizationId: vendorOrganizationId },
        });
    } else {
        console.log(`[fetchSellerRoutingInfo] Vendor fee amount is 0; skipping vendor routing entry.`);
    }

    // Build service dealer routing entry if fee > 0.
    let serviceDealerRoutingEntries: Array<{ amount: { value: string; currency: string }; destination: { type: string; organizationId: string } }> = [];
    if (serviceDealerAmount > 0 && serviceDealerSeller) {
        // Ensure the service dealer seller's channels are loaded.
        if (!serviceDealerSeller.channels || serviceDealerSeller.channels.length === 0) {
            await entityHydrator.hydrate(ctx, serviceDealerSeller, { relations: ['channels'] });
            console.log(`[fetchSellerRoutingInfo] After hydration, service dealer channels: ${JSON.stringify(serviceDealerSeller.channels)}`);
        }
        // Use a dedicated helper to find an admin for the service dealer based on its own channels.
        const serviceDealerAdmin = await findAdminForServiceDealer(ctx, serviceDealerSeller);
        if (serviceDealerAdmin) {
            let dealerAccessToken = serviceDealerAdmin.customFields.mollieAccessToken;
            const dealerAdminId = serviceDealerAdmin.id;
            const dealerRefreshToken = serviceDealerAdmin.customFields.mollieRefreshToken;
            if (!dealerRefreshToken) {
                throw new Error(`Mollie refresh token is missing for service dealer admin ID: ${dealerAdminId}`);
            }
            let serviceDealerOrganizationId: string;
            try {
                serviceDealerOrganizationId = await fetchMollieOrganizationId(dealerAccessToken as string);
                console.log(`[fetchSellerRoutingInfo] ServiceDealer organization ID: ${serviceDealerOrganizationId}`);
            } catch (error: any) {
                if (error && error.statusCode === 401) {
                    const dealerMollieTokens = await multivendorService.refreshMollieTokens(dealerRefreshToken);
                    await multivendorService.saveMollieTokens(ctx, dealerAdminId, dealerMollieTokens.access_token, dealerMollieTokens.refresh_token);
                    serviceDealerOrganizationId = await fetchMollieOrganizationId(dealerMollieTokens.access_token as string);
                    console.log(`[fetchSellerRoutingInfo] ServiceDealer organization ID (after refresh): ${serviceDealerOrganizationId}`);
                } else {
                    throw new Error(`Failed to fetch service dealer Mollie organization ID: ${error.message}`);
                }
            }
            serviceDealerRoutingEntries.push({
                amount: { value: serviceDealerAmount.toFixed(2), currency: 'EUR' },
                destination: { type: 'organization', organizationId: serviceDealerOrganizationId },
            });
        } else {
            console.log(`[fetchSellerRoutingInfo] No admin found for service dealer ${serviceDealerSeller.id}, not routing service dealer fee.`);
        }
    } else {
        console.log(`[fetchSellerRoutingInfo] Service Dealer fee amount is 0 or no service dealer determined; skipping service dealer routing entry.`);
    }

    return {
        vendorRoutingEntries,
        serviceDealerRoutingEntries,
        vendorAmount,
        serviceDealerAmount,
    };
}

async function fetchMollieOrganizationId(accessToken: string): Promise<string> {
    const mollieClient = createMollieClient({ accessToken });
    const organization = await mollieClient.organizations.getCurrent();
    if (!organization || !organization.id) {
        throw new Error('Failed to fetch organization ID from Mollie');
    }
    return organization.id;
}

async function refreshMollieAccessToken(ctx: RequestContext, adminId: ID, refreshToken: string): Promise<string> {
    try {
        const response = await fetch('https://api.mollie.com/oauth2/tokens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: process.env.MOLLIE_CLIENT_ID!,
                client_secret: process.env.MOLLIE_CLIENT_SECRET!,
                refresh_token: refreshToken,
            }).toString(),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to refresh Mollie access token: ${errorData.error_description}`);
        }

        const tokenData = await response.json() as { access_token: string; refresh_token: string };
        const newAccessToken = tokenData.access_token;
        const newRefreshToken = tokenData.refresh_token;

        await multivendorService.saveMollieTokens(ctx, adminId, newAccessToken, newRefreshToken);
        return newAccessToken;
    } catch (error: any) {
        throw new Error(`Failed to refresh Mollie access token: ${error.message}`);
    }
}

// Helper to find an admin for a given service dealer seller using its own channels.
async function findAdminForServiceDealer(ctx: RequestContext, serviceDealer: VendureSeller) {
    const sellerChannelIds = serviceDealer.channels?.map((c: Channel) => c.id) || [];
    const admins = await administratorService.findAll(ctx, {}, ['user', 'user.roles', 'user.roles.channels']);
    const admin = admins.items.find(admin =>
        admin.user.roles.some(role =>
            role.channels?.some((channel: Channel) => sellerChannelIds.includes(channel.id))
        ) && admin.customFields.mollieAccessToken
    );
    console.log(`[findAdminForServiceDealer] For service dealer ${serviceDealer.id}, found admin: ${admin ? admin.id : 'none'}`);
    return admin;
}
