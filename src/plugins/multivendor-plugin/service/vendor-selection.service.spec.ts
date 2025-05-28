import { Test, TestingModule } from '@nestjs/testing';
import { VendorSelectionService, Vendor } from './vendor-selection.service';
import { 
  RequestContextService, 
  TransactionalConnection, 
  CustomerService, 
  ProductVariantService, 
  GlobalSettingsService,
  RequestContext,
  Channel,
  LanguageCode
} from '@vendure/core';

// Mock dependencies
const mockRequestContextService = {
  // Add mock methods as needed
};

// Mock channel with a seller that has multiple merkDealers
const mockChannels = [
  {
    id: '1',
    token: 'default-channel',
    code: 'default',
    defaultLanguageCode: LanguageCode.en,
    availableLanguageCodes: [LanguageCode.en],
    sellerId: '1',
    seller: {
      id: '1',
      name: 'Manufacturer',
      customFields: {
        firstName: 'John',
        lastName: 'Doe',
        emailAddress: 'john@example.com',
        address: '123 Main St',
        postalCode: '1012JS',
        country: 'NL',
        vendorType: 'MANUFACTURER',
        merkDealers: [
          { id: '2', name: 'Dealer 1', customFields: {} },
          { id: '3', name: 'Dealer 2', customFields: {} }
        ],
        merkDistributeur: null
      }
    },
    stockLocations: [{ id: '1' }]
  },
  {
    id: '2',
    token: 'dealer-channel',
    code: 'dealer',
    defaultLanguageCode: LanguageCode.en,
    availableLanguageCodes: [LanguageCode.en],
    sellerId: '2',
    seller: {
      id: '2',
      name: 'Dealer 1',
      customFields: {
        firstName: 'Jane',
        lastName: 'Smith',
        emailAddress: 'jane@example.com',
        address: '456 Oak St',
        postalCode: '1013KR',
        country: 'NL',
        vendorType: 'PHYSICAL_STORE_OR_SERVICE_DEALER',
        merkDealers: null,
        merkDistributeur: null
      }
    },
    stockLocations: [{ id: '2' }]
  },
  {
    id: '3',
    token: 'boardrush-channel',
    code: 'boardrush',
    defaultLanguageCode: LanguageCode.en,
    availableLanguageCodes: [LanguageCode.en],
    sellerId: '3',
    seller: {
      id: '3',
      name: 'Boardrush',
      customFields: {
        firstName: 'Boardrush',
        lastName: 'Admin',
        emailAddress: 'admin@boardrush.com',
        address: '789 Pine St',
        postalCode: '1014LT',
        country: 'NL',
        vendorType: 'BOARDRUSH_PLATFORM',
        merkDealers: null,
        merkDistributeur: null
      }
    },
    stockLocations: [{ id: '3' }]
  },
  {
    id: '4',
    token: 'international-dealer-channel',
    code: 'international-dealer',
    defaultLanguageCode: LanguageCode.en,
    availableLanguageCodes: [LanguageCode.en],
    sellerId: '4',
    seller: {
      id: '4',
      name: 'International Dealer',
      customFields: {
        firstName: 'International',
        lastName: 'Dealer',
        emailAddress: 'international@example.com',
        address: '101 Foreign St',
        postalCode: '10001',
        country: 'DE',
        vendorType: 'PHYSICAL_STORE_OR_SERVICE_DEALER',
        merkDealers: null,
        merkDistributeur: null
      }
    },
    stockLocations: [{ id: '4' }]
  },
  {
    id: '5',
    token: 'agent-channel',
    code: 'agent',
    defaultLanguageCode: LanguageCode.en,
    availableLanguageCodes: [LanguageCode.en],
    sellerId: '5',
    seller: {
      id: '5',
      name: 'Agent',
      customFields: {
        firstName: 'Agent',
        lastName: 'Smith',
        emailAddress: 'agent@example.com',
        address: '202 Agent St',
        postalCode: '1015MN',
        country: 'NL',
        vendorType: 'AGENT',
        merkDealers: null,
        merkDistributeur: null
      }
    },
    stockLocations: [{ id: '5' }]
  }
];

