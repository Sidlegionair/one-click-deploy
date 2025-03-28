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
    Seller as VendureSeller,
    SplitOrderContents,
    Surcharge,
    TransactionalConnection,
    Product,
} from '@vendure/core';

import { CONNECTED_PAYMENT_METHOD_CODE, MULTIVENDOR_PLUGIN_OPTIONS } from '../constants';
import { MultivendorPluginOptions } from '../types';

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
        console.log('[init] EntityHydrator initialized.');
        this.channelService = injector.get(ChannelService);
        console.log('[init] ChannelService initialized.');
        this.paymentService = injector.get(PaymentService);
        console.log('[init] PaymentService initialized.');
        this.paymentMethodService = injector.get(PaymentMethodService);
        console.log('[init] PaymentMethodService initialized.');
        this.connection = injector.get(TransactionalConnection);
        console.log('[init] TransactionalConnection initialized.');
        this.orderService = injector.get(OrderService);
        console.log('[init] OrderService initialized.');
        this.options = injector.get(MULTIVENDOR_PLUGIN_OPTIONS);
        console.log('[init] MultivendorPluginOptions initialized.');
    }

    async setOrderLineSellerChannel(ctx: RequestContext, orderLine: OrderLine): Promise<Channel | undefined> {
        console.log('[setOrderLineSellerChannel] Processing order line:', orderLine.id);
        await this.entityHydrator.hydrate(ctx, orderLine.productVariant, { relations: ['channels'] });
        console.log('[setOrderLineSellerChannel] Hydrated productVariant channels:', orderLine.productVariant.channels);
        const defaultChannel = await this.channelService.getDefaultChannel();
        console.log('[setOrderLineSellerChannel] Default channel:', defaultChannel);

        const sellerChannels = orderLine.productVariant.channels.filter(
            c => !idsAreEqual(c.id, defaultChannel.id)
        );
        console.log('[setOrderLineSellerChannel] Seller channels after filtering:', sellerChannels);

        if (sellerChannels.length === 0) {
            console.log('[setOrderLineSellerChannel] No seller channels found.');
            return undefined;
        }
        if (sellerChannels.length === 1) {
            console.log('[setOrderLineSellerChannel] One seller channel found. Using it.');
            return sellerChannels[0];
        }
        const providedSellerChannelId = orderLine.customFields?.requestedSellerChannel;
        console.log('[setOrderLineSellerChannel] Provided seller channel id:', providedSellerChannelId);
        if (providedSellerChannelId) {
            const selectedChannel = sellerChannels.find(c => c.token == providedSellerChannelId);
            if (selectedChannel) {
                console.log('[setOrderLineSellerChannel] Selected channel based on provided id:', selectedChannel);
                return selectedChannel;
            }
            console.warn('[setOrderLineSellerChannel] Provided seller channel id did not match any available channels.');
        }
        console.log('[setOrderLineSellerChannel] Falling back to the first available seller channel.');
        return sellerChannels[0];
    }

    async splitOrder(ctx: RequestContext, order: Order): Promise<SplitOrderContents[]> {
        console.log('[splitOrder] Splitting order:', order.id);
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
                    console.log(`[splitOrder] Created new partial order for channel: ${sellerChannelId}`);
                }
                partialOrder.lines.push(line);
                console.log(`[splitOrder] Added line ${line.id} to partial order for channel: ${sellerChannelId}`);
            }
        }
        for (const partialOrder of partialOrders.values()) {
            const shippingLineIds = new Set(partialOrder.lines.map(l => l.shippingLineId));
            partialOrder.shippingLines = order.shippingLines.filter(shippingLine =>
                shippingLineIds.has(shippingLine.id)
            );
            console.log('[splitOrder] Matched shipping lines for partial order:', partialOrder.channelId, partialOrder.shippingLines);
        }
        console.log('[splitOrder] Completed splitting order.');
        return [...partialOrders.values()];
    }

    async afterSellerOrdersCreated(ctx: RequestContext, aggregateOrder: Order, sellerOrders: Order[]) {
        console.log('[afterSellerOrdersCreated] Processing seller orders for aggregate order:', aggregateOrder.code);
        const paymentMethod = await this.connection.rawConnection.getRepository(PaymentMethod).findOne({
            where: { code: CONNECTED_PAYMENT_METHOD_CODE },
        });
        if (!paymentMethod) {
            console.warn('[afterSellerOrdersCreated] No connected payment method found, aborting further processing.');
            return;
        }
        console.log('[afterSellerOrdersCreated] Payment method found:', paymentMethod.code);
        const defaultChannel = await this.channelService.getDefaultChannel();
        console.log('[afterSellerOrdersCreated] Default channel:', defaultChannel);
        for (const sellerOrder of sellerOrders) {
            console.log('[afterSellerOrdersCreated] Processing seller order:', sellerOrder.code);
            const sellerChannel = sellerOrder.channels.find(c => !idsAreEqual(c.id, defaultChannel.id));
            if (!sellerChannel) {
                console.error(`[afterSellerOrdersCreated] Could not determine Seller Channel for Order ${sellerOrder.code}`);
                throw new InternalServerError(`Could not determine Seller Channel for Order ${sellerOrder.code}`);
            }
            console.log('[afterSellerOrdersCreated] Seller channel determined:', sellerChannel);
            await this.entityHydrator.hydrate(ctx, sellerChannel, { relations: ['seller'] });
            if (sellerChannel.seller) {
                await this.entityHydrator.hydrate(ctx, sellerChannel.seller, { relations: ['customFields.merkDealer', 'customFields.merkDistributeur'] });
            } else {
                throw new Error(`Seller is not defined on sellerChannel ${sellerChannel.id}`);
            }
            console.log('[afterSellerOrdersCreated] Hydrated seller for channel:', sellerChannel.id, sellerChannel.seller);
            console.log('[afterSellerOrdersCreated] Seller details:', sellerChannel.seller);
            if (sellerChannel.seller) {
                console.log('[afterSellerOrdersCreated] Applying custom order fields for seller:', sellerChannel.seller.id);
                await this.applyCustomOrderFields(ctx, sellerOrder, sellerChannel.seller);
            } else {
                console.warn(`[afterSellerOrdersCreated] No seller found on channel ${sellerChannel.id}`);
            }
            console.log('[afterSellerOrdersCreated] Applying dynamic fees for seller order:', sellerOrder.code);
            await this.applyDynamicFees(ctx, sellerOrder);
            console.log('[afterSellerOrdersCreated] Applying price adjustments for seller order:', sellerOrder.code);
            await this.orderService.applyPriceAdjustments(ctx, sellerOrder);
            console.log('[afterSellerOrdersCreated] Adding payment to seller order:', sellerOrder.code);
            const result = await this.orderService.addPaymentToOrder(ctx, sellerOrder.id, {
                method: paymentMethod.code,
                metadata: {
                    transfer_group: aggregateOrder.code,
                    connectedAccountId: sellerChannel.seller?.customFields.connectedAccountId,
                },
            });
            if (isGraphQlErrorResult(result)) {
                console.error('[afterSellerOrdersCreated] Error adding payment to order:', result.message);
                throw new InternalServerError(result.message);
            }
            console.log('[afterSellerOrdersCreated] Payment added successfully to seller order:', sellerOrder.code);
        }
    }

    /**
     * Applies custom order fields based on the seller's custom fields.
     * This method is async so that we can query dealer channels and products.
     */
    private async applyCustomOrderFields(ctx: RequestContext, order: Order, seller: VendureSeller): Promise<void> {
        console.log('[applyCustomOrderFields] Seller details:', seller);
        console.log('[applyCustomOrderFields] Applying custom fields for order:', order.code);
        const vendorType = seller.customFields?.vendorType;
        let scenario = '';
        let serviceDealer: VendureSeller | null = null;
        let serviceAgentAvailable = false;
        // Extract brand from the first order line's product variant custom fields.
        const brand: string | undefined = order.lines[0]?.productVariant?.customFields?.brand;
        if (vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER') {
            scenario = "Product besteld bij een WINKEL";
            serviceDealer = seller;
            serviceAgentAvailable = false;
            console.log('[applyCustomOrderFields] Vendor type PHYSICAL_STORE_OR_SERVICE_DEALER detected.');
        } else if (vendorType === 'MANUFACTURER') {
            if (seller.customFields?.merkDealer) {
                serviceDealer = seller.customFields.merkDealer;
                // Check if this dealer carries the brand.
                const carries = brand ? await this.findServiceDealerCarryingBrand(ctx, serviceDealer, brand) : false;
                if (carries) {
                    scenario = "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt";
                    serviceAgentAvailable = true;
                    console.log('[applyCustomOrderFields] Manufacturer with merkDealer found and dealer carries brand. (Scenario 3)');
                } else {
                    scenario = "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt";
                    serviceAgentAvailable = false;
                    console.log('[applyCustomOrderFields] Manufacturer with merkDealer found but dealer does not carry brand. (Scenario 2)');
                }
            } else if (seller.customFields?.merkDistributeur) {
                serviceDealer = seller.customFields.merkDistributeur;
                const carries = brand ? await this.findServiceDealerCarryingBrand(ctx, serviceDealer, brand) : false;
                if (carries) {
                    scenario = "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt";
                    serviceAgentAvailable = true;
                    console.log('[applyCustomOrderFields] Manufacturer with merkDistributeur found and dealer carries brand. (Scenario 5)');
                } else {
                    scenario = "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt";
                    serviceAgentAvailable = false;
                    console.log('[applyCustomOrderFields] Manufacturer with merkDistributeur found but dealer does not carry brand. (Scenario 4)');
                }
            } else {
                serviceDealer = null;
                scenario = "Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER";
                serviceAgentAvailable = true;
                console.log('[applyCustomOrderFields] Manufacturer without service dealer found. (Scenario 10)');
            }
        } else if (vendorType === 'BOARDRUSH_PLATFORM') {
            if (!brand) {
                console.warn('[applyCustomOrderFields] No brand found on order line for BOARDRUSH order, defaulting scenario.');
                scenario = "Product besteld bij BOARDRUSH zelf";
            } else {
                // Check if any dealer channel for this seller carries the brand.
                const dealerCarriesBrand = await this.findAnyDealerChannelCarryingBrand(ctx, seller, brand);
                if (dealerCarriesBrand) {
                    scenario = "Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat";
                    console.log('[applyCustomOrderFields] BOARDRUSH order processed. Dealer contains the brand. (Scenario 8)');
                } else {
                    scenario = "Product besteld bij BOARDRUSH zelf, service door dealer die merk niet bevat";
                    console.log('[applyCustomOrderFields] BOARDRUSH order processed. Dealer does NOT contain the brand. (Scenario 7)');
                }
            }
            serviceDealer = null;
            serviceAgentAvailable = false;
            console.log('[applyCustomOrderFields] Vendor type BOARDRUSH_PLATFORM detected.');
        } else {
            scenario = "Onbekend scenario";
            console.warn('[applyCustomOrderFields] Unknown vendor type:', vendorType);
        }
        order.customFields.scenario = scenario;
        order.customFields.primaryVendor = seller;
        order.customFields.serviceDealer = serviceDealer;
        order.customFields.serviceAgentAvailable = serviceAgentAvailable;
        console.log('[applyCustomOrderFields] Custom fields applied:', order.customFields);
    }

    /**
     * Helper method that determines if the given service dealer carries the specified brand.
     * Loops through all dealer channels for the given service dealer.
     */
    private async findServiceDealerCarryingBrand(ctx: RequestContext, serviceDealer: VendureSeller, brand: string): Promise<boolean> {
        const dealerChannels = await this.getDealerChannelsForSeller(ctx, serviceDealer);
        for (const channel of dealerChannels) {
            const products = await this.getProductsByChannel(ctx, channel.id);
            if (products.some(product => product.customFields?.brand === brand)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Helper method for BOARDRUSH orders that checks if any dealer channel for the given seller carries the brand.
     */
    private async findAnyDealerChannelCarryingBrand(ctx: RequestContext, seller: VendureSeller, brand: string): Promise<boolean> {
        const dealerChannels = await this.getDealerChannelsForSeller(ctx, seller);
        for (const channel of dealerChannels) {
            const products = await this.getProductsByChannel(ctx, channel.id);
            if (products.some(product => product.customFields?.brand === brand)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Retrieves all dealer channels associated with the given seller.
     * This implementation uses the ChannelService to get all channels and filters those whose seller ID matches.
     */
    private async getDealerChannelsForSeller(ctx: RequestContext, seller: VendureSeller): Promise<Channel[]> {
        const paginatedChannels = await this.channelService.findAll(ctx);
        return paginatedChannels.items.filter(channel => channel.seller && channel.seller.id === seller.id);
    }

    /**
     * Retrieves all products for the given channel.
     * This uses the Vendure Product repository.
     */
    private async getProductsByChannel(ctx: RequestContext, channelId: ID): Promise<Product[]> {
        return await this.connection.getRepository(ctx, Product).find({
            relations: ['channels'],
            where: { channels: { id: channelId } },
        });
    }

    private async applyDynamicFees(ctx: RequestContext, order: Order): Promise<void> {
        console.log('[applyDynamicFees] Starting fee determination for order:', order.code);
        const scenario = order.customFields.scenario;
        let boardrushFeePercentage = 0;
        let serviceDealerFeePercentage = 0;
        const orderTotal = order.totalWithTax;
        console.log(`[applyDynamicFees] Order total: ${orderTotal}, Scenario: "${scenario}"`);
        switch (scenario) {
            case 'Product besteld bij een WINKEL':
                boardrushFeePercentage = 14;
                console.log('[applyDynamicFees] Scenario "Product besteld bij een WINKEL": Boardrush fee set to 14%');
                break;
            case 'Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt':
                boardrushFeePercentage = 23;
                serviceDealerFeePercentage = 10;
                console.log('[applyDynamicFees] Scenario "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt": Boardrush fee set to 23%, Service Dealer fee set to 10%');
                break;
            case 'Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt':
                boardrushFeePercentage = 18;
                serviceDealerFeePercentage = 10;
                console.log('[applyDynamicFees] Scenario "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt": Boardrush fee set to 18%, Service Dealer fee set to 10%');
                break;
            case 'Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt':
                boardrushFeePercentage = 23;
                serviceDealerFeePercentage = 7;
                console.log('[applyDynamicFees] Scenario "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt": Boardrush fee set to 23%, Service Dealer fee set to 7%');
                break;
            case 'Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt':
                boardrushFeePercentage = 18;
                serviceDealerFeePercentage = 7;
                console.log('[applyDynamicFees] Scenario "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt": Boardrush fee set to 18%, Service Dealer fee set to 7%');
                break;
            case 'Product besteld bij BOARDRUSH zelf':
                boardrushFeePercentage = 100;
                console.log('[applyDynamicFees] Scenario "Product besteld bij BOARDRUSH zelf": Boardrush fee set to 100%');
                break;
            case 'Product besteld bij BOARDRUSH zelf, service door dealer die merk niet bevat':
                boardrushFeePercentage = 93;
                serviceDealerFeePercentage = 7;
                console.log('[applyDynamicFees] Scenario "Product besteld bij BOARDRUSH zelf, service door dealer die merk niet bevat": Boardrush fee set to 93%, Service Dealer fee set to 7%');
                break;
            case 'Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat':
                boardrushFeePercentage = 90;
                serviceDealerFeePercentage = 10;
                console.log('[applyDynamicFees] Scenario "Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat": Boardrush fee set to 90%, Service Dealer fee set to 10%');
                break;
            case 'Product besteld bij een MERK zonder beschikbare SERVICE_DEALER':
                boardrushFeePercentage = 23;
                console.log('[applyDynamicFees] Scenario "Product besteld bij een MERK zonder beschikbare SERVICE_DEALER": Boardrush fee set to 23%');
                break;
            case 'Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER':
                boardrushFeePercentage = 18;
                console.log('[applyDynamicFees] Scenario "Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER": Boardrush fee set to 18%');
                break;
            default:
                console.error(`[applyDynamicFees] Unknown scenario for fee calculation: ${scenario}`);
                throw new Error(`Unknown scenario for fee calculation: ${scenario}`);
        }
        console.log(`[applyDynamicFees] Determined fee percentages: Boardrush: ${boardrushFeePercentage}%, Service Dealer: ${serviceDealerFeePercentage}%`);
        const boardrushFee = Math.round(orderTotal * boardrushFeePercentage / 100);
        const serviceDealerFee = serviceDealerFeePercentage ? Math.round(orderTotal * serviceDealerFeePercentage / 100) : 0;
        console.log(`[applyDynamicFees] Calculated Boardrush fee: ${boardrushFee} (${boardrushFeePercentage}% of ${orderTotal})`);
        console.log(`[applyDynamicFees] Calculated Service Dealer fee: ${serviceDealerFee} (${serviceDealerFeePercentage}% of ${orderTotal})`);
        const surcharges: Surcharge[] = [];
        if (boardrushFee > 0) {
            console.log(`[applyDynamicFees] Saving Boardrush surcharge with fee: ${boardrushFee}`);
            const boardrushSurcharge = new Surcharge({
                taxLines: [],
                sku: 'BOARDRUSH_FEE',
                description: 'Boardrush fee',
                listPrice: boardrushFee,
                listPriceIncludesTax: true,
                order,
            });
            const savedBoardrushSurcharge = await this.connection.getRepository(ctx, Surcharge).save(boardrushSurcharge);
            surcharges.push(savedBoardrushSurcharge);
            console.log('[applyDynamicFees] Boardrush surcharge saved successfully.');
        } else {
            console.log('[applyDynamicFees] No Boardrush fee applicable, skipping surcharge creation.');
        }
        if (serviceDealerFee > 0) {
            if (order.customFields.serviceDealer) {
                console.log(`[applyDynamicFees] Saving Service Dealer surcharge with fee: ${serviceDealerFee} for serviceDealer: ${order.customFields.serviceDealer.id}`);
                const serviceDealerSurcharge = new Surcharge({
                    taxLines: [],
                    sku: 'SERVICE_DEALER_FEE',
                    description: 'Service Dealer fee',
                    listPrice: serviceDealerFee,
                    listPriceIncludesTax: true,
                    order,
                });
                const savedServiceDealerSurcharge = await this.connection.getRepository(ctx, Surcharge).save(serviceDealerSurcharge);
                surcharges.push(savedServiceDealerSurcharge);
                console.log('[applyDynamicFees] Service Dealer surcharge saved successfully.');
            } else {
                console.warn(`[applyDynamicFees] Service Dealer fee calculated as ${serviceDealerFee} but no serviceDealer provided. Skipping surcharge creation.`);
            }
        } else {
            console.log('[applyDynamicFees] No Service Dealer fee applicable, skipping surcharge creation.');
        }
        order.surcharges = surcharges;
        console.log('[applyDynamicFees] Order surcharges updated:', order.surcharges);
        console.log('[applyDynamicFees] Fee determination and surcharge application completed.');
    }
}
