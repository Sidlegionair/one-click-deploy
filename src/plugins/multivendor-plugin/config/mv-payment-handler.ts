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
} from '@vendure/core';
import createMollieClient from '@mollie/api-client';
import { CreateParameters } from '@mollie/api-client/dist/types/binders/payments/parameters';

const mollieApiKey: string | undefined = process.env.MOLLIE_API_KEY;
if (!mollieApiKey) {
    throw new Error('Mollie API key is not defined in the environment variables.');
}

/**
 * Computes dynamic fee percentages based on the seller’s custom fields and the order’s custom fields.
 * For a €100 order, the splits are:
 *
 * - "Product besteld bij een WINKEL" (vendorType: PHYSICAL_STORE_OR_SERVICE_DEALER):
 *      Boardrush: 14%, Vendor: 86%
 *
 * - "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt"
 *      (vendorType: MANUFACTURER with merkDealer, serviceAgentAvailable false):
 *      Boardrush: 23%, Service Dealer: 10%, Vendor: 67%
 *
 * - "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt"
 *      (vendorType: MANUFACTURER with merkDealer, serviceAgentAvailable true):
 *      Boardrush: 18%, Service Dealer: 10%, Vendor: 72%
 *
 * - "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt"
 *      (vendorType: MANUFACTURER with merkDistributeur, serviceAgentAvailable false):
 *      Boardrush: 23%, Service Dealer: 7%, Vendor: 70%
 *
 * - "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt"
 *      (vendorType: MANUFACTURER with merkDistributeur, serviceAgentAvailable true):
 *      Boardrush: 18%, Service Dealer: 7%, Vendor: 75%
 *
 * - "Product besteld bij een MERK zonder beschikbare SERVICE_DEALER"
 *      (vendorType: MANUFACTURER with neither merkDealer nor merkDistributeur, serviceAgentAvailable false):
 *      Boardrush: 23%, Vendor: 77%
 *
 * - "Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER"
 *      (vendorType: MANUFACTURER with neither, serviceAgentAvailable true):
 *      Boardrush: 18%, Vendor: 82%
 *
 * - "Product besteld bij BOARDRUSH zelf" (vendorType: BOARDRUSH_PLATFORM without service dealer):
 *      Boardrush: 100%
 *
 * - "Product besteld bij BOARDRUSH zelf, service door dealer die merk niet bevat":
 *      Boardrush: 93%, Service Dealer: 7%
 *
 * - "Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat":
 *      Boardrush: 90%, Service Dealer: 10%
 *
 * Adjust these percentages if your business rules change.
 */
function computeDynamicFeePercentagesForSeller(
    seller: any,
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
        // When Boardrush is the seller, further logic could be applied if a service dealer is attached.
        // For now, if no service dealer is attached, the full amount goes to Boardrush.
        return { boardrush: 100, serviceDealer: 0, vendor: 0 };
    }
    // Fallback defaults:
    return { boardrush: 14, serviceDealer: 0, vendor: 86 };
}

let roleService: RoleService;
let administratorService: AdministratorService;
let orderService: OrderService;
let channelService: ChannelService;
let connection: TransactionalConnection;

interface ExtendedCreateParameters extends CreateParameters {
    routing?: Array<{
        amount: {
            value: string;
            currency: string;
        };
        destination: {
            type: 'organization';
            organizationId: string;
        };
    }>;
}

