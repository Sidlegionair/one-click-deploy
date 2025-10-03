import { Test, TestingModule } from '@nestjs/testing';
import { VendorSelectionResolver, ServiceLocationResult } from './vendor-selection.resolver';
import { VendorSelectionService, Vendor } from '../service/vendor-selection.service';
import { RequestContext, LanguageCode } from '@vendure/core';

describe('VendorSelectionResolver', () => {
  let resolver: VendorSelectionResolver;
  let mockVendorSelectionService: jest.Mocked<VendorSelectionService>;

  beforeEach(async () => {
    mockVendorSelectionService = {
      selectVendorForVariation: jest.fn(),
    } as unknown as jest.Mocked<VendorSelectionService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorSelectionResolver,
        { provide: VendorSelectionService, useValue: mockVendorSelectionService },
      ],
    }).compile();

    resolver = module.get<VendorSelectionResolver>(VendorSelectionResolver);
  });

  describe('selectVendorForVariation', () => {
    it('should return a mapped vendor if found', async () => {
      const mockVendor: Vendor = {
        slug: 'test-vendor',
        channel: 'test-channel',
        locales: [LanguageCode.en],
        nationalLocale: LanguageCode.en,
        sellerId: 's1',
        seller: {
          name: 'Test Seller',
          firstName: 'First',
          lastName: 'Last',
          emailAddress: 'test@test.com',
          address: '123 Street',
          postalCode: '12345',
          country: 'US',
          vendorType: 'MANUFACTURER',
        },
        price: 100,
        inStock: true,
      };
      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(mockVendor);

      const result = await resolver.selectVendorForVariation({} as RequestContext, 'p1');

      expect(result).toBeDefined();
      expect(result?.sellerId).toBe('s1');
      expect(result?.name).toBe('Test Seller');
      expect(result?.slug).toBe('test-vendor');
    });

    it('should return null if no vendor is found', async () => {
      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(undefined as any);

      const result = await resolver.selectVendorForVariation({} as RequestContext, 'p1');

      expect(result).toBeNull();
    });

    it('should return null if vendor has no seller', async () => {
      const mockVendor: Vendor = {
        slug: 'test-vendor',
        channel: 'test-channel',
        locales: [LanguageCode.en],
        nationalLocale: LanguageCode.en,
        sellerId: 's1',
        seller: null as any, // No seller
        price: 100,
        inStock: true,
      };
      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(mockVendor);

      const result = await resolver.selectVendorForVariation({} as RequestContext, 'p1');

      expect(result).toBeNull();
    });
  });

  describe('getServiceLocationForProduct', () => {
    it('should return null if no vendor is found', async () => {
      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(null as unknown as Vendor);

      const result = await resolver.getServiceLocationForProduct({} as RequestContext, '123');

      expect(result).toBeNull();
    });

    it('should return service location info for PHYSICAL_STORE_OR_SERVICE_DEALER vendor', async () => {
      const mockVendor: Vendor = {
        slug: 'physical-store',
        channel: 'store-channel',
        locales: [LanguageCode.en],
        nationalLocale: LanguageCode.en,
        sellerId: '1',
        seller: {
          name: 'Physical Store',
          firstName: 'John',
          lastName: 'Doe',
          emailAddress: 'john@example.com',
          address: '123 Main St',
          postalCode: '12345',
          country: 'NL',
          vendorType: 'PHYSICAL_STORE_OR_SERVICE_DEALER',
        },
        price: 100,
        inStock: true,
      };

      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(mockVendor);

      const result = await resolver.getServiceLocationForProduct({} as RequestContext, '123');

      expect(result).not.toBeNull();
      expect(result?.serviceAgentAvailable).toBe(false);
      expect(result?.scenario).toBe('Product besteld bij een WINKEL');
      expect(result?.serviceDealer).not.toBeNull();
      expect(result?.serviceDealer?.sellerId).toBe('1');
      expect(result?.serviceDealer?.vendorType).toBe('PHYSICAL_STORE_OR_SERVICE_DEALER');
    });

    it('should return service location info for MANUFACTURER vendor with merkDealers', async () => {
      const mockVendor: Vendor = {
        slug: 'manufacturer',
        channel: 'manufacturer-channel',
        locales: [LanguageCode.en],
        nationalLocale: LanguageCode.en,
        sellerId: '2',
        seller: {
          name: 'Manufacturer',
          firstName: 'Jane',
          lastName: 'Smith',
          emailAddress: 'jane@example.com',
          address: '456 Oak St',
          postalCode: '67890',
          country: 'NL',
          vendorType: 'MANUFACTURER',
          merkDealers: [
            {
              id: '3',
              name: 'Dealer',
              customFields: {
                firstName: 'Bob',
                lastName: 'Johnson',
                emailAddress: 'bob@example.com',
                address: '789 Pine St',
                postalCode: '54321',
                country: 'NL',
                vendorType: 'PHYSICAL_STORE_OR_SERVICE_DEALER',
              },
            },
          ],
        },
        price: 200,
        inStock: true,
      };

      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(mockVendor);

      const result = await resolver.getServiceLocationForProduct({} as RequestContext, '123');

      expect(result).not.toBeNull();
      expect(result?.serviceAgentAvailable).toBe(true);
      expect(result?.scenario).toBe('Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt');
      expect(result?.serviceDealer).not.toBeNull();
      expect(result?.serviceDealer?.sellerId).toBe('3');
      expect(result?.serviceDealer?.name).toBe('Dealer');
    });

    it('should return service location info for BOARDRUSH_PLATFORM vendor', async () => {
      const mockVendor: Vendor = {
        slug: 'boardrush',
        channel: 'boardrush-channel',
        locales: [LanguageCode.en],
        nationalLocale: LanguageCode.en,
        sellerId: '4',
        seller: {
          name: 'Boardrush',
          firstName: 'Admin',
          lastName: 'User',
          emailAddress: 'admin@boardrush.com',
          address: '101 Board St',
          postalCode: '11111',
          country: 'NL',
          vendorType: 'BOARDRUSH_PLATFORM',
        },
        price: 300,
        inStock: true,
      };

      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(mockVendor);

      const result = await resolver.getServiceLocationForProduct({} as RequestContext, '123');

      expect(result).not.toBeNull();
      expect(result?.serviceAgentAvailable).toBe(false);
      expect(result?.scenario).toBe('Product besteld bij BOARDRUSH zelf');
      expect(result?.serviceDealer).toBeNull();
    });

    it('should return service location info for MANUFACTURER vendor with merkDistributeur', async () => {
      const mockVendor: Vendor = {
        slug: 'manufacturer-dist',
        channel: 'manufacturer-dist-channel',
        locales: [LanguageCode.en],
        nationalLocale: LanguageCode.en,
        sellerId: '5',
        seller: {
          name: 'Manufacturer with Distributor',
          vendorType: 'MANUFACTURER',
          merkDistributeur: {
            id: '6',
            name: 'Distributor',
            customFields: {
              vendorType: 'DISTRIBUTOR',
            },
          },
        },
        price: 400,
        inStock: true,
      } as any;

      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(mockVendor);

      const result = await resolver.getServiceLocationForProduct({} as RequestContext, '123');

      expect(result).not.toBeNull();
      expect(result?.serviceAgentAvailable).toBe(true);
      expect(result?.scenario).toBe('Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt');
      expect(result?.serviceDealer).not.toBeNull();
      expect(result?.serviceDealer?.sellerId).toBe('6');
      expect(result?.serviceDealer?.name).toBe('Distributor');
    });

    it('should handle MANUFACTURER vendor with no service dealer', async () => {
      const mockVendor: Vendor = {
        slug: 'manufacturer-no-dealer',
        channel: 'manufacturer-no-dealer-channel',
        locales: [LanguageCode.en],
        nationalLocale: LanguageCode.en,
        sellerId: '7',
        seller: {
          name: 'Manufacturer No Dealer',
          vendorType: 'MANUFACTURER',
        },
        price: 500,
        inStock: true,
      } as any;

      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(mockVendor);

      const result = await resolver.getServiceLocationForProduct({} as RequestContext, '123');

      expect(result).not.toBeNull();
      expect(result?.serviceAgentAvailable).toBe(true);
      expect(result?.scenario).toBe('Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER');
      expect(result?.serviceDealer).toBeNull();
    });

    it('should return service location for BOARDRUSH_PLATFORM with a merkDealer', async () => {
        const mockVendor: Vendor = {
            slug: 'boardrush-with-dealer',
            channel: 'boardrush-dealer-channel',
            locales: [LanguageCode.en],
            nationalLocale: LanguageCode.en,
            sellerId: '8',
            seller: {
                name: 'Boardrush with Dealer',
                vendorType: 'BOARDRUSH_PLATFORM',
                merkDealers: [{
                    id: '9',
                    name: 'Servicing Dealer',
                    customFields: { vendorType: 'PHYSICAL_STORE_OR_SERVICE_DEALER' }
                }]
            },
            price: 600,
            inStock: true,
        } as any;

        mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(mockVendor);
        const result = await resolver.getServiceLocationForProduct({} as RequestContext, '123');

        expect(result).not.toBeNull();
        expect(result?.serviceAgentAvailable).toBe(false);
        expect(result?.scenario).toBe('Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat');
        expect(result?.serviceDealer).not.toBeNull();
        expect(result?.serviceDealer?.sellerId).toBe('9');
    });

    it('should handle an unknown vendor type', async () => {
        const mockVendor: Vendor = {
            slug: 'unknown-vendor',
            channel: 'unknown-channel',
            locales: [LanguageCode.en],
            nationalLocale: LanguageCode.en,
            sellerId: '10',
            seller: {
                name: 'Unknown Vendor',
                vendorType: 'UNKNOWN_TYPE',
            },
            price: 700,
            inStock: true,
        } as any;

        mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(mockVendor);
        const result = await resolver.getServiceLocationForProduct({} as RequestContext, '123');

        expect(result).not.toBeNull();
        expect(result?.scenario).toBe('Onbekend scenario');
        expect(result?.serviceDealer).toBeNull();
    });
  });
});