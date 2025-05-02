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
    slug: string;         // Channel token
    channel: string;      // Channel code
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
        merkDealer?: { id: string } | null;
        merkDistributeur?: { id: string } | null;
    } | null;
    price: number;
    inStock: boolean;
    coords?: { lat: number; lng: number };
}

@Injectable()
export class VendorSelectionService {
    private logger = new Logger(VendorSelectionService.name);
    private geocodeCache = new Map<string, { lat: number; lng: number }>();

    constructor(
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
        private customerService: CustomerService,
        private productVariantService: ProductVariantService,
        private globalSettingsService: GlobalSettingsService,
    ) {}

    /**
     * Retrieves channels with their related Seller and StockLocations,
     * and computes for each the actual price and saleable stock
     * for the assigned stock location.
     */
    async getVendors(ctx: RequestContext, productId: string): Promise<Vendor[]> {
        const channelRepo = this.connection.getRepository(ctx, Channel);
        const channels = await channelRepo.find({
            relations: ['seller', 'stockLocations'],
            take: 100,
        });

        // Load global settings once for threshold lookup
        const settings = await this.globalSettingsService.getSettings(ctx);

        const vendors: Vendor[] = await Promise.all(
            channels.map(async channel => {
                // Create a channel-specific RequestContext
                const channelCtx = new RequestContext({
                    channel,
                    apiType: ctx.apiType,
                    languageCode: channel.defaultLanguageCode as LanguageCode,
                    authorizedAsOwnerOnly: ctx.authorizedAsOwnerOnly,
                    session: ctx.session,
                    isAuthorized: true,
                });

                // Fetch the variant for this channel
                const variantRepo = this.connection.getRepository(channelCtx, ProductVariant);
                const variant = await variantRepo.findOne({ where: { id: productId } });

                // Determine the single assigned stockLocationId for this channel
                let assignedStockLocationId: string | undefined;
                if (String(channel.id) === DEFAULT_STOCK_LOCATION_ID) {
                    assignedStockLocationId = DEFAULT_STOCK_LOCATION_ID;
                } else if (channel.stockLocations?.length) {
                    assignedStockLocationId = String(channel.stockLocations[0].id);
                }

                // Calculate saleable stock manually: stockOnHand - stockAllocated - threshold
                let inStock = false;
                if (variant && assignedStockLocationId) {
                    const stockLevelRepo = this.connection.getRepository(channelCtx, StockLevel);
                    const stockLevels = await stockLevelRepo.find({
                        where: {
                            productVariantId: productId,
                            stockLocationId: assignedStockLocationId,
                        },
                    });

                    const totalOnHand    = stockLevels.reduce((sum, sl) => sum + sl.stockOnHand, 0);
                    const totalAllocated = stockLevels.reduce((sum, sl) => sum + sl.stockAllocated, 0);
                    const threshold = variant.useGlobalOutOfStockThreshold
                        ? settings.outOfStockThreshold
                        : variant.outOfStockThreshold ?? 0;

                    const saleable = totalOnHand - totalAllocated - threshold;
                    inStock = saleable > 0;
                }

                // Determine price (channel-specific or fallback)
                const price = variant ? variant.price : 0;

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
                            merkDealer: channel.seller.customFields.merkDealer || null,
                            merkDistributeur: channel.seller.customFields.merkDistributeur || null,
                        }
                        : null,
                    price,
                    inStock,
                } as Vendor;
            })
        );

        return vendors;
    }

    // Retrieves the authenticated customer if available
    private async getAuthenticatedCustomer(ctx: RequestContext): Promise<any | undefined> {
        if (ctx.session && ctx.session.user) {
            return this.customerService.findOneByUserId(ctx, ctx.session.user.id);
        }
        return undefined;
    }

    /**
     * Geocodes a postal code and country using OpenStreetMap's Nominatim API.
     * Caches results to avoid repeated requests.
     */
    private async geocode(postalCode: string, country: string): Promise<{ lat: number; lng: number } | null> {
        const key = `${postalCode},${country}`;
        if (this.geocodeCache.has(key)) {
            return this.geocodeCache.get(key)!;
        }
        try {
            const response = await axios.get('https://nominatim.openstreetmap.org/search', {
                params: { postalcode: postalCode, country, format: 'json', addressdetails: 0, limit: 1 },
                headers: { 'User-Agent': 'VendureVendorSelection/1.0' },
            });
            const data = response.data;
            if (data?.length) {
                const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                this.geocodeCache.set(key, result);
                return result;
            }
        } catch (err) {
            this.logger.error(`Geocoding failed for ${key}`, err);
        }
        return null;
    }

    /**
     * Computes the Haversine distance (in km) between two geo-coordinates.
     */
    private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const toRad = (deg: number) => deg * (Math.PI / 180);
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Returns the distance (in km) between a vendor and the customer.
     */
    private async getDistance(vendor: Vendor, customerPostalCode: string, customerCountry: string): Promise<number> {
        if (!vendor.seller?.postalCode || !vendor.seller?.country) {
            return Number.MAX_SAFE_INTEGER;
        }
        if (!vendor.coords) {
            const coords = await this.geocode(vendor.seller.postalCode, vendor.seller.country);
            vendor.coords = coords || undefined;
        }
        if (!vendor.coords) {
            return Number.MAX_SAFE_INTEGER;
        }
        const customerCoords = await this.geocode(customerPostalCode, customerCountry);
        if (!customerCoords) {
            return Number.MAX_SAFE_INTEGER;
        }
        return this.haversineDistance(
            vendor.coords.lat,
            vendor.coords.lng,
            customerCoords.lat,
            customerCoords.lng,
        );
    }

    /**
     * Returns the vendor that is closest (by distance) to the customer.
     */
    private async getClosestVendor(
        vendors: Vendor[],
        customerPostalCode: string,
        customerCountry: string,
    ): Promise<Vendor | undefined> {
        let closest: Vendor | undefined;
        let minDist = Number.MAX_SAFE_INTEGER;
        for (const v of vendors) {
            const dist = await this.getDistance(v, customerPostalCode, customerCountry);
            if (dist < minDist) {
                minDist = dist;
                closest = v;
            }
        }
        return closest;
    }

    /**
     * Implements the eight-step supplier selection hierarchy:
     * 1. BOARDRUSH_PLATFORM
     * 2. Customer’s Preferred Shop
     * 3. Lowest Price Within Country
     * 4. MERK Dealer by Postal Code
     * 5. Non-MERK Dealer Nearby
     * 6. MERK Distributeur
     * 7. MERK Manufacturer
     * 8. International fallback
     */
    async selectVendorForVariation(
        ctx: RequestContext,
        productId: string,
    ): Promise<Vendor | undefined> {
        const vendors = await this.getVendors(ctx, productId);
        const customer = await this.getAuthenticatedCustomer(ctx);
        const queryLang = ctx.languageCode;

        let customerPostalCode: string | undefined;
        let customerCountry: string | undefined;
        if (customer?.customFields) {
            customerPostalCode = customer.customFields.postalCode ?? undefined;
            customerCountry   = customer.customFields.country ?? undefined;
        }
        if (!customerPostalCode || !customerCountry) {
            customerPostalCode = vendors[0]?.seller?.postalCode ?? undefined;
            customerCountry   = vendors[0]?.seller?.country ?? undefined;
        }

        let available = vendors.filter(v => v.inStock);
        if (!customer) {
            available = available.filter(v => v.locales.includes(queryLang));
        }

        // 1. BOARDRUSH_PLATFORM
        let sel = available.find(v => v.seller?.vendorType === 'BOARDRUSH_PLATFORM');
        if (sel) return sel;

        // 2. Customer’s Preferred Shop
        if (customer?.customFields?.preferredSeller) {
            const pid = String(customer.customFields.preferredSeller.id);
            sel = available.find(v => v.sellerId === pid);
            if (sel) return sel;
        }

        // 3. Lowest Price Within Country
        const domestic = available.filter(v =>
            v.seller?.country === customerCountry &&
            v.seller?.vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER'
        );
        if (domestic.length) {
            domestic.sort((a, b) => a.price - b.price);
            return domestic[0];
        }

        // 4. MERK Dealer by Postal Code
        const manuWithDealer = available.filter(v =>
            v.seller?.vendorType === 'MANUFACTURER' &&
            v.seller?.merkDealer?.id
        );
        for (const m of manuWithDealer) {
            sel = available.find(v => v.sellerId === m.seller!.merkDealer!.id);
            if (sel) return sel;
        }

        // 5. Non-MERK Dealer Nearby
        const nonAttached = available.filter(v =>
            v.seller?.country === customerCountry &&
            v.seller?.vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER'
        );
        if (nonAttached.length && customerPostalCode && customerCountry) {
            sel = await this.getClosestVendor(nonAttached, customerPostalCode, customerCountry);
            if (sel) return sel;
        }

        // 6. MERK Distributeur
        const manuWithDistrib = available.filter(v =>
            v.seller?.vendorType === 'MANUFACTURER' &&
            v.seller?.merkDistributeur?.id
        );
        for (const m of manuWithDistrib) {
            sel = available.find(v => v.sellerId === m.seller!.merkDistributeur!.id);
            if (sel) return sel;
        }
        const agents = available.filter(v => v.seller?.vendorType === 'AGENT');
        if (agents.length) return agents[0];

        // 7. MERK Manufacturer
        const makers = available.filter(v => v.seller?.vendorType === 'MANUFACTURER');
        if (makers.length) return makers[0];

        // 8. International fallback
        if (available.length && customerPostalCode && customerCountry) {
            return this.getClosestVendor(available, customerPostalCode, customerCountry);
        }

        return undefined;
    }
}
