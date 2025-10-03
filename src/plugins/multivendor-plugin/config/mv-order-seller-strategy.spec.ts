import { Test, TestingModule } from '@nestjs/testing';
import { MultivendorSellerStrategy } from './mv-order-seller-strategy';
import { 
  ChannelService, 
  EntityHydrator, 
  Injector, 
  OrderLine, 
  OrderService, 
  PaymentMethodService, 
  PaymentService, 
  RequestContext, 
  TransactionalConnection,
  Channel,
  ProductVariant,
  LanguageCode,
  Seller as VendureSeller,
  Surcharge,
  PaymentMethod,
  Order
} from '@vendure/core';
import { MULTIVENDOR_PLUGIN_OPTIONS, CONNECTED_PAYMENT_METHOD_CODE } from '../constants';
import { VendorSelectionService, Vendor } from '../service/vendor-selection.service';

describe('MultivendorSellerStrategy', () => {
  let strategy: MultivendorSellerStrategy;
  let mockInjector: Injector;
  let mockVendorSelectionService: jest.Mocked<VendorSelectionService>;

  // Mock dependencies
  const mockEntityHydrator = {
    hydrate: jest.fn(),
  };

  const mockChannelService = {
    getDefaultChannel: jest.fn(),
  };

  const mockPaymentService = {};
  const mockPaymentMethodService = {};
  const mockSurchargeRepository = {
    save: jest.fn().mockImplementation(s => Promise.resolve(s)),
  };
  const mockPaymentMethodRepository = {
      findOne: jest.fn(),
  };
  const mockConnection = {
    getRepository: jest.fn().mockImplementation((ctx, entity) => {
        if (entity === Surcharge) {
            return mockSurchargeRepository;
        }
        return { save: jest.fn().mockResolvedValue({}) };
    }),
    rawConnection: {
      getRepository: jest.fn().mockImplementation(entity => {
          if (entity === PaymentMethod) {
              return mockPaymentMethodRepository;
          }
          return { findOne: jest.fn().mockResolvedValue({}) };
      }),
    },
  };

  const mockOrderService = {
    applyPriceAdjustments: jest.fn().mockResolvedValue(undefined),
    addPaymentToOrder: jest.fn().mockResolvedValue({}),
  };

  const mockOptions = {
    platformFeePercent: 10,
    platformFeeSKU: 'FEE',
  };

  beforeEach(async () => {
    // Reset mocks for each test
    mockPaymentMethodRepository.findOne.mockResolvedValue({ code: CONNECTED_PAYMENT_METHOD_CODE });
    mockSurchargeRepository.save.mockClear();
    mockOrderService.applyPriceAdjustments.mockClear();
    mockOrderService.addPaymentToOrder.mockClear();
    mockEntityHydrator.hydrate.mockClear();
    mockVendorSelectionService = {
      selectVendorForVariation: jest.fn(),
    } as unknown as jest.Mocked<VendorSelectionService>;

    // Reset mocks for each test
    mockEntityHydrator.hydrate.mockImplementation((ctx, entity, options) => {
      if (entity instanceof ProductVariant) {
        if (!entity.channels) {
          entity.channels = [];
        }
        // Ensure the default mock provides multiple channels
        if (entity.channels.length === 0) {
            entity.channels = [
                { id: '1', token: 'default-channel' } as Channel,
                { id: '2', token: 'seller-channel-1' } as Channel,
                { id: '3', token: 'seller-channel-2' } as Channel,
            ];
        }
      } else if (entity instanceof Channel) {
          if (!entity.seller) {
              entity.seller = { id: 'seller-1', customFields: {} } as VendureSeller
          }
      }
      return Promise.resolve(entity);
    });
    mockChannelService.getDefaultChannel.mockResolvedValue({ id: '1', token: 'default-channel' });

    mockInjector = {
      get: jest.fn((token) => {
        switch (token) {
          case EntityHydrator:
            return mockEntityHydrator;
          case ChannelService:
            return mockChannelService;
          case PaymentService:
            return mockPaymentService;
          case PaymentMethodService:
            return mockPaymentMethodService;
          case TransactionalConnection:
            return mockConnection;
          case OrderService:
            return mockOrderService;
          case MULTIVENDOR_PLUGIN_OPTIONS:
            return mockOptions;
          case VendorSelectionService:
            return mockVendorSelectionService;
          default:
            return {};
        }
      }),
    } as unknown as Injector;

    strategy = new MultivendorSellerStrategy();
    strategy.init(mockInjector);
  });

  describe('setOrderLineSellerChannel', () => {
    it('should return undefined if no seller channels are found', async () => {
      // Override the hydrate mock for this test
      mockEntityHydrator.hydrate.mockImplementation((ctx, entity, options) => {
        if (entity instanceof ProductVariant) {
          entity.channels = [{ id: '1', token: 'default-channel' } as Channel];
        }
        return Promise.resolve(entity);
      });

      const ctx = {} as RequestContext;
      const orderLine = {
        id: '1',
        productVariant: new ProductVariant({ id: 'pv1' }),
        customFields: {},
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(result).toBeUndefined();
    });

    it('should use the requested seller channel if provided and valid', async () => {
      const ctx = {} as RequestContext;
      const orderLine = {
        id: '1',
        productVariant: new ProductVariant({ id: 'pv1' }),
        customFields: {
          requestedSellerChannel: 'seller-channel-1',
        },
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(result).toBeDefined();
      expect(result?.token).toBe('seller-channel-1');
    });

    it('should use the only available seller channel if there is only one', async () => {
      // Override the hydrate mock for this test
      mockEntityHydrator.hydrate.mockImplementation((ctx, entity, options) => {
        if (entity instanceof ProductVariant) {
          entity.channels = [
            { id: '1', token: 'default-channel' } as Channel,
            { id: '2', token: 'seller-channel-1' } as Channel,
          ];
        }
        return Promise.resolve(entity);
      });

      const ctx = {} as RequestContext;
      const orderLine = {
        id: '1',
        productVariant: new ProductVariant({ id: 'pv1' }),
        customFields: {},
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(result).toBeDefined();
      expect(result?.token).toBe('seller-channel-1');
    });

    it('should use VendorSelectionService to select the best vendor when multiple channels are available', async () => {
      const selectedVendor: Vendor = {
        slug: 'seller-channel-2',
        channel: 'seller-2',
        locales: [],
        nationalLocale: LanguageCode.en,
        sellerId: '3',
        seller: {
          name: 'Seller 2',
          firstName: null,
          lastName: null,
          emailAddress: null,
          address: null,
          postalCode: null,
          country: null,
          vendorType: 'MANUFACTURER',
        },
        price: 100,
        inStock: true,
      };

      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(selectedVendor);

      const ctx = {} as RequestContext;
      const orderLine = {
        id: '1',
        productVariant: new ProductVariant({ id: 'pv1' }),
        customFields: {},
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(mockVendorSelectionService.selectVendorForVariation).toHaveBeenCalledWith(ctx, String(orderLine.productVariant.id));
      expect(result).toBeDefined();
      expect(result?.token).toBe('seller-channel-2');
    });

    it('should fall back to the first available channel if VendorSelectionService throws an error', async () => {
      mockVendorSelectionService.selectVendorForVariation.mockRejectedValue(new Error('Test error'));

      const ctx = {} as RequestContext;
      const orderLine = {
        id: '1',
        productVariant: new ProductVariant({ id: 'pv1' }),
        customFields: {},
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(mockVendorSelectionService.selectVendorForVariation).toHaveBeenCalledWith(ctx, String(orderLine.productVariant.id));
      expect(result).toBeDefined();
      expect(result?.token).toBe('seller-channel-1');
    });

    it('should fall back to the first available channel if no matching channel is found for the selected vendor', async () => {
      const selectedVendor: Vendor = {
        slug: 'non-existent-channel',
        channel: 'non-existent',
        locales: [],
        nationalLocale: LanguageCode.en,
        sellerId: '4',
        seller: {
          name: 'Non-existent Seller',
          firstName: null,
          lastName: null,
          emailAddress: null,
          address: null,
          postalCode: null,
          country: null,
          vendorType: 'MANUFACTURER',
        },
        price: 100,
        inStock: true,
      };

      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(selectedVendor);

      const ctx = {} as RequestContext;
      const orderLine = {
        id: '1',
        productVariant: new ProductVariant({ id: 'pv1' }),
        customFields: {},
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(mockVendorSelectionService.selectVendorForVariation).toHaveBeenCalledWith(ctx, String(orderLine.productVariant.id));
      expect(result).toBeDefined();
      expect(result?.token).toBe('seller-channel-1');
    });
  });

  describe('splitOrder', () => {
    it('should split an order into multiple partial orders based on sellerChannelId', async () => {
        const ctx = {} as RequestContext;
        const order = {
            id: 'agg-order-1',
            lines: [
                { id: 'line-1', sellerChannelId: 'seller-a', shippingLineId: 'ship-1' },
                { id: 'line-2', sellerChannelId: 'seller-b', shippingLineId: 'ship-2' },
                { id: 'line-3', sellerChannelId: 'seller-a', shippingLineId: 'ship-1' },
            ],
            shippingLines: [
                { id: 'ship-1' },
                { id: 'ship-2' },
            ],
        } as any;

        const result = await strategy.splitOrder(ctx, order);

        expect(result.length).toBe(2);

        const sellerAOrder = result.find(p => p.channelId === 'seller-a');
        const sellerBOrder = result.find(p => p.channelId === 'seller-b');

        expect(sellerAOrder).toBeDefined();
        expect(sellerAOrder?.lines.length).toBe(2);
        expect(sellerAOrder?.lines.map(l => l.id)).toEqual(['line-1', 'line-3']);
        expect(sellerAOrder?.shippingLines.length).toBe(1);
        expect(sellerAOrder?.shippingLines[0].id).toBe('ship-1');

        expect(sellerBOrder).toBeDefined();
        expect(sellerBOrder?.lines.length).toBe(1);
        expect(sellerBOrder?.lines[0].id).toBe('line-2');
        expect(sellerBOrder?.shippingLines.length).toBe(1);
        expect(sellerBOrder?.shippingLines[0].id).toBe('ship-2');
    });

    it('should handle an order with no seller channels', async () => {
        const ctx = {} as RequestContext;
        const order = {
            id: 'agg-order-2',
            lines: [
                { id: 'line-1', sellerChannelId: null },
            ],
            shippingLines: [],
        } as any;

        const result = await strategy.splitOrder(ctx, order);
        expect(result.length).toBe(0);
    });
  });

  describe('afterSellerOrdersCreated', () => {
    it('should process seller orders correctly for a PHYSICAL_STORE_OR_SERVICE_DEALER', async () => {
        const ctx = {} as RequestContext;
        const aggregateOrder = { code: 'AGG1' } as Order;
        const seller = {
            id: 'seller1',
            customFields: {
                vendorType: 'PHYSICAL_STORE_OR_SERVICE_DEALER',
                connectedAccountId: 'acct_123',
            },
        } as VendureSeller;
        const sellerChannel = { id: 'ch2', token: 'seller-channel-1', seller } as Channel;
        const sellerOrder = {
            id: 'seller-order-1',
            code: 'SO1',
            totalWithTax: 10000, // 100.00
            channels: [
                { id: '1', token: 'default-channel' },
                sellerChannel,
            ],
            customFields: {},
            surcharges: [],
        } as any as Order;

        await strategy.afterSellerOrdersCreated(ctx, aggregateOrder, [sellerOrder]);

        expect(mockEntityHydrator.hydrate).toHaveBeenCalledWith(ctx, sellerChannel, { relations: ['seller'] });

        // Assertions for applyCustomOrderFields
        expect(sellerOrder.customFields.scenario).toBe('Product besteld bij een WINKEL');
        expect(sellerOrder.customFields.primaryVendor).toBe(seller);
        expect(sellerOrder.customFields.serviceDealer).toBe(seller);
        expect(sellerOrder.customFields.serviceAgentAvailable).toBe(false);

        // Assertions for applyDynamicFees
        expect(mockSurchargeRepository.save).toHaveBeenCalledTimes(1);
        const surchargeCall = mockSurchargeRepository.save.mock.calls[0][0];
        expect(surchargeCall.sku).toBe('BOARDRUSH_FEE');
        expect(surchargeCall.description).toBe('Boardrush fee');
        expect(surchargeCall.listPrice).toBe(1400); // 14% of 10000

        // Assertions for price adjustments and payment
        expect(mockOrderService.applyPriceAdjustments).toHaveBeenCalledWith(ctx, sellerOrder);
        expect(mockOrderService.addPaymentToOrder).toHaveBeenCalledWith(ctx, sellerOrder.id, {
            method: CONNECTED_PAYMENT_METHOD_CODE,
            metadata: {
                transfer_group: aggregateOrder.code,
                connectedAccountId: 'acct_123',
            },
        });
    });

    it('should not process orders if connected payment method is not found', async () => {
        mockPaymentMethodRepository.findOne.mockResolvedValue(undefined);
        const ctx = {} as RequestContext;
        const aggregateOrder = { code: 'AGG1' } as Order;
        const sellerOrder = { id: 'seller-order-1' } as Order;

        await strategy.afterSellerOrdersCreated(ctx, aggregateOrder, [sellerOrder]);

        expect(mockOrderService.addPaymentToOrder).not.toHaveBeenCalled();
    });

    it('should throw an error if seller channel cannot be determined', async () => {
        const ctx = {} as RequestContext;
        const aggregateOrder = { code: 'AGG1' } as Order;
        const sellerOrder = {
            id: 'seller-order-1',
            code: 'SO1',
            channels: [{ id: '1', token: 'default-channel' }], // No seller channel
        } as any as Order;

        await expect(strategy.afterSellerOrdersCreated(ctx, aggregateOrder, [sellerOrder])).rejects.toThrow(
            'Could not determine Seller Channel for Order SO1'
        );
    });

    it('should throw an error if seller is not defined on the seller channel', async () => {
        const ctx = {} as RequestContext;
        const aggregateOrder = { code: 'AGG1' } as Order;
        const sellerChannel = { id: 'ch2', token: 'seller-channel-1', seller: undefined } as any as Channel;
        const sellerOrder = {
            id: 'seller-order-1',
            code: 'SO1',
            channels: [
                { id: '1', token: 'default-channel' },
                sellerChannel,
            ],
        } as any as Order;

        await expect(strategy.afterSellerOrdersCreated(ctx, aggregateOrder, [sellerOrder])).rejects.toThrow(
            'Seller is not defined on sellerChannel ch2'
        );
    });

    it('should correctly apply fields and fees for a MANUFACTURER with merkDealers', async () => {
        const ctx = {} as RequestContext;
        const aggregateOrder = { code: 'AGG2', shippingAddress: { countryCode: 'NL' } } as any as Order;
        const dealer = { id: 'dealer1', customFields: { country: 'NL' } } as VendureSeller;
        const seller = {
            id: 'seller2',
            customFields: {
                vendorType: 'MANUFACTURER',
                connectedAccountId: 'acct_456',
                merkDealers: [dealer],
            },
        } as VendureSeller;
        const sellerChannel = { id: 'ch3', token: 'seller-channel-2', seller } as Channel;
        const sellerOrder = {
            id: 'seller-order-2',
            code: 'SO2',
            totalWithTax: 20000, // 200.00
            channels: [
                { id: '1', token: 'default-channel' },
                sellerChannel,
            ],
            customFields: {},
            surcharges: [],
            shippingAddress: { countryCode: 'NL' },
        } as any as Order;

        await strategy.afterSellerOrdersCreated(ctx, aggregateOrder, [sellerOrder]);

        expect(sellerOrder.customFields.scenario).toBe('Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt');
        expect(sellerOrder.customFields.serviceDealer).toBe(dealer);
        expect(mockSurchargeRepository.save).toHaveBeenCalledTimes(2); // Boardrush fee + Service Dealer fee

        const boardrushSurcharge = mockSurchargeRepository.save.mock.calls.find(c => c[0].sku === 'BOARDRUSH_FEE')[0];
        const dealerSurcharge = mockSurchargeRepository.save.mock.calls.find(c => c[0].sku === 'SERVICE_DEALER_FEE')[0];

        expect(boardrushSurcharge.listPrice).toBe(3600); // 18% of 20000
        expect(dealerSurcharge.listPrice).toBe(2000); // 10% of 20000
    });

    it('should correctly apply fields and fees for a BOARDRUSH_PLATFORM vendor', async () => {
        const ctx = {} as RequestContext;
        const aggregateOrder = { code: 'AGG3' } as any as Order;
        const seller = {
            id: 'seller3',
            customFields: {
                vendorType: 'BOARDRUSH_PLATFORM',
                connectedAccountId: 'acct_789',
            },
        } as VendureSeller;
        const sellerChannel = { id: 'ch4', token: 'seller-channel-3', seller } as Channel;
        const sellerOrder = {
            id: 'seller-order-3',
            code: 'SO3',
            totalWithTax: 5000, // 50.00
            channels: [
                { id: '1', token: 'default-channel' },
                sellerChannel,
            ],
            customFields: {},
            surcharges: [],
        } as any as Order;

        await strategy.afterSellerOrdersCreated(ctx, aggregateOrder, [sellerOrder]);

        expect(sellerOrder.customFields.scenario).toBe('Product besteld bij BOARDRUSH zelf');
        expect(sellerOrder.customFields.serviceDealer).toBeNull();
        expect(mockSurchargeRepository.save).toHaveBeenCalledTimes(1);

        const boardrushSurcharge = mockSurchargeRepository.save.mock.calls.find(c => c[0].sku === 'BOARDRUSH_FEE')[0];

        expect(boardrushSurcharge.listPrice).toBe(5000); // 100% of 5000
    });

    it('should correctly apply fields and fees for a MANUFACTURER with merkDistributeur', async () => {
        const ctx = {} as RequestContext;
        const aggregateOrder = { code: 'AGG4' } as any as Order;
        const distributor = { id: 'distributor1' } as VendureSeller;
        const seller = {
            id: 'seller4',
            customFields: {
                vendorType: 'MANUFACTURER',
                connectedAccountId: 'acct_dist',
                merkDistributeur: distributor,
            },
        } as VendureSeller;
        const sellerChannel = { id: 'ch5', token: 'seller-channel-4', seller } as Channel;
        const sellerOrder = {
            id: 'seller-order-4',
            code: 'SO4',
            totalWithTax: 15000, // 150.00
            channels: [
                { id: '1', token: 'default-channel' },
                sellerChannel,
            ],
            customFields: {},
            surcharges: [],
        } as any as Order;

        await strategy.afterSellerOrdersCreated(ctx, aggregateOrder, [sellerOrder]);

        expect(sellerOrder.customFields.scenario).toBe('Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt');
        expect(sellerOrder.customFields.serviceDealer).toBe(distributor);
        expect(mockSurchargeRepository.save).toHaveBeenCalledTimes(2);

        const boardrushSurcharge = mockSurchargeRepository.save.mock.calls.find(c => c[0].sku === 'BOARDRUSH_FEE')[0];
        const dealerSurcharge = mockSurchargeRepository.save.mock.calls.find(c => c[0].sku === 'SERVICE_DEALER_FEE')[0];

        expect(boardrushSurcharge.listPrice).toBe(2700); // 18% of 15000
        expect(dealerSurcharge.listPrice).toBe(1050); // 7% of 15000
    });

    it('should correctly apply fields and fees for BOARDRUSH_PLATFORM with merkDealers', async () => {
        const ctx = {} as RequestContext;
        const aggregateOrder = { code: 'AGG5', shippingAddress: { countryCode: 'DE' } } as any as Order;
        const dealer = { id: 'dealer2', customFields: { country: 'DE' } } as VendureSeller;
        const seller = {
            id: 'seller5',
            customFields: {
                vendorType: 'BOARDRUSH_PLATFORM',
                connectedAccountId: 'acct_br_dealer',
                merkDealers: [dealer],
            },
        } as VendureSeller;
        const sellerChannel = { id: 'ch6', token: 'seller-channel-5', seller } as Channel;
        const sellerOrder = {
            id: 'seller-order-5',
            code: 'SO5',
            totalWithTax: 8000, // 80.00
            channels: [
                { id: '1', token: 'default-channel' },
                sellerChannel,
            ],
            customFields: {},
            surcharges: [],
            shippingAddress: { countryCode: 'DE' },
        } as any as Order;

        await strategy.afterSellerOrdersCreated(ctx, aggregateOrder, [sellerOrder]);

        expect(sellerOrder.customFields.scenario).toBe('Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat');
        expect(sellerOrder.customFields.serviceDealer).toBe(dealer);
        expect(mockSurchargeRepository.save).toHaveBeenCalledTimes(2);

        const boardrushSurcharge = mockSurchargeRepository.save.mock.calls.find(c => c[0].sku === 'BOARDRUSH_FEE')[0];
        const dealerSurcharge = mockSurchargeRepository.save.mock.calls.find(c => c[0].sku === 'SERVICE_DEALER_FEE')[0];

        expect(boardrushSurcharge.listPrice).toBe(7200); // 90% of 8000
        expect(dealerSurcharge.listPrice).toBe(800); // 10% of 8000
    });
  });
});