import {
    Channel,
    ChannelService,
    EntityHydrator,
    ID,
    idsAreEqual,
    Injector,
    InternalServerError,
    isGraphQlErrorResult,
    Order,
    OrderLine,
    OrderSellerStrategy,
    OrderService,
    PaymentMethod,
    PaymentMethodService,
    PaymentService,
    RequestContext,
    SplitOrderContents,
    Surcharge,
    TransactionalConnection,
} from '@vendure/core';

import { CONNECTED_PAYMENT_METHOD_CODE, MULTIVENDOR_PLUGIN_OPTIONS } from '../constants';
import { MultivendorPluginOptions } from '../types';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomSellerFields {
        connectedAccountId: string;
        shopName?: string;
        firstName?: string;
        lastName?: string;
        emailAddress?: string;
        password?: string;
        address?: string;
        postalCode?: string;
        country?: string;
        vendorType?: string;
        merkDealer?: string;
        merkDistributeur?: string;
    }
}

export class MultivendorSellerStrategy implements OrderSellerStrategy {
    private entityHydrator: EntityHydrator;
    private channelService: ChannelService;
    private paymentService: PaymentService;
    private paymentMethodService: PaymentMethodService;
    private connection: TransactionalConnection;
    private orderService: OrderService;
    private options: MultivendorPluginOptions;

    init(injector: Injector) {
        this.entityHydrator = injector.get(EntityHydrator);
        this.channelService = injector.get(ChannelService);
        this.paymentService = injector.get(PaymentService);
        this.paymentMethodService = injector.get(PaymentMethodService);
        this.connection = injector.get(TransactionalConnection);
        this.orderService = injector.get(OrderService);
        this.options = injector.get(MULTIVENDOR_PLUGIN_OPTIONS);
    }

    async setOrderLineSellerChannel(ctx: RequestContext, orderLine: OrderLine): Promise<Channel | undefined> {
        // Ensure the productVariant is hydrated with its channels.
        await this.entityHydrator.hydrate(ctx, orderLine.productVariant, { relations: ['channels'] });
        const defaultChannel = await this.channelService.getDefaultChannel();

        // Filter out the default channel.
        const sellerChannels = orderLine.productVariant.channels.filter(
            c => !idsAreEqual(c.id, defaultChannel.id)
        );

        if (sellerChannels.length === 0) {
            // No alternative channels available.
            return undefined;
        }

        if (sellerChannels.length === 1) {
            // Only one non-default channel exists, so choose that.
            return sellerChannels[0];
        }

        // When more than one seller channel exists, check if a specific seller channel was provided via customFields.
        const providedSellerChannelId = orderLine.customFields?.requestedSellerChannel;

        console.log(providedSellerChannelId);
        console.log(sellerChannels);

        if (providedSellerChannelId) {
            const selectedChannel = sellerChannels.find(c => c.token == providedSellerChannelId);
            if (selectedChannel) {
                return selectedChannel;
            }
        }

        // Fallback: return the first seller channel or implement additional selection logic.
        return sellerChannels[0];
    }

    async splitOrder(ctx: RequestContext, order: Order): Promise<SplitOrderContents[]> {
        const partialOrders = new Map<ID, SplitOrderContents>();
        for (const line of order.lines) {
            const sellerChannelId = line.sellerChannelId;
            if (sellerChannelId) {
                let partialOrder = partialOrders.get(sellerChannelId);
                if (!partialOrder) {
                    partialOrder = {
                        channelId: sellerChannelId,
                        shippingLines: [],
                        lines: [],
                        state: 'ArrangingPayment',
                    };
                    partialOrders.set(sellerChannelId, partialOrder);
                }
                partialOrder.lines.push(line);
            }
        }

        for (const partialOrder of partialOrders.values()) {
            const shippingLineIds = new Set(partialOrder.lines.map(l => l.shippingLineId));
            partialOrder.shippingLines = order.shippingLines.filter(shippingLine =>
                shippingLineIds.has(shippingLine.id),
            );
        }

        return [...partialOrders.values()];
    }

