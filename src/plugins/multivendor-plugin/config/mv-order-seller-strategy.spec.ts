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
  LanguageCode
} from '@vendure/core';
import { MULTIVENDOR_PLUGIN_OPTIONS } from '../constants';
import { VendorSelectionService, Vendor } from '../service/vendor-selection.service';

describe('MultivendorSellerStrategy', () => {
  let strategy: MultivendorSellerStrategy;
  let mockInjector: Injector;
  let mockVendorSelectionService: jest.Mocked<VendorSelectionService>;

  // Mock dependencies
  const mockEntityHydrator = {
    hydrate: jest.fn().mockImplementation((ctx, entity, options) => {
      if (entity instanceof ProductVariant) {
        entity.channels = [
          { id: '1', token: 'default-channel' } as Channel,
          { id: '2', token: 'seller-channel-1' } as Channel,
          { id: '3', token: 'seller-channel-2' } as Channel
        ];
      }
      return Promise.resolve(entity);
    }),
  };

  const mockChannelService = {
    getDefaultChannel: jest.fn().mockResolvedValue({ id: '1', token: 'default-channel' }),
  };

  const mockPaymentService = {};
  const mockPaymentMethodService = {};
  const mockConnection = {
    getRepository: jest.fn().mockReturnValue({
      save: jest.fn().mockResolvedValue({}),
    }),
    rawConnection: {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue({}),
      }),
    },
  };

  const mockOrderService = {};

  const mockOptions = {
    platformFeePercent: 10,
    platformFeeSKU: 'FEE',
  };

  beforeEach(async () => {
    mockVendorSelectionService = {
      selectVendorForVariation: jest.fn(),
    } as unknown as jest.Mocked<VendorSelectionService>;

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
      mockEntityHydrator.hydrate = jest.fn().mockImplementation((ctx, entity, options) => {
        if (entity instanceof ProductVariant) {
          entity.channels = [{ id: '1', token: 'default-channel' } as Channel];
        }
        return Promise.resolve(entity);
      });

      const ctx = {} as RequestContext;
      const orderLine = {
        id: '1',
        productVariant: new ProductVariant(),
        customFields: {},
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(result).toBeUndefined();
    });

    it('should use the requested seller channel if provided and valid', async () => {
      const ctx = {} as RequestContext;
      const orderLine = {
        id: '1',
        productVariant: new ProductVariant(),
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
      mockEntityHydrator.hydrate = jest.fn().mockImplementation((ctx, entity, options) => {
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
        productVariant: new ProductVariant(),
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
        productVariant: new ProductVariant(),
        customFields: {},
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(mockVendorSelectionService.selectVendorForVariation).toHaveBeenCalledWith(ctx, orderLine.productVariant.id);
      expect(result).toBeDefined();
      expect(result?.token).toBe('seller-channel-2');
    });

    it('should fall back to the first available channel if VendorSelectionService throws an error', async () => {
      mockVendorSelectionService.selectVendorForVariation.mockRejectedValue(new Error('Test error'));

      const ctx = {} as RequestContext;
      const orderLine = {
        id: '1',
        productVariant: new ProductVariant(),
        customFields: {},
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(mockVendorSelectionService.selectVendorForVariation).toHaveBeenCalledWith(ctx, orderLine.productVariant.id);
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
        productVariant: new ProductVariant(),
        customFields: {},
      } as OrderLine;

      const result = await strategy.setOrderLineSellerChannel(ctx, orderLine);
      expect(mockVendorSelectionService.selectVendorForVariation).toHaveBeenCalledWith(ctx, orderLine.productVariant.id);
      expect(result).toBeDefined();
      expect(result?.token).toBe('seller-channel-1');
    });
  });
});
