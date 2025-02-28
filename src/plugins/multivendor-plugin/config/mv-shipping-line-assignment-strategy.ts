import {
    Channel,
    ChannelService,
    idsAreEqual,
    Injector,
    Order,
    RequestContext,
    ShippingLine,
    ShippingLineAssignmentStrategy,
} from '@vendure/core';

export class MultivendorShippingLineAssignmentStrategy implements ShippingLineAssignmentStrategy {
    private channelService: ChannelService;

    init(injector: Injector) {
        this.channelService = injector.get(ChannelService);
    }

    async assignShippingLineToOrderLines(ctx: RequestContext, shippingLine: ShippingLine, order: Order) {
        // If the shipping method or its channels aren't available, assign all order lines.
        if (!shippingLine.shippingMethod || !shippingLine.shippingMethod.channels) {
            return order.lines;
        }

        const channels = shippingLine.shippingMethod.channels;
        // For multi-vendor orders we assume that when exactly 2 channels are associated with a shipping method,
        // one is the default channel and the other belongs to the seller.
        if (channels.length === 2) {
            const defaultChannel: Channel = await this.channelService.getDefaultChannel();
            const sellerChannel = channels.find(c => !idsAreEqual(c.id, defaultChannel.id));
            if (sellerChannel) {
                return order.lines.filter(line => idsAreEqual(line.sellerChannelId, sellerChannel.id));
            }
        }

        // Fallback: assign all order lines.
        return order.lines;
    }
}
