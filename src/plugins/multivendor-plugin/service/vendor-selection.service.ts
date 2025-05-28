import { Injectable, Logger } from '@nestjs/common';
import {
    RequestContext,
    Channel,
    TransactionalConnection,
    RequestContextService,
    CustomerService,
    ProductVariantService,
    ProductVariant,
    GlobalSettingsService,
    StockLevel,
    LanguageCode,
} from '@vendure/core';
import axios from 'axios';

// For the default channel, assume stock location id "1" and seller id "1"
const DEFAULT_STOCK_LOCATION_ID = '1';
const DEFAULT_SELLER_ID = '1';

export interface Vendor {
    slug: string;
    channel: string;
    locales: LanguageCode[];
    nationalLocale: LanguageCode;
    sellerId: string;
    seller: {
        name: string;
        firstName: string | null;
        lastName: string | null;
        emailAddress: string | null;
        address: string | null;
        postalCode: string | null;
        country: string | null;
        vendorType: string | null;
        merkDealers?: { id: string; name: string; customFields?: any }[] | null;
        merkDistributeur?: { id: string; name: string; customFields?: any } | null;
    } | null;
    price: number;
    inStock: boolean;
    coords?: { lat: number; lng: number };
}

@Injectable()
export class VendorSelectionService {
    private logger = new Logger(VendorSelectionService.name);
    private geocodeCache = new Map<string, { lat: number; lng: number }>();

    // Fallback defaults to the Netherlands
    private static readonly DEFAULT_FALLBACK_POSTAL_CODE = '1012JS';
    private static readonly DEFAULT_FALLBACK_COUNTRY = 'NL';

    constructor(
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
        private customerService: CustomerService,
        private productVariantService: ProductVariantService,
        private globalSettingsService: GlobalSettingsService,
    ) {}

    async getVendors(ctx: RequestContext, productId: string): Promise<Vendor[]> {
        this.logger.debug(`getVendors: productId=${productId}`);
        const channelRepo = this.connection.getRepository(ctx, Channel);
        const channels = await channelRepo.find({
            relations: ['seller', 'stockLocations', 'seller.customFields.merkDealers', 'seller.customFields.merkDistributeur'],
            take: 100,
        });
        this.logger.debug(`getVendors: fetched ${channels.length} channels`);

        const settings = await this.globalSettingsService.getSettings(ctx);

        return Promise.all(
            channels.map(async channel => {
                const channelCtx = new RequestContext({
                    channel,
                    apiType: ctx.apiType,
                    languageCode: channel.defaultLanguageCode as LanguageCode,
                    authorizedAsOwnerOnly: ctx.authorizedAsOwnerOnly,
                    session: ctx.session,
                    isAuthorized: true,
                });
                const variantRepo = this.connection.getRepository(channelCtx, ProductVariant);
                const variant = await variantRepo.findOne({ where: { id: productId } });

                // Determine stock location
                let assignedStockLocationId: string | undefined;
                if (String(channel.id) === DEFAULT_STOCK_LOCATION_ID) {
                    assignedStockLocationId = DEFAULT_STOCK_LOCATION_ID;
                } else if (channel.stockLocations?.length) {
                    assignedStockLocationId = String(channel.stockLocations[0].id);
                }

                // Calculate inStock
                let inStock = false;
                if (variant && assignedStockLocationId) {
                    const stockLevelRepo = this.connection.getRepository(channelCtx, StockLevel);
                    const stockLevels = await stockLevelRepo.find({
                        where: {
                            productVariantId: productId,
                            stockLocationId: assignedStockLocationId,
                        },
                    });
                    const totalOnHand = stockLevels.reduce((sum, sl) => sum + sl.stockOnHand, 0);
                    const totalAllocated = stockLevels.reduce((sum, sl) => sum + sl.stockAllocated, 0);
                    const threshold = variant.useGlobalOutOfStockThreshold
                        ? settings.outOfStockThreshold
                        : variant.outOfStockThreshold ?? 0;
                    inStock = totalOnHand - totalAllocated - threshold > 0;
                }

                return {
                    slug: channel.token,
                    channel: channel.code,
                    locales: channel.availableLanguageCodes as LanguageCode[],
                    nationalLocale: channel.defaultLanguageCode as LanguageCode,
                    sellerId: channel.sellerId ? String(channel.sellerId) : DEFAULT_SELLER_ID,
                    seller: channel.seller
                        ? {
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
                        }
                        : null,
                    price: variant?.price ?? 0,
                    inStock,
                } as Vendor;
            })
        );
    }

    private async getAuthenticatedCustomer(ctx: RequestContext): Promise<any | undefined> {
        if (ctx.session?.user) {
            return this.customerService.findOneByUserId(ctx, ctx.session.user.id);
        }
        return undefined;
    }

