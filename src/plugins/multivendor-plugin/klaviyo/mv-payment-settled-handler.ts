import { PaymentStateTransitionEvent, OrderService, Order, Payment, OrderLine, Type } from '@vendure/core';
import {
    KlaviyoOrderPlacedEvent,
    KlaviyoOrderPlacedEventHandler,
} from '@pinelab/vendure-plugin-klaviyo';

/**
 * Custom type for Klaviyo event handler that works with PaymentStateTransitionEvent
 * This extends the KlaviyoOrderPlacedEventHandler but uses PaymentStateTransitionEvent
 * instead of OrderPlacedEvent
 */
export interface KlaviyoPaymentSettledEventHandler extends Omit<KlaviyoOrderPlacedEventHandler, 'vendureEvent' | 'mapToKlaviyoEvent'> {
    vendureEvent: Type<PaymentStateTransitionEvent>;
    mapToKlaviyoEvent: (
        event: PaymentStateTransitionEvent,
        injector: any
    ) => Promise<KlaviyoOrderPlacedEvent | false>;
}

/**
 * Custom Klaviyo handler that sends order confirmation only after payment is settled.
 * This replaces the default OrderPlacedEvent handler to ensure emails are only sent
 * after successful payment.
 */
export const mvPaymentSettledHandler: KlaviyoPaymentSettledEventHandler = {
    vendureEvent: PaymentStateTransitionEvent,
    mapToKlaviyoEvent: async (
        event: PaymentStateTransitionEvent,
        injector: any
    ): Promise<KlaviyoOrderPlacedEvent | false> => {
        // Only proceed if the payment is transitioning to the 'Settled' state
        if (event.toState !== 'Settled') {
            return false;
        }

        const payment = event.payment;
        const orderService = injector.get(OrderService);
        const ctx = event.ctx;

        // Get the order associated with this payment
        const order = await orderService.findOne(ctx, payment.order.id);
        if (!order) {
            console.error(`Order not found for payment ${payment.id}`);
            return false;
        }

        console.log(`Processing payment settled event for order ${order.code}`);

        // Map each order line to match KlaviyoOrderItem's properties.
        const customOrderItems = order.lines.map((line: OrderLine) => ({
            ProductID: String(line.productVariant?.product?.id), // Ensure the product ID is a string.
            SKU: line.productVariant?.sku,
            ProductName: line.productVariant?.name,
            Quantity: line.quantity,
            ItemPrice: line.unitPrice,                          // Using unit price as the item price.
            RowTotal: line.unitPrice * line.quantity,           // Calculated total for the order line.
            Brand: line.productVariant?.product?.customFields?.brand,          // Include brand information.
            // Add seller information per line inside customProperties.
            customProperties: {
                seller: line.customFields?.requestedSellerChannel,
            }
        }));

        return {
            uniqueId: `payment-settled-${order.id}-${Date.now()}`,
            eventName: 'Order Placed',
            profile: {
                emailAddress: order.customer?.emailAddress,
                externalId: order.customer?.id.toString(),
                firstName: order.customer?.firstName,
                lastName: order.customer?.lastName,
            },
            orderId: order.id,
            orderPlacedAt: order.createdAt,      // The date/time when the order was created.
            totalOrderValue: order.total,         // The total value of the order.
            orderItems: customOrderItems,         // The mapped order line items.
        } as KlaviyoOrderPlacedEvent;
    },
};
