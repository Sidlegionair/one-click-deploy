// mv-order-placed-handler.ts

import { OrderPlacedEvent, OrderLine } from '@vendure/core';
import {
    KlaviyoOrderPlacedEvent,
    KlaviyoOrderPlacedEventHandler,
} from '@pinelab/vendure-plugin-klaviyo';

/**
 * Custom Klaviyo Order Placed event handler that sends additional custom product data,
 * including brand and seller (per order line), along with order details to Klaviyo.
 *
 * Note: When using this custom handler, remove the default order placed handler from your Vendure configuration.
 */
export const mvOrderPlacedHandler: KlaviyoOrderPlacedEventHandler = {
    vendureEvent: OrderPlacedEvent,
    mapToKlaviyoEvent: async (
        event: OrderPlacedEvent,
        injector: any
    ): Promise<KlaviyoOrderPlacedEvent> => {
        const { order } = event;

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
            uniqueId: `order-placed-${order.id}-${Date.now()}`,
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