export const molliePaymentMethodHandler = new PaymentMethodHandler({
    init(injector) {
        roleService = injector.get(RoleService);
        orderService = injector.get(OrderService);
        administratorService = injector.get(AdministratorService);
        channelService = injector.get(ChannelService);
        connection = injector.get(TransactionalConnection);
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
        if (order.type === 'Regular') {
            return await createAggregatePayment(ctx, order, amount, metadata);
        } else if (order.type === 'Seller') {
            return await referenceAggregateOrderPayment(ctx, order, amount);
        } else {
            throw new Error(`Unsupported order type: ${order.type}`);
        }
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
    // Build routing arrays for vendor and service dealer from all order lines.
    const {
        vendorRoutingArray,
        serviceDealerRoutingArray,
        totalVendorAmount,
        totalServiceDealerAmount,
    } = await buildRoutingArray(ctx, order);

    // Convert the aggregate order amount from cents to euros.
    const orderAmountEuros = amount / 100;
    // Platform's share is the remainder.
    const platformAmount = parseFloat(
        (orderAmountEuros - totalVendorAmount - totalServiceDealerAmount).toFixed(2)
    );
    const platformOrganizationId = 'org_19150821'; // Replace with your actual platform ID

    // Final routing array: vendor entries, service dealer entries, and a platform entry.
    const finalRoutingArray = [
        ...vendorRoutingArray,
        ...serviceDealerRoutingArray,
        {
            amount: { value: platformAmount.toFixed(2), currency: 'EUR' },
            destination: { type: 'organization', organizationId: platformOrganizationId },
        },
    ];

    console.log("Order Amount (EUR):", orderAmountEuros);
    console.log("Vendor Routing Array:", vendorRoutingArray);
    console.log("Service Dealer Routing Array:", serviceDealerRoutingArray);
    console.log("Total Vendor Amount (EUR):", totalVendorAmount);
    console.log("Total Service Dealer Amount (EUR):", totalServiceDealerAmount);
    console.log("Platform Amount (EUR):", platformAmount);
    console.log("Final Routing Array:", finalRoutingArray);

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

async function referenceAggregateOrderPayment(
    ctx: RequestContext,
    order: Order,
    amount: number
): Promise<CreatePaymentResult> {
    try {
        const aggregateOrder = await orderService.getAggregateOrder(ctx, order);
        if (!aggregateOrder) {
            throw new Error(`Aggregate order not found for seller order ${order.code}`);
        }

        const aggregateOrderWithPayments = await orderService.findOne(ctx, aggregateOrder.id, ['payments']);
        if (!aggregateOrderWithPayments) {
            throw new Error(`Aggregate order with ID ${aggregateOrder.id} not found`);
        }
        const aggregatePayment = aggregateOrderWithPayments.payments?.find(
            payment => payment.state === 'Authorized' || payment.state === 'Settled'
        );
        if (!aggregatePayment) {
            throw new Error(`No valid payment found for aggregate order ${aggregateOrderWithPayments.code}`);
        }

        return {
            amount,
            state: aggregatePayment.state as 'Authorized' | 'Settled',
            transactionId: aggregatePayment.transactionId,
            metadata: {
                ...aggregatePayment.metadata,
                transactionId: aggregatePayment.transactionId,
            },
        };
    } catch (error: any) {
        console.error(`Error referencing payment for seller order ${order.code}:`, error);
        return {
            amount,
            state: 'Declined' as const,
            metadata: {
                errorMessage: `Reference payment failed: ${error.message}`,
            },
        };
    }
}

/**
 * Loops over each order line and for those with a sellerChannel,
 * computes dynamic routing entries using the seller’s dynamic fee percentages.
 * Returns arrays of routing entries (vendor and service dealer) and the total amounts.
 */
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

    for (const line of order.lines) {
        const sellerChannelId = line.sellerChannelId?.toString();
        // Convert the line price from cents to euros.
        const linePriceEuros = line.linePriceWithTax / 100;
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

    return { vendorRoutingArray, serviceDealerRoutingArray, totalVendorAmount, totalServiceDealerAmount };
}

/**
 * For a given seller channel and line price (in euros), this function:
 * - Fetches the seller’s Mollie organization ID via an eligible admin (found by role/channel membership),
 * - Computes dynamic fee splits using computeDynamicFeePercentagesForSeller,
 * - Returns routing entries for the vendor and, if applicable, for the service dealer.
 */
async function fetchSellerRoutingInfo(
    ctx: RequestContext,
    sellerChannelId: string,
    linePriceEuros: number,
    order: Order
): Promise<{
    vendorRoutingEntries: Array<{ amount: { value: string; currency: string }; destination: { type: string; organizationId: string } }>;
    serviceDealerRoutingEntries: Array<{ amount: { value: string; currency: string }; destination: { type: string; organizationId: string } }>;
    vendorAmount: number;
    serviceDealerAmount: number;
}> {
    const sellerChannel = await channelService.findOne(ctx, sellerChannelId);
    if (!sellerChannel) {
        throw new Error(`No associated seller channel found for channel ID ${sellerChannelId}`);
    }
    if (!sellerChannel.seller) {
        throw new Error(`Seller not found for seller channel ${sellerChannel.code}`);
    }
    const seller = sellerChannel.seller;
    // Compute dynamic fee percentages based on seller and order.
    const percentages = computeDynamicFeePercentagesForSeller(seller, order);
    // Calculate vendor and service dealer amounts.
    const vendorAmount = parseFloat((linePriceEuros * (percentages.vendor / 100)).toFixed(2));
    const serviceDealerAmount = percentages.serviceDealer > 0
        ? parseFloat((linePriceEuros * (percentages.serviceDealer / 100)).toFixed(2))
        : 0;

    // Find an eligible admin based on roles and channels (no need for a custom sellerId).
    const admins = await administratorService.findAll(ctx, {}, ['user', 'user.roles', 'user.roles.channels']);
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

    // Fetch vendor's Mollie organization ID.
    let vendorOrganizationId: string;
    try {
        vendorOrganizationId = await fetchMollieOrganizationId(mollieAccessToken as string);
    } catch (error: any) {
        if (error.response && error.response.status === 401) {
            mollieAccessToken = await refreshMollieAccessToken(ctx, adminId, mollieRefreshToken);
            vendorOrganizationId = await fetchMollieOrganizationId(mollieAccessToken as string);
        } else {
            throw new Error(`Failed to fetch Mollie organization ID: ${error.message}`);
        }
    }

    const vendorRoutingEntry = {
        amount: { value: vendorAmount.toFixed(2), currency: 'EUR' },
        destination: { type: 'organization', organizationId: vendorOrganizationId },
    };

    let serviceDealerRoutingEntries: Array<{ amount: { value: string; currency: string }; destination: { type: string; organizationId: string } }> = [];
    if (serviceDealerAmount > 0) {
        // Determine service dealer from seller's custom fields (merkDealer or merkDistributeur)
        const serviceDealerId = seller.customFields?.merkDealer || seller.customFields?.merkDistributeur;
        if (serviceDealerId) {
            // Try to find an admin corresponding to the service dealer.
            const serviceDealerAdmin = admins.items.find(admin =>
                admin.customFields && admin.customFields.mollieAccessToken &&
                // Here, instead of relying on a custom sellerId, you can compare the admin's email address
                // or any other field that uniquely identifies the service dealer.
                // Adjust this condition as needed:
                admin.emailAddress.toLowerCase().includes(serviceDealerId.toLowerCase())
            );
            let serviceDealerOrganizationId: string;
            if (serviceDealerAdmin) {
                let dealerAccessToken = serviceDealerAdmin.customFields.mollieAccessToken;
                const dealerAdminId = serviceDealerAdmin.id;
                const dealerRefreshToken = serviceDealerAdmin.customFields.mollieRefreshToken;
                if (!dealerRefreshToken) {
                    throw new Error(`Mollie refresh token is missing for service dealer admin ID: ${dealerAdminId}`);
                }
                try {
                    serviceDealerOrganizationId = await fetchMollieOrganizationId(dealerAccessToken as string);
                } catch (error: any) {
                    if (error.response && error.response.status === 401) {
                        dealerAccessToken = await refreshMollieAccessToken(ctx, dealerAdminId, dealerRefreshToken);
                        serviceDealerOrganizationId = await fetchMollieOrganizationId(dealerAccessToken as string);
                    } else {
                        throw new Error(`Failed to fetch service dealer Mollie organization ID: ${error.message}`);
                    }
                }
                serviceDealerRoutingEntries.push({
                    amount: { value: serviceDealerAmount.toFixed(2), currency: 'EUR' },
                    destination: { type: 'organization', organizationId: serviceDealerOrganizationId },
                });
            } else {
                // Fallback: if no dedicated service dealer admin is found, route to the vendor's organization.
                serviceDealerRoutingEntries.push({
                    amount: { value: serviceDealerAmount.toFixed(2), currency: 'EUR' },
                    destination: { type: 'organization', organizationId: vendorOrganizationId },
                });
            }
        }
    }

    return {
        vendorRoutingEntries: [vendorRoutingEntry],
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
            const errorData = (await response.json()) as { error_description: string };
            throw new Error(`Failed to refresh Mollie access token: ${errorData.error_description}`);
        }

        const tokenData = (await response.json()) as { access_token: string; refresh_token: string };
        const newAccessToken = tokenData.access_token;
        const newRefreshToken = tokenData.refresh_token;

        // Update the administrator's tokens in the database.
        await administratorService.update(ctx, {
            id: adminId,
            customFields: {
                mollieAccessToken: newAccessToken,
                mollieRefreshToken: newRefreshToken,
            },
        });

        return newAccessToken;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to refresh Mollie access token: ${error.message}`);
        }
        throw new Error('Failed to refresh Mollie access token due to an unknown error.');
    }
}