const mockConnection = {
  getRepository: jest.fn().mockImplementation((ctx, entity) => {
    if (entity === Channel) {
      return {
        find: jest.fn().mockResolvedValue(mockChannels),
        findOne: jest.fn().mockResolvedValue(null),
      };
    }
    return {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
  }),
};

// Mock customer with preferred seller
const mockCustomerWithPreferredSeller = {
  id: '1',
  customFields: {
    postalCode: '1012JS',
    country: 'NL',
    preferredSeller: {
      id: '2'
    }
  }
};

// Mock customer without preferred seller
const mockCustomerWithoutPreferredSeller = {
  id: '2',
  customFields: {
    postalCode: '1012JS',
    country: 'NL'
  }
};

const mockCustomerService = {
  findOneByUserId: jest.fn().mockImplementation((ctx, userId) => {
    if (userId === 'user-with-preferred-seller') {
      return Promise.resolve(mockCustomerWithPreferredSeller);
    } else if (userId === 'user-without-preferred-seller') {
      return Promise.resolve(mockCustomerWithoutPreferredSeller);
    }
    return Promise.resolve(null);
  }),
};

const mockProductVariantService = {
  // Add mock methods as needed
};

// Mock settings with stock threshold
const mockGlobalSettingsService = {
  getSettings: jest.fn().mockResolvedValue({
    outOfStockThreshold: 0
  }),
};

describe('VendorSelectionService', () => {
  let service: VendorSelectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorSelectionService,
        { provide: RequestContextService, useValue: mockRequestContextService },
        { provide: TransactionalConnection, useValue: mockConnection },
        { provide: CustomerService, useValue: mockCustomerService },
        { provide: ProductVariantService, useValue: mockProductVariantService },
        { provide: GlobalSettingsService, useValue: mockGlobalSettingsService },
      ],
    }).compile();

    service = module.get<VendorSelectionService>(VendorSelectionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Test for multiple merkDealers
  describe('getVendors', () => {
    it('should correctly map merkDealers from channel seller', async () => {
      const mockCtx = { apiType: 'shop' } as RequestContext;
      const vendors = await service.getVendors(mockCtx, '123');

      // Check that the first vendor has merkDealers array
      expect(vendors[0].seller?.merkDealers).toBeDefined();
      expect(Array.isArray(vendors[0].seller?.merkDealers)).toBe(true);
      expect(vendors[0].seller?.merkDealers?.length).toBe(2);
      expect(vendors[0].seller?.merkDealers?.[0].id).toBe('2');
      expect(vendors[0].seller?.merkDealers?.[1].id).toBe('3');
    });
  });

  // Simple test for haversineDistance method
  describe('haversineDistance', () => {
    it('should calculate distance between two points', () => {
      // Amsterdam coordinates
      const lat1 = 52.3676;
      const lng1 = 4.9041;

      // Rotterdam coordinates
      const lat2 = 51.9244;
      const lng2 = 4.4777;

      // @ts-ignore - accessing private method for testing
      const distance = service.haversineDistance(lat1, lng1, lat2, lng2);

      // Distance should be approximately 57 km
      expect(distance).toBeGreaterThan(50);
      expect(distance).toBeLessThan(65);
    });
  });

  // Tests for selectVendorForVariation method
  describe('selectVendorForVariation', () => {
    // Helper function to create vendors with stock
    const createVendorsWithStock = (vendors: Vendor[]) => {
      // Mock the getVendors method to return vendors with stock
      jest.spyOn(service, 'getVendors').mockResolvedValue(
        vendors.map(v => ({ ...v, inStock: true }))
      );
    };

    // Helper function to create a mock context with a specific user
    const createContextWithUser = (userId?: string) => {
      return {
        apiType: 'shop',
        languageCode: LanguageCode.en,
        session: userId ? { user: { id: userId } } : undefined
      } as RequestContext;
    };

    // Helper function to create vendors from channels
    const createVendorsFromChannels = () => {
      return mockChannels.map(channel => ({
        slug: channel.token,
        channel: channel.code,
        locales: channel.availableLanguageCodes as LanguageCode[],
        nationalLocale: channel.defaultLanguageCode as LanguageCode,
        sellerId: channel.sellerId ? String(channel.sellerId) : '1',
        seller: channel.seller ? {
          name: channel.seller.name,
          firstName: channel.seller.customFields.firstName || null,
          lastName: channel.seller.customFields.lastName || null,
          emailAddress: channel.seller.customFields.emailAddress || null,
          address: channel.seller.customFields.address || null,
          postalCode: channel.seller.customFields.postalCode || null,
          country: channel.seller.customFields.country || null,
          vendorType: channel.seller.customFields.vendorType || null,
          merkDealers: channel.seller.customFields.merkDealers || null,
          merkDistributeur: channel.seller.customFields.merkDistributeur || null,
        } : null,
        price: 100, // Default price
        inStock: false, // Will be overridden by createVendorsWithStock
      }));
    };

    it('should select customer\'s preferred shop if available', async () => {
      // Create context with a user that has a preferred seller
      const ctx = createContextWithUser('user-with-preferred-seller');

      // Create vendors from channels
      const vendors = createVendorsFromChannels();

      // Make all vendors have stock
      createVendorsWithStock(vendors);

      // Call the method
      const result = await service.selectVendorForVariation(ctx, '123');

      // Verify that the preferred seller was selected
      expect(result.sellerId).toBe('2');
      expect(result.seller?.name).toBe('Dealer 1');
    });

    it('should select lowest price domestic store if no preferred shop', async () => {
      // Create context with a user that has no preferred seller
      const ctx = createContextWithUser('user-without-preferred-seller');

      // Create vendors from channels
      const vendors = createVendorsFromChannels();

      // Set different prices for domestic stores
      vendors[1].price = 90; // Dealer 1 (NL)

      // Make all vendors have stock
      createVendorsWithStock(vendors);

      // Call the method
      const result = await service.selectVendorForVariation(ctx, '123');

      // Verify that the lowest price domestic store was selected
      expect(result.sellerId).toBe('2');
      expect(result.seller?.name).toBe('Dealer 1');
      expect(result.price).toBe(90);
    });

    it('should select closest domestic store if no preferred shop and prices are equal', async () => {
      // Create context with a user that has no preferred seller
      const ctx = createContextWithUser('user-without-preferred-seller');

      // Create vendors from channels
      const vendors = createVendorsFromChannels();

      // Make all vendors have stock
      createVendorsWithStock(vendors);

      // Mock the getDistance method to make Dealer 1 closer
      jest.spyOn(service as any, 'getDistance').mockImplementation(
        (...args: unknown[]) => {
          const vendor = args[0] as Vendor;
          if (vendor.sellerId === '2') return Promise.resolve(10);
          return Promise.resolve(100);
        }
      );

      // Call the method
      const result = await service.selectVendorForVariation(ctx, '123');

      // Verify that the closest domestic store was selected
      expect(result.sellerId).toBe('2');
      expect(result.seller?.name).toBe('Dealer 1');
    });

    it('should select BOARDRUSH if no domestic store available', async () => {
      // Create context with a user that has no preferred seller
      const ctx = createContextWithUser('user-without-preferred-seller');

      // Create vendors from channels
      const vendors = createVendorsFromChannels();

      // Remove domestic stores by setting their inStock to false
      vendors[1].inStock = false; // Dealer 1 (NL)

      // Make BOARDRUSH have stock
      vendors[2].inStock = true; // Boardrush (NL)

      // Mock getVendors to return these specific vendors
      jest.spyOn(service, 'getVendors').mockResolvedValue(vendors);

      // Call the method
      const result = await service.selectVendorForVariation(ctx, '123');

      // Verify that BOARDRUSH was selected
      expect(result.sellerId).toBe('3');
      expect(result.seller?.name).toBe('Boardrush');
      expect(result.seller?.vendorType).toBe('BOARDRUSH_PLATFORM');
    });

    it('should select MERK distributor in country if no BOARDRUSH available', async () => {
      // Create context with a user that has no preferred seller
      const ctx = createContextWithUser('user-without-preferred-seller');

      // Create vendors from channels
      const vendors = createVendorsFromChannels();

      // Remove domestic stores and BOARDRUSH by setting their inStock to false
      vendors[1].inStock = false; // Dealer 1 (NL)
      vendors[2].inStock = false; // Boardrush (NL)

      // Make Agent have stock
      vendors[4].inStock = true; // Agent (NL)

      // Mock getVendors to return these specific vendors
      jest.spyOn(service, 'getVendors').mockResolvedValue(vendors);

      // Call the method
      const result = await service.selectVendorForVariation(ctx, '123');

      // Verify that Agent was selected
      expect(result.sellerId).toBe('5');
      expect(result.seller?.name).toBe('Agent');
      expect(result.seller?.vendorType).toBe('AGENT');
    });

    it('should select MERK factory if no distributor in country available', async () => {
      // Create context with a user that has no preferred seller
      const ctx = createContextWithUser('user-without-preferred-seller');

      // Create vendors from channels
      const vendors = createVendorsFromChannels();

      // Remove domestic stores, BOARDRUSH, and Agent by setting their inStock to false
      vendors[1].inStock = false; // Dealer 1 (NL)
      vendors[2].inStock = false; // Boardrush (NL)
      vendors[4].inStock = false; // Agent (NL)

      // Make Manufacturer have stock
      vendors[0].inStock = true; // Manufacturer (NL)

      // Mock getVendors to return these specific vendors
      jest.spyOn(service, 'getVendors').mockResolvedValue(vendors);

      // Call the method
      const result = await service.selectVendorForVariation(ctx, '123');

      // Verify that Manufacturer was selected
      expect(result.sellerId).toBe('1');
      expect(result.seller?.name).toBe('Manufacturer');
      expect(result.seller?.vendorType).toBe('MANUFACTURER');
    });

    it('should select international vendor if no domestic vendor available', async () => {
      // Create context with a user that has no preferred seller
      const ctx = createContextWithUser('user-without-preferred-seller');

      // Create vendors from channels
      const vendors = createVendorsFromChannels();

      // Remove all domestic vendors by setting their inStock to false
      vendors[0].inStock = false; // Manufacturer (NL)
      vendors[1].inStock = false; // Dealer 1 (NL)
      vendors[2].inStock = false; // Boardrush (NL)
      vendors[4].inStock = false; // Agent (NL)

      // Make International Dealer have stock
      vendors[3].inStock = true; // International Dealer (DE)

      // Mock getVendors to return these specific vendors
      jest.spyOn(service, 'getVendors').mockResolvedValue(vendors);

      // Call the method
      const result = await service.selectVendorForVariation(ctx, '123');

      // Verify that International Dealer was selected
      expect(result.sellerId).toBe('4');
      expect(result.seller?.name).toBe('International Dealer');
      expect(result.seller?.country).toBe('DE');
    });
  });
});
