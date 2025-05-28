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

  describe('getServiceLocationForProduct', () => {
    it('should return null if no vendor is found', async () => {
      mockVendorSelectionService.selectVendorForVariation.mockResolvedValue(undefined);

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
  });
});