    async afterSellerOrdersCreated(ctx: RequestContext, aggregateOrder: Order, sellerOrders: Order[]) {
        const paymentMethod = await this.connection.rawConnection.getRepository(PaymentMethod).findOne({
            where: {
                code: CONNECTED_PAYMENT_METHOD_CODE,
            },
        });
        if (!paymentMethod) {
            return;
        }
        const defaultChannel = await this.channelService.getDefaultChannel();
        for (const sellerOrder of sellerOrders) {
            const sellerChannel = sellerOrder.channels.find(c => !idsAreEqual(c.id, defaultChannel.id));
            if (!sellerChannel) {
                throw new InternalServerError(
                    `Could not determine Seller Channel for Order ${sellerOrder.code}`,
                );
            }
            // Hydrate the seller relation on the channel so we can read custom fields
            await this.entityHydrator.hydrate(ctx, sellerChannel, { relations: ['seller'] });

            // Apply custom order fields based on the seller's data
            if (sellerChannel.seller) {
                this.applyCustomOrderFields(sellerOrder, sellerChannel.seller);
            }

            // Apply dynamic fees/surcharges based on the scenario set above
            await this.applyDynamicFees(ctx, sellerOrder);

            // Apply price adjustments and add payment
            await this.orderService.applyPriceAdjustments(ctx, sellerOrder);
            const result = await this.orderService.addPaymentToOrder(ctx, sellerOrder.id, {
                method: paymentMethod.code,
                metadata: {
                    transfer_group: aggregateOrder.code,
                    connectedAccountId: sellerChannel.seller?.customFields.connectedAccountId,
                },
            });
            if (isGraphQlErrorResult(result)) {
                throw new InternalServerError(result.message);
            }
        }
    }

    /**
     * Applies the custom order fields (scenario, primaryVendorId, serviceDealerId, serviceAgentAvailable)
     * based on the seller's custom fields.
     *
     * @param order The order to update.
     * @param seller The seller from the sellerChannel.
     */
    private applyCustomOrderFields(order: Order, seller: any): void {
        const vendorType = seller.customFields?.vendorType;
        let scenario = '';
        let serviceDealerId: string | undefined = undefined;
        let serviceAgentAvailable = false;

        if (vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER') {
            // Scenario 1: Product ordered at a physical store
            scenario = "Product besteld bij een WINKEL";
            serviceDealerId = seller.id; // the physical store acts as its own service dealer
            serviceAgentAvailable = false;
        } else if (vendorType === 'MANUFACTURER') {
            // For a manufacturer, attempt to set the service dealer from the attached fields.
            if (seller.customFields?.merkDealer) {
                serviceDealerId = seller.customFields.merkDealer;
                scenario = "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt";
            } else if (seller.customFields?.merkDistributeur) {
                serviceDealerId = seller.customFields.merkDistributeur;
                scenario = "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt";
            } else {
                scenario = "Product besteld bij een MERK zonder beschikbare SERVICE_DEALER";
            }
            serviceAgentAvailable = false;
        } else if (vendorType === 'BOARDRUSH_PLATFORM') {
            // When Boardrush is the seller, the scenario depends on whether a service dealer is provided.
            scenario = "Product besteld bij BOARDRUSH zelf";
            serviceDealerId = undefined;
            serviceAgentAvailable = false;
        } else {
            scenario = "Onbekend scenario";
        }

        order.customFields.scenario = scenario;
        order.customFields.primaryVendorId = seller.id;
        order.customFields.serviceDealerId = serviceDealerId;
        order.customFields.serviceAgentAvailable = serviceAgentAvailable;
    }