    private async geocode(postalCode: string, country: string): Promise<{ lat: number; lng: number } | null> {
        const key = `${postalCode},${country}`;
        if (this.geocodeCache.has(key)) return this.geocodeCache.get(key)!;
        try {
            const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
                params: { postalcode: postalCode, country, format: 'json', limit: 1 },
                headers: { 'User-Agent': 'VendureVendorSelection/1.0' },
            });
            if (data?.length) {
                const loc = { lat: +data[0].lat, lng: +data[0].lon };
                this.geocodeCache.set(key, loc);
                return loc;
            }
        } catch {
            // log error silently
        }
        return null;
    }

    private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const toRad = (deg: number) => deg * (Math.PI / 180);
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private async getDistance(vendor: Vendor, postalCode: string, country: string): Promise<number> {
        if (!vendor.seller?.postalCode || !vendor.seller.country) return Number.MAX_SAFE_INTEGER;
        if (!vendor.coords) {
            vendor.coords = (await this.geocode(vendor.seller.postalCode, vendor.seller.country)) || undefined;
        }
        const cust = await this.geocode(postalCode, country);
        return vendor.coords && cust
            ? this.haversineDistance(vendor.coords.lat, vendor.coords.lng, cust.lat, cust.lng)
            : Number.MAX_SAFE_INTEGER;
    }

    private async getClosestVendor(vendors: Vendor[], postalCode: string, country: string): Promise<Vendor> {
        // Always return at least the first vendor
        let closest = vendors[0];
        let minDist = Number.MAX_SAFE_INTEGER;
        for (const v of vendors) {
            const dist = await this.getDistance(v, postalCode, country);
            if (dist < minDist) {
                minDist = dist;
                closest = v;
            }
        }
        return closest;
    }

    private resolveCustomerLocation(postalCode?: string, country?: string) {
        return {
            postalCode: postalCode ?? VendorSelectionService.DEFAULT_FALLBACK_POSTAL_CODE,
            country: country ?? VendorSelectionService.DEFAULT_FALLBACK_COUNTRY,
        };
    }

    async selectVendorForVariation(ctx: RequestContext, productId: string): Promise<Vendor> {
        this.logger.debug(`selectVendorForVariation: pid=${productId}`);
        const vendors = await this.getVendors(ctx, productId);
        const customer = await this.getAuthenticatedCustomer(ctx);
        const lang = ctx.languageCode;

        const { postalCode, country } = this.resolveCustomerLocation(
            customer?.customFields?.postalCode,
            customer?.customFields?.country
        );
        this.logger.debug(`Using location: ${postalCode}/${country}`);

        let available = vendors.filter(v => v.inStock);
        if (!customer) available = available.filter(v => v.locales.includes(lang));

        // 1. Customer's Preferred Shop (Voorkeurswinkel van de klant)
        if (customer?.customFields?.preferredSeller) {
            let sel = available.find(v => v.sellerId === String(customer.customFields.preferredSeller.id));
            if (sel) return sel;
        }

        // 2. Lowest price domestic (Prijs binnen landsgrenzen)
        const domesticStores = available.filter(
            v => v.seller?.country === country && v.seller?.vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER'
        );
        if (domesticStores.length) return domesticStores.sort((a, b) => a.price - b.price)[0];

        // 3. Selection based on postal code (Selectie op Basis van Postcode)
        const domesticByPostcode = available.filter(
            v => v.seller?.country === country && v.seller?.vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER'
        );
        if (domesticByPostcode.length) return await this.getClosestVendor(domesticByPostcode, postalCode, country);

        // 4. BOARDRUSH stock (BOARDRUSH Voorraad)
        let sel = available.find(v => v.seller?.vendorType === 'BOARDRUSH_PLATFORM');
        if (sel) return sel;

        // 5. MERK Distributor in country (MERK Distributeur in Land)
        // Check for manufacturers or agents in the same country
        const domesticManufacturers = available.filter(
            v => v.seller?.country === country && 
                (v.seller?.vendorType === 'MANUFACTURER' || v.seller?.vendorType === 'AGENT')
        );

        // First try manufacturers with merkDealers
        sel = domesticManufacturers.find(v => 
            v.seller?.vendorType === 'MANUFACTURER' && 
            v.seller.merkDealers?.length && 
            v.seller.merkDealers.some(dealer => available.some(x => x.sellerId === dealer.id))
        );
        if (sel) return sel;

        // Then try manufacturers with merkDistributeur
        sel = domesticManufacturers.find(v =>
            v.seller?.vendorType === 'MANUFACTURER' && 
            v.seller.merkDistributeur?.id && 
            available.some(x => x.sellerId === v.seller!.merkDistributeur!.id)
        );
        if (sel) return sel;

        // Then try any agent
        sel = domesticManufacturers.find(v => v.seller?.vendorType === 'AGENT');
        if (sel) return sel;

        // 6. MERK Factory (MERK Fabriek)
        // Any manufacturer, regardless of country
        sel = available.find(v => v.seller?.vendorType === 'MANUFACTURER');
        if (sel) return sel;

        // 7. International selection based on postal code (Internationale Selectie op Basis van Postcode)
        return await this.getClosestVendor(available, postalCode, country);
    }
}
