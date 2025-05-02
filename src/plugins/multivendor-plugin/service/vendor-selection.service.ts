import { Injectable, Logger } from '@nestjs/common';
import {
    RequestContext,
    Channel,
    TransactionalConnection,
    RequestContextService,
    CustomerService,
    ProductVariant,
    LanguageCode, StockLevel,
} from '@vendure/core';
import axios from 'axios';

// For default, we assume stock location id "1" and seller id "1"
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
        // Custom relation fields for manufacturer delegation:
        merkDealer?: { id: string } | null;
        merkDistributeur?: { id: string } | null;
    } | null;
    price: number;
    inStock: boolean;
    // Cached coordinates for distance calculations.
    coords?: { lat: number; lng: number };
}

@Injectable()
export class VendorSelectionService {
    private logger = new Logger(VendorSelectionService.name);
    // In-memory cache for geocoding results keyed by "postalCode,country"
    private geocodeCache = new Map<string, { lat: number; lng: number }>();

    constructor(
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
        private customerService: CustomerService
    ) {}

    /**
     * Retrieves channels with their related Seller and StockLocations,
     * and queries the actual ProductVariant data for each channel.
     * Uses the provided productId (the variation ID) to get real price and stock data.
     */
    async getVendors(ctx: RequestContext, productId: string): Promise<Vendor[]> {
        const channelRepo = this.connection.getRepository(ctx, Channel);
        // Include the stockLocations relation to access assigned stock locations.
        const channels = await channelRepo.find({
            relations: ['seller', 'stockLocations'],
            take: 100,
        });

        channels.forEach(channel => {
            if (channel.seller) {
                console.log('Channel Seller:', JSON.stringify(channel.seller, null, 2));
            }
        });

        const vendors: Vendor[] = await Promise.all(
            channels.map(async (channel: Channel) => {
                // Create a channel-specific RequestContext.
                const channelCtx = new RequestContext({
                    channel,
                    apiType: ctx.apiType,
                    languageCode: channel.defaultLanguageCode as LanguageCode,
                    authorizedAsOwnerOnly: ctx.authorizedAsOwnerOnly,
                    session: ctx.session,
                    isAuthorized: true,
                });
                // Query the actual ProductVariant for this channel.
                const variantRepo = this.connection.getRepository(channelCtx, ProductVariant);
                const variant = await variantRepo.findOne({ where: { id: productId } });

                // Determine which stock location to use:
                // For the default channel (assumed to have id "1"), always use stock location "1".
                // For other channels, only use an assigned stock location if available.
                let assignedStockLocationId;
                if (String(channel.id) === "1") {
                    assignedStockLocationId = DEFAULT_STOCK_LOCATION_ID;
                } else if (channel.stockLocations && channel.stockLocations.length > 0) {
                    assignedStockLocationId = channel.stockLocations[0].id;
                } else {
                    assignedStockLocationId = undefined; // Do not fall back to "1" for non-default channels.
                }

                let inStock = false;
                if (variant && assignedStockLocationId) {
                    const stockLevelRepo = this.connection.getRepository(channelCtx, StockLevel);
                    const stockLevels = await stockLevelRepo.find({
                        where: {
                            productVariantId: productId,
                            stockLocationId: assignedStockLocationId,
                        },
                    });
                    const totalAvailableStock = stockLevels.reduce(
                        (sum, sl) => sum + (sl.stockOnHand - sl.stockAllocated),
                        0
                    );
                    inStock = totalAvailableStock > 0;
                }

                const price = variant ? variant.price : 0;


                if (channel.seller) {
                    console.log('Seller Custom Fields:', channel.seller.customFields);
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
                            // Custom relation fields:
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

    /**
     * Retrieves the authenticated customer (if available).
     */
    private async getAuthenticatedCustomer(ctx: RequestContext): Promise<any | undefined> {
        if (ctx.session && ctx.session.user) {
            return this.customerService.findOneByUserId(ctx, ctx.session.user.id);
        }
        return undefined;
    }

    /**
     * Geocodes a postal code (with country) using OpenStreetMap’s Nominatim API.
     * Results are cached.
     */
    private async geocode(postalCode: string, country: string): Promise<{ lat: number; lng: number } | null> {
        const key = `${postalCode},${country}`;
        if (this.geocodeCache.has(key)) {
            return this.geocodeCache.get(key)!;
        }
        try {
            const url = 'https://nominatim.openstreetmap.org/search';
            const response = await axios.get(url, {
                params: {
                    postalcode: postalCode,
                    country,
                    format: 'json',
                    addressdetails: 0,
                    limit: 1,
                },
                headers: { 'User-Agent': 'VendureVendorSelection/1.0' },
            });
            const data = response.data;
            if (data && data.length > 0) {
                const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                this.geocodeCache.set(key, result);
                return result;
            }
        } catch (error) {
            this.logger.error(`Geocoding failed for ${key}`, error);
        }
        return null;
    }

    /**
     * Computes the Haversine distance (in km) between two geo-coordinates.
     */
    private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const toRadians = (deg: number) => deg * (Math.PI / 180);
        const R = 6371;
        const dLat = toRadians(lat2 - lat1);
        const dLng = toRadians(lng2 - lng1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLng / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Returns the distance (in km) between a vendor and the customer.
     */
    private async getDistance(vendor: Vendor, customerPostalCode: string, customerCountry: string): Promise<number> {
        if (!vendor.seller || !vendor.seller.postalCode || !vendor.seller.country) {
            return Number.MAX_SAFE_INTEGER;
        }
        if (!vendor.coords) {
            const coords = await this.geocode(vendor.seller.postalCode, vendor.seller.country);
            vendor.coords = coords || undefined;
        }
        const vendorCoords = vendor.coords;
        if (!vendorCoords) return Number.MAX_SAFE_INTEGER;
        const customerCoords = await this.geocode(customerPostalCode, customerCountry);
        if (!customerCoords) return Number.MAX_SAFE_INTEGER;
        return this.haversineDistance(vendorCoords.lat, vendorCoords.lng, customerCoords.lat, customerCoords.lng);
    }

    /**
     * Returns the vendor from a list that is closest (by geocoded distance) to the customer.
     */
    private async getClosestVendor(
        vendors: Vendor[],
        customerPostalCode: string,
        customerCountry: string
    ): Promise<Vendor | undefined> {
        let closest: Vendor | undefined;
        let minDistance = Number.MAX_SAFE_INTEGER;
        for (const vendor of vendors) {
            const dist = await this.getDistance(vendor, customerPostalCode, customerCountry);
            if (dist < minDistance) {
                minDistance = dist;
                closest = vendor;
            }
        }
        return closest;
    }

    /**
     * Implements the eight‑step supplier selection hierarchy:
     *
     * 1. Boardrush (own stock): vendor with seller.vendorType === "BOARDRUSH_PLATFORM".
     * 2. Customer’s Preferred Shop: if customer.customFields.preferredSeller exists.
     * 3. Lowest Price Within Country: among domestic vendors with vendorType === "PHYSICAL_STORE_OR_SERVICE_DEALER".
     * 4. MERK Dealer Selection (by Postcode): first, for manufacturers that have an attached MERK Dealer,
     *    look up that attached seller among available vendors.
     * 5. NIET‑MERK Dealer Selection (by Postcode): among domestic vendors with vendorType === "PHYSICAL_STORE_OR_SERVICE_DEALER" without an attached MERK Dealer, select the closest.
     * 6. MERK Distributeur in Land: first, for manufacturers with an attached MERK Distributeur,
     *    look up that attached seller; otherwise, select any vendor with seller.vendorType === "AGENT".
     * 7. MERK Fabriek: vendor with seller.vendorType === "MANUFACTURER".
     * 8. International Selection (by Postcode): fallback – select the vendor (any type) closest to the customer.
     *
     * Uses real variant data and customer postal code/country (or falls back to the first vendor’s data).
     */
    async selectVendorForVariation(
        ctx: RequestContext,
        productId: string
    ): Promise<Vendor | undefined> {
        const vendors = await this.getVendors(ctx, productId);
        const customer = await this.getAuthenticatedCustomer(ctx);
        const queryLang = ctx.languageCode;

        let customerPostalCode: string | undefined;
        let customerCountry: string | undefined;
        if (customer && customer.customFields) {
            customerPostalCode = customer.customFields.postalCode;
            customerCountry = customer.customFields.country;
        }
        if (!customerPostalCode || !customerCountry) {
            customerPostalCode = vendors[0]?.seller?.postalCode || undefined;
            customerCountry = vendors[0]?.seller?.country || undefined;
        }

        // Filter vendors that have stock.
        let availableVendors = vendors.filter(v => v.inStock);


        if (!customer) {
            availableVendors = availableVendors.filter(v => v.locales.includes(queryLang));
        }

        // console.log(availableVendors);

        // 1. Boardrush (own stock)
        let vendor = availableVendors.find(v => v.seller && v.seller.vendorType === 'BOARDRUSH_PLATFORM');
        if (vendor) return vendor;

        // 2. Customer’s Preferred Shop
        if (customer && customer.customFields && customer.customFields.preferredSeller) {
            const preferredSellerId = customer.customFields.preferredSeller.id;
            vendor = availableVendors.find(v => v.seller && v.sellerId === String(preferredSellerId));
            if (vendor) return vendor;
        }

        // 3. Lowest Price Within Country (domestic PHYSICAL_STORE_OR_SERVICE_DEALER)
        const domestic = availableVendors.filter(v =>
            v.seller &&
            v.seller.country === customerCountry &&
            v.seller.vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER'
        );
        if (domestic.length > 0) {
            domestic.sort((a, b) => a.price - b.price);
            if (domestic[0]) return domestic[0];
        }

        // 4. MERK Dealer Selection (by Postcode) – check manufacturers with an attached MERK Dealer.
        const manufacturersWithDealer = availableVendors.filter(v =>
            v.seller &&
            v.seller.vendorType === 'MANUFACTURER' &&
            v.seller.merkDealer && v.seller.merkDealer.id
        );
        for (const m of manufacturersWithDealer) {
            const attachedDealerId = m.seller!.merkDealer!.id;
            vendor = availableVendors.find(v => v.seller && v.sellerId === attachedDealerId);
            if (vendor) return vendor;
        }

        // 5. NIET‑MERK Dealer Selection (by Postcode) – among domestic PHYSICAL_STORE_OR_SERVICE_DEALER vendors.
        const nonAttachedDomestic = availableVendors.filter(v =>
            v.seller &&
            v.seller.country === customerCountry &&
            v.seller.vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER'
        );
        if (nonAttachedDomestic.length > 0 && customerPostalCode && customerCountry) {
            vendor = await this.getClosestVendor(nonAttachedDomestic, customerPostalCode, customerCountry);
            if (vendor) return vendor;
        }

        // 6. MERK Distributeur in Land – check manufacturers with an attached MERK Distributeur.
        const manufacturersWithDistrib = availableVendors.filter(v =>
            v.seller &&
            v.seller.vendorType === 'MANUFACTURER' &&
            v.seller.merkDistributeur && v.seller.merkDistributeur.id
        );
        for (const m of manufacturersWithDistrib) {
            const attachedDistribId = m.seller!.merkDistributeur!.id;
            vendor = availableVendors.find(v => v.seller && v.sellerId === attachedDistribId);
            if (vendor) return vendor;
        }
        // Otherwise, select any vendor with vendorType "AGENT".
        const distributors = availableVendors.filter(v => v.seller && v.seller.vendorType === 'AGENT');
        if (distributors.length > 0) return distributors[0];

        // 7. MERK Fabriek – vendor with vendorType "MANUFACTURER".
        const manufacturers = availableVendors.filter(v => v.seller && v.seller.vendorType === 'MANUFACTURER');
        if (manufacturers.length > 0) return manufacturers[0];

        // 8. International Selection (by Postcode) – fallback.
        if (availableVendors.length > 0 && customerPostalCode && customerCountry) {
            vendor = await this.getClosestVendor(availableVendors, customerPostalCode, customerCountry);
            return vendor;
        }

        return undefined;
    }
}
