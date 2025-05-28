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
} from '@vendure/core';

import { CONNECTED_PAYMENT_METHOD_CODE, MULTIVENDOR_PLUGIN_OPTIONS } from '../constants';
import { MultivendorPluginOptions } from '../types';
import { VendorSelectionService } from '../service/vendor-selection.service';


/**
 * The MultivendorSellerStrategy class implements the OrderSellerStrategy interface.
 * It handles the assignment of seller channels to order lines, splitting orders per seller,
 * applying custom order fields and dynamic fees based on various scenarios.
 */
export class MultivendorSellerStrategy implements OrderSellerStrategy {
    private entityHydrator: EntityHydrator;
    private channelService: ChannelService;
    private paymentService: PaymentService;
    private paymentMethodService: PaymentMethodService;
    private connection: TransactionalConnection;
    private orderService: OrderService;
    private options: MultivendorPluginOptions;
    private vendorSelectionService: VendorSelectionService;

    /**
     * Initializes the services and options needed for the strategy.
     * @param injector The dependency injector.
     */
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
        this.vendorSelectionService = injector.get(VendorSelectionService);
        console.log('[init] VendorSelectionService initialized.');
    }

    /**
     * Determines the seller channel for an order line.
     * Hydrates the productVariant channels, filters out the default channel,
     * and returns either the single non-default channel or the one matching a provided token.
     *
     * @param ctx The request context.
     * @param orderLine The order line to process.
     * @returns The selected seller Channel or undefined.
     */
    async setOrderLineSellerChannel(ctx: RequestContext, orderLine: OrderLine): Promise<Channel | undefined> {
        console.log('[setOrderLineSellerChannel] Processing order line:', orderLine.id);

        // Check if a specific seller channel was requested via customFields
        const requestedSellerChannel = orderLine.customFields?.requestedSellerChannel;
        console.log('[setOrderLineSellerChannel] Requested seller channel:', requestedSellerChannel);

        // Ensure the productVariant is hydrated with its channels
        await this.entityHydrator.hydrate(ctx, orderLine.productVariant, { relations: ['channels'] });
        console.log('[setOrderLineSellerChannel] Hydrated productVariant channels:', orderLine.productVariant.channels);
        const defaultChannel = await this.channelService.getDefaultChannel();
        console.log('[setOrderLineSellerChannel] Default channel:', defaultChannel);

        // Filter out the default channel
        const sellerChannels = orderLine.productVariant.channels.filter(
            c => !idsAreEqual(c.id, defaultChannel.id)
        );
        console.log('[setOrderLineSellerChannel] Seller channels after filtering:', sellerChannels);

        if (sellerChannels.length === 0) {
            console.log('[setOrderLineSellerChannel] No seller channels found.');
            return undefined;
        }

        // If a specific seller channel was requested and it exists, use it
        if (requestedSellerChannel) {
            const selectedChannel = sellerChannels.find(c => c.token === requestedSellerChannel);
            if (selectedChannel) {
                console.log('[setOrderLineSellerChannel] Using requested seller channel:', selectedChannel);
                return selectedChannel;
            }
            console.warn('[setOrderLineSellerChannel] Requested seller channel not found among available channels.');
        }

        // If there's only one seller channel, use it
        if (sellerChannels.length === 1) {
            console.log('[setOrderLineSellerChannel] Only one seller channel available. Using it.');
            return sellerChannels[0];
        }

        // Use VendorSelectionService to select the best vendor based on the same algorithm used in the frontend
        try {
            console.log('[setOrderLineSellerChannel] Using VendorSelectionService to select best vendor');
            const selectedVendor = await this.vendorSelectionService.selectVendorForVariation(ctx, String(orderLine.productVariant.id));
            console.log('[setOrderLineSellerChannel] Selected vendor:', selectedVendor);

            // Find the channel that corresponds to the selected vendor
            const selectedChannel = sellerChannels.find(c => c.token === selectedVendor.slug);
            if (selectedChannel) {
                console.log('[setOrderLineSellerChannel] Found matching channel for selected vendor:', selectedChannel);
                return selectedChannel;
            }
            console.warn('[setOrderLineSellerChannel] No matching channel found for selected vendor. Falling back to first available channel.');
        } catch (error) {
            console.error('[setOrderLineSellerChannel] Error using VendorSelectionService:', error);
            console.warn('[setOrderLineSellerChannel] Falling back to first available channel due to error.');
        }

        // Fallback to the first available seller channel
        console.log('[setOrderLineSellerChannel] Falling back to the first available seller channel.');
        return sellerChannels[0];
    }

    /**
     * Splits the aggregate order into multiple partial orders based on seller channels.
     *
     * @param ctx The request context.
     * @param order The aggregate order.
     * @returns An array of SplitOrderContents, one per seller channel.
     */
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
                shippingLineIds.has(shippingLine.id),
            );
            console.log('[splitOrder] Matched shipping lines for partial order:', partialOrder.channelId, partialOrder.shippingLines);
        }

        console.log('[splitOrder] Completed splitting order.');
        return [...partialOrders.values()];
    }

    /**
     * After seller orders are created, this method applies custom order fields,
     * dynamic fees, price adjustments, and adds a payment to each seller order.
     *
     * @param ctx The request context.
     * @param aggregateOrder The aggregate order.
     * @param sellerOrders The seller-specific orders.
     */
    async afterSellerOrdersCreated(ctx: RequestContext, aggregateOrder: Order, sellerOrders: Order[]) {
        console.log('[afterSellerOrdersCreated] Processing seller orders for aggregate order:', aggregateOrder.code);
        const paymentMethod = await this.connection.rawConnection.getRepository(PaymentMethod).findOne({
            where: {
                code: CONNECTED_PAYMENT_METHOD_CODE,
            },
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
                throw new InternalServerError(
                    `Could not determine Seller Channel for Order ${sellerOrder.code}`,
                );
            }
            console.log('[afterSellerOrdersCreated] Seller channel determined:', sellerChannel);

            // Hydrate the seller relation on the channel so we can read custom fields
            // First, ensure that the seller is loaded on the channel.
            await this.entityHydrator.hydrate(ctx, sellerChannel, { relations: ['seller'] });
            if (sellerChannel.seller) {
                await this.entityHydrator.hydrate(ctx, sellerChannel.seller, { relations: ['customFields.merkDealer', 'customFields.merkDistributeur'] });
            } else {
                throw new Error(`Seller is not defined on sellerChannel ${sellerChannel.id}`);
            }
            console.log('[afterSellerOrdersCreated] Hydrated seller for channel:', sellerChannel.id, sellerChannel.seller);
            // Log the full seller object for additional debugging.
            console.log('[afterSellerOrdersCreated] Seller details:', sellerChannel.seller);

            // Apply custom order fields based on the seller's data
            if (sellerChannel.seller) {
                console.log('[afterSellerOrdersCreated] Applying custom order fields for seller:', sellerChannel.seller.id);
                this.applyCustomOrderFields(sellerOrder, sellerChannel.seller);
            } else {
                console.warn(`[afterSellerOrdersCreated] No seller found on channel ${sellerChannel.id}`);
            }

            // Apply dynamic fees/surcharges based on the scenario set above
            console.log('[afterSellerOrdersCreated] Applying dynamic fees for seller order:', sellerOrder.code);
            await this.applyDynamicFees(ctx, sellerOrder);

            // Apply price adjustments and add payment
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
     * Applies the custom order fields (scenario, primaryVendor, serviceDealer, serviceAgentAvailable)
     * based on the seller's custom fields.
     *
     * Now that primaryVendor and serviceDealer are relationships (Seller entities),
     * we assign the full seller objects rather than just their IDs.
     *
     * @param order The order to update.
     * @param seller The seller from the sellerChannel.
     */
    private applyCustomOrderFields(order: Order, seller: VendureSeller): void {
        // Log the entire seller object for debugging
        console.log('[applyCustomOrderFields] Seller details:', seller);
        console.log('[applyCustomOrderFields] Applying custom fields for order:', order.code);
        const vendorType = seller.customFields?.vendorType;
        let scenario = '';
        let serviceDealer: VendureSeller | null = null;
        let serviceAgentAvailable = false;

        if (vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER') {
            // Scenario 1: Product ordered at a physical store
            scenario = "Product besteld bij een WINKEL";
            // For a physical store, the seller is its own service dealer.
            serviceDealer = seller;
            serviceAgentAvailable = false;
            console.log('[applyCustomOrderFields] Vendor type PHYSICAL_STORE_OR_SERVICE_DEALER detected.');
        } else if (vendorType === 'MANUFACTURER') {
            // Determine if this manufacturer has a service agent available
            // For this implementation, we'll consider AGENT vendor type as having a service agent
            // This could be modified based on actual business logic
            serviceAgentAvailable = true; // Set to true for scenarios 3, 5, and 10

            // For a manufacturer, attempt to set the service dealer from the attached fields.
            if (seller.customFields?.merkDealers && seller.customFields.merkDealers.length > 0) {
                // Select the most appropriate merkDealer based on customer location or other criteria
                // For now, we'll use a simple approach to find a dealer in the same country as the order
                // or fall back to the first dealer if none match
                const orderCountry = order.shippingAddress?.countryCode;
                let selectedDealer = seller.customFields.merkDealers[0]; // Default to first dealer

                if (orderCountry) {
                    // Try to find a dealer in the same country as the order
                    const localDealer = seller.customFields.merkDealers.find(
                        dealer => dealer.customFields?.country === orderCountry
                    );
                    if (localDealer) {
                        selectedDealer = localDealer;
                        console.log(`[applyCustomOrderFields] Found dealer in same country (${orderCountry})`);
                    }
                }

                serviceDealer = selectedDealer;
                if (serviceAgentAvailable) {
                    scenario = "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt";
                    console.log('[applyCustomOrderFields] Manufacturer with SERVICE_AGENT and merkDealers found.');
                } else {
                    scenario = "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt";
                    console.log('[applyCustomOrderFields] Manufacturer with merkDealers found.');
                }
            } else if (seller.customFields?.merkDistributeur) {
                serviceDealer = seller.customFields.merkDistributeur;
                if (serviceAgentAvailable) {
                    scenario = "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt";
                    console.log('[applyCustomOrderFields] Manufacturer with SERVICE_AGENT and merkDistributeur found.');
                } else {
                    scenario = "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt";
                    console.log('[applyCustomOrderFields] Manufacturer with merkDistributeur found.');
                }
            } else {
                if (serviceAgentAvailable) {
                    scenario = "Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER";
                    console.log('[applyCustomOrderFields] Manufacturer with SERVICE_AGENT but without service dealer found.');
                } else {
                    scenario = "Product besteld bij een MERK zonder beschikbare SERVICE_DEALER";
                    console.log('[applyCustomOrderFields] Manufacturer without service dealer found.');
                }
            }
        } else if (vendorType === 'BOARDRUSH_PLATFORM') {
            // For BOARDRUSH_PLATFORM, check if there's a service dealer
            serviceAgentAvailable = false; // Not applicable for BOARDRUSH_PLATFORM

            // Check if we can find a service dealer for this product
            // This would typically involve checking product brand against available dealers
            // For simplicity, we'll use merkDealers if available
            if (seller.customFields?.merkDealers && seller.customFields.merkDealers.length > 0) {
                // Select the most appropriate merkDealer based on customer location or other criteria
                // For now, we'll use a simple approach to find a dealer in the same country as the order
                // or fall back to the first dealer if none match
                const orderCountry = order.shippingAddress?.countryCode;
                let selectedDealer = seller.customFields.merkDealers[0]; // Default to first dealer

                if (orderCountry) {
                    // Try to find a dealer in the same country as the order
                    const localDealer = seller.customFields.merkDealers.find(
                        dealer => dealer.customFields?.country === orderCountry
                    );
                    if (localDealer) {
                        selectedDealer = localDealer;
                        console.log(`[applyCustomOrderFields] Found dealer in same country (${orderCountry})`);
                    }
                }

                serviceDealer = selectedDealer;
                scenario = "Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat";
                console.log('[applyCustomOrderFields] BOARDRUSH_PLATFORM with service dealer that sells the brand.');
            } else if (seller.customFields?.merkDistributeur) {
                // Use merkDistributeur as service dealer
                serviceDealer = seller.customFields.merkDistributeur;
                scenario = "Product besteld bij BOARDRUSH zelf, service door dealer die merk niet bevat";
                console.log('[applyCustomOrderFields] BOARDRUSH_PLATFORM with service dealer that does not sell the brand.');
            } else {
                // No service dealer available
                scenario = "Product besteld bij BOARDRUSH zelf";
                serviceDealer = null;
                console.log('[applyCustomOrderFields] Vendor type BOARDRUSH_PLATFORM without service dealer detected.');
            }
        } else {
            scenario = "Onbekend scenario";
            console.warn('[applyCustomOrderFields] Unknown vendor type:', vendorType);
        }

        order.customFields.scenario = scenario;
        // Assign the full seller objects.
        order.customFields.primaryVendor = seller;
        order.customFields.serviceDealer = serviceDealer;
        order.customFields.serviceAgentAvailable = serviceAgentAvailable;
        console.log('[applyCustomOrderFields] Custom fields applied:', order.customFields);
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
     *
     * @param ctx The request context.
     * @param order The order for which fees are being applied.
     */
    private async applyDynamicFees(ctx: RequestContext, order: Order): Promise<void> {
        console.log('[applyDynamicFees] Starting fee determination for order:', order.code);
        const scenario = order.customFields.scenario;
        let boardrushFeePercentage = 0;
        let serviceDealerFeePercentage = 0;
        const orderTotal = order.totalWithTax;

        console.log(`[applyDynamicFees] Order total: ${orderTotal}, Scenario: "${scenario}"`);

        // Determine fee percentages based on the scenario.
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

        // Calculate the fee amounts.
        const boardrushFee = Math.round(orderTotal * boardrushFeePercentage / 100);
        const serviceDealerFee = serviceDealerFeePercentage ? Math.round(orderTotal * serviceDealerFeePercentage / 100) : 0;

        console.log(`[applyDynamicFees] Calculated Boardrush fee: ${boardrushFee} (${boardrushFeePercentage}% of ${orderTotal})`);
        console.log(`[applyDynamicFees] Calculated Service Dealer fee: ${serviceDealerFee} (${serviceDealerFeePercentage}% of ${orderTotal})`);

        // Collect surcharges so they can be assigned to the order.
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

        // IMPORTANT: Update the order's surcharges property so that subsequent logic sees them.
        order.surcharges = surcharges;
        console.log('[applyDynamicFees] Order surcharges updated:', order.surcharges);
        console.log('[applyDynamicFees] Fee determination and surcharge application completed.');
    }

}