    /**
     * Applies dynamic fees (surcharges) based on the order's scenario.
     *
     * The fee percentages are based on a €100 order:
     *
     * - "Product besteld bij een WINKEL":
     *    Boardrush: 14%
     *
     * - "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt":
     *    Boardrush: 23%, Service Dealer: 10%
     *
     * - "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt":
     *    Boardrush: 18%, Service Dealer: 10%
     *
     * - "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt":
     *    Boardrush: 23%, Service Dealer: 7%
     *
     * - "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt":
     *    Boardrush: 18%, Service Dealer: 7%
     *
     * - "Product besteld bij BOARDRUSH zelf":
     *    Boardrush: 100%
     *
     * - "Product besteld bij BOARDRUSH zelf, service door dealer die merk niet bevat":
     *    Boardrush: 93%, Service Dealer: 7%
     *
     * - "Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat":
     *    Boardrush: 90%, Service Dealer: 10%
     *
     * - "Product besteld bij een MERK zonder beschikbare SERVICE_DEALER":
     *    Boardrush: 23%
     *
     * - "Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER":
     *    Boardrush: 18%
     *
     * The actual fee is computed dynamically as a percentage of the order's totalWithTax.
     */
    private async applyDynamicFees(ctx: RequestContext, order: Order): Promise<void> {
        const scenario = order.customFields.scenario;
        let boardrushFeePercentage = 0;
        let serviceDealerFeePercentage = 0;
        // Use the order total as the base amount
        const orderTotal = order.totalWithTax;

        switch (scenario) {
            case 'Product besteld bij een WINKEL':
                boardrushFeePercentage = 14;
                break;
            case 'Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt':
                boardrushFeePercentage = 23;
                serviceDealerFeePercentage = 10;
                break;
            case 'Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt':
                boardrushFeePercentage = 18;
                serviceDealerFeePercentage = 10;
                break;
            case 'Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt':
                boardrushFeePercentage = 23;
                serviceDealerFeePercentage = 7;
                break;
            case 'Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt':
                boardrushFeePercentage = 18;
                serviceDealerFeePercentage = 7;
                break;
            case 'Product besteld bij BOARDRUSH zelf':
                boardrushFeePercentage = 100;
                break;
            case 'Product besteld bij BOARDRUSH zelf, service door dealer die merk niet bevat':
                boardrushFeePercentage = 93;
                serviceDealerFeePercentage = 7;
                break;
            case 'Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat':
                boardrushFeePercentage = 90;
                serviceDealerFeePercentage = 10;
                break;
            case 'Product besteld bij een MERK zonder beschikbare SERVICE_DEALER':
                boardrushFeePercentage = 23;
                break;
            case 'Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER':
                boardrushFeePercentage = 18;
                break;
            default:
                throw new Error(`Unknown scenario for fee calculation: ${scenario}`);
        }

        const boardrushFee = Math.round(orderTotal * boardrushFeePercentage / 100);
        const serviceDealerFee = serviceDealerFeePercentage ? Math.round(orderTotal * serviceDealerFeePercentage / 100) : 0;

        // Create and save the Boardrush surcharge if applicable.
        if (boardrushFee > 0) {
            const boardrushSurcharge = new Surcharge({
                taxLines: [],
                sku: 'BOARDRUSH_FEE',
                description: 'Boardrush fee',
                listPrice: boardrushFee,
                listPriceIncludesTax: true,
                order,
            });
            await this.connection.getRepository(ctx, Surcharge).save(boardrushSurcharge);
        }

        // Create and save the Service Dealer surcharge if applicable.
        if (serviceDealerFee > 0 && order.customFields.serviceDealerId) {
            const serviceDealerSurcharge = new Surcharge({
                taxLines: [],
                sku: 'SERVICE_DEALER_FEE',
                description: 'Service Dealer fee',
                listPrice: serviceDealerFee,
                listPriceIncludesTax: true,
                order,
            });
            await this.connection.getRepository(ctx, Surcharge).save(serviceDealerSurcharge);
        }
    }
}
