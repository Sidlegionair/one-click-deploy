import {
    AdministratorService, Channel,
    ChannelService,
    CreatePaymentResult, ID,
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

const PLATFORM_FEE_PERCENT = 0.10;

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
    const { routingArray, totalVendorAmount } = await buildRoutingArray(ctx, order);

    const platformAmount = ((amount - totalVendorAmount) / 1000).toFixed(2);
    const platformOrganizationId = 'org_19150821'; // Replace with your actual platform ID

    console.log("Total Amount:", amount);
    console.log("Routing Array:", routingArray);
    console.log("Vendor + Platform Total:", totalVendorAmount + parseFloat(platformAmount));

    try {
        const result = await mollieClient.payments.create(<ExtendedCreateParameters>{
            amount: { value: (amount / 100).toFixed(2), currency: 'EUR' },
            description: `Order ${order.code}`,
            redirectUrl: `${process.env.FRONTEND_URL}/checkout/confirmation/${order.code}`,
            routing: routingArray,
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
        console.error(error);
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
        const aggregatePayment = aggregateOrderWithPayments.payments?.find(payment => payment.state === 'Authorized' || payment.state === 'Settled');
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

async function buildRoutingArray(ctx: RequestContext, order: Order) {
    let routingArray: Array<{
        amount: { value: string; currency: string };
        destination: { type: string; organizationId: string };
    }> = [];
    let totalVendorAmount = 0;

    for (const line of order.lines) {
        const sellerChannelId = line.sellerChannelId?.toString();
        const linePriceWithTax = line.linePriceWithTax / 100; // Convert line price from cents to euros

        if (sellerChannelId) {
            const sellerRoutingInfo = await fetchSellerRoutingInfo(ctx, sellerChannelId, linePriceWithTax);
            routingArray = [...routingArray, ...sellerRoutingInfo.routingArray];
            totalVendorAmount += sellerRoutingInfo.vendorAmount;
        }
    }

    return { routingArray, totalVendorAmount };
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

        // Update the administrator's access and refresh tokens in the database
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

async function fetchSellerRoutingInfo(
    ctx: RequestContext,
    sellerChannelId: string,
    linePriceWithTax: number
): Promise<{ routingArray: Array<{ amount: { value: string; currency: string }; destination: { type: string; organizationId: string } }>; vendorAmount: number }> {
    const sellerChannel = await channelService.findOne(ctx, sellerChannelId);
    if (!sellerChannel) {
        throw new Error(`No associated seller channel found for channel ID ${sellerChannelId}`);
    }

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

    try {
        const mollieOrganizationId = await fetchMollieOrganizationId(mollieAccessToken as string);
        const vendorAmount = (linePriceWithTax * (1 - PLATFORM_FEE_PERCENT)).toFixed(2);

        const routingArray = [{
            amount: { value: vendorAmount, currency: 'EUR' },
            destination: { type: 'organization', organizationId: mollieOrganizationId },
        }];

        return { routingArray, vendorAmount: parseFloat(vendorAmount) };
    } catch (error: any) {
        if (error.response && error.response.status === 401) {
            mollieAccessToken = await refreshMollieAccessToken(ctx, adminId, mollieRefreshToken);
            const mollieOrganizationId = await fetchMollieOrganizationId(mollieAccessToken as string);
            const vendorAmount = (linePriceWithTax * (1 - PLATFORM_FEE_PERCENT)).toFixed(2);

            const routingArray = [{
                amount: { value: vendorAmount, currency: 'EUR' },
                destination: { type: 'organization', organizationId: mollieOrganizationId },
            }];

            return { routingArray, vendorAmount: parseFloat(vendorAmount) };
        } else {
            throw new Error(`Failed to fetch Mollie organization ID: ${error.message}`);
        }
    }
}

async function fetchMollieOrganizationId(accessToken: string): Promise<string> {
    const mollieClient = createMollieClient({ accessToken });
    const organization = await mollieClient.organizations.getCurrent();

    if (!organization || !organization.id) {
        throw new Error('Failed to fetch organization ID from Mollie');
    }
    return organization.id;
}
