import { Args, Query, Resolver, ObjectType, Field, ID } from '@nestjs/graphql';
import { Ctx, RequestContext, LanguageCode } from '@vendure/core';
import { VendorSelectionService, Vendor } from './../service/vendor-selection.service';

@ObjectType()
export class VendorSelectionResult {
    @Field(() => ID)
    sellerId: string;
    @Field()
    name: string;
    @Field()
    firstName: string;
    @Field()
    lastName: string;
    @Field()
    emailAddress: string;
    @Field()
    address: string;
    @Field()
    postalCode: string;
    @Field()
    country: string;
    @Field()
    vendorType: string;
    @Field()
    slug: string;
    @Field()
    channel: string;
    @Field(() => [String])
    locales: string[];
    @Field()
    nationalLocale: string;
}

@ObjectType()
export class ServiceLocationResult {
    @Field(() => VendorSelectionResult, { nullable: true })
    serviceDealer: VendorSelectionResult | null;
    @Field()
    serviceAgentAvailable: boolean;
    @Field()
    scenario: string;
}

@Resolver()
export class VendorSelectionResolver {
    constructor(private vendorSelectionService: VendorSelectionService) {}

    @Query(() => VendorSelectionResult, {
        nullable: true,
        description: 'Determines which vendor (channel + seller) to use for a product variation based on our supplier selection hierarchy.',
    })
    async selectVendorForVariation(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: string
    ): Promise<VendorSelectionResult | null> {
        const vendor: Vendor | undefined = await this.vendorSelectionService.selectVendorForVariation(ctx, productId);
        if (!vendor || !vendor.seller) return null;
        return this.mapVendorToResult(vendor);
    }

    @Query(() => ServiceLocationResult, {
        nullable: true,
        description: 'Determines which service location will be used for a product based on the selected vendor.',
    })
    async getServiceLocationForProduct(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: string
    ): Promise<ServiceLocationResult | null> {
        console.log(`[ServiceLocation] Starting service location selection for productId: ${productId}`);

        const vendor: Vendor | undefined = await this.vendorSelectionService.selectVendorForVariation(ctx, productId);
        console.log(`[ServiceLocation] Selected vendor:`, vendor ? {
            sellerId: vendor.sellerId,
            name: vendor.seller?.name,
            vendorType: vendor.seller?.vendorType,
            country: vendor.seller?.country
        } : 'No vendor found');

        if (!vendor || !vendor.seller) {
            console.log(`[ServiceLocation] No valid vendor or seller found for productId: ${productId}`);
            return null;
        }

        const vendorType = vendor.seller.vendorType;
        console.log(`[ServiceLocation] Vendor type: ${vendorType}`);

        let serviceDealer: Vendor | null = null;
        let serviceAgentAvailable = false;
        let scenario = '';

        if (vendorType === 'PHYSICAL_STORE_OR_SERVICE_DEALER') {
            // Scenario 1: Product ordered at a physical store
            console.log(`[ServiceLocation] Vendor is a PHYSICAL_STORE_OR_SERVICE_DEALER, using itself as service dealer`);
            scenario = "Product besteld bij een WINKEL";
            // For a physical store, the seller is its own service dealer
            serviceDealer = vendor;
            serviceAgentAvailable = false;
        } else if (vendorType === 'MANUFACTURER') {
            // For a manufacturer, service agent is available
            console.log(`[ServiceLocation] Vendor is a MANUFACTURER`);
            serviceAgentAvailable = true;
            console.log(`[ServiceLocation] Service agent available: ${serviceAgentAvailable}`);

            // For a manufacturer, attempt to set the service dealer from the attached fields
            console.log(`[ServiceLocation] Checking merkDealers:`, vendor.seller.merkDealers ? 
                `Found ${vendor.seller.merkDealers.length} dealers` : 'No merkDealers found');

            if (vendor.seller.merkDealers && vendor.seller.merkDealers.length > 0) {
                // Select the most appropriate merkDealer based on location
                // Since we don't have direct access to customer location in the resolver,
                // we'll use the vendor's country as a proxy for the customer's country
                const vendorCountry = vendor.seller?.country;
                console.log(`[ServiceLocation] Vendor country: ${vendorCountry || 'Not specified'}`);

                let selectedDealer = vendor.seller.merkDealers[0]; // Default to first dealer
                console.log(`[ServiceLocation] Selected dealer (default to first):`, {
                    id: selectedDealer.id,
                    name: selectedDealer.name,
                    customFields: selectedDealer.customFields
                });

                if (vendorCountry) {
                    // Since we can't access customFields directly on merkDealers (they only have id),
                    // we'll just use the first dealer
                    console.log(`[ServiceLocation] Using first dealer as we can't check country`);
                    // Log all available dealers for debugging
                    vendor.seller.merkDealers.forEach((dealer, index) => {
                        console.log(`[ServiceLocation] Available dealer ${index + 1}:`, {
                            id: dealer.id,
                            name: dealer.name
                        });
                    });
                }

                // We need to create a Vendor object from the selected merkDealer
                serviceDealer = this.createServiceDealerVendor(selectedDealer);
                console.log(`[ServiceLocation] Created service dealer vendor from selected dealer`);

                if (serviceAgentAvailable) {
                    scenario = "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt";
                } else {
                    scenario = "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt";
                }
            } else if (vendor.seller.merkDistributeur) {
                // Use merkDistributeur as service dealer
                console.log(`[ServiceLocation] No merkDealers found, using merkDistributeur:`, {
                    id: vendor.seller.merkDistributeur.id,
                    name: vendor.seller.merkDistributeur.name
                });

                serviceDealer = this.createServiceDealerVendor(vendor.seller.merkDistributeur);
                console.log(`[ServiceLocation] Created service dealer vendor from merkDistributeur`);

                if (serviceAgentAvailable) {
                    scenario = "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt";
                } else {
                    scenario = "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt";
                }
            } else {
                console.log(`[ServiceLocation] No merkDealers or merkDistributeur found for this manufacturer`);
                if (serviceAgentAvailable) {
                    scenario = "Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER";
                } else {
                    scenario = "Product besteld bij een MERK zonder beschikbare SERVICE_DEALER";
                }
            }
        } else if (vendorType === 'BOARDRUSH_PLATFORM') {
            // For BOARDRUSH_PLATFORM, service agent is not applicable
            console.log(`[ServiceLocation] Vendor is a BOARDRUSH_PLATFORM`);
            serviceAgentAvailable = false;
            console.log(`[ServiceLocation] Service agent available: ${serviceAgentAvailable} (not applicable for BOARDRUSH_PLATFORM)`);

            // Check if we can find a service dealer for this product
            console.log(`[ServiceLocation] Checking merkDealers:`, vendor.seller.merkDealers ? 
                `Found ${vendor.seller.merkDealers.length} dealers` : 'No merkDealers found');

            if (vendor.seller.merkDealers && vendor.seller.merkDealers.length > 0) {
                // Select the most appropriate merkDealer based on location
                // Since we don't have direct access to customer location in the resolver,
                // we'll use the vendor's country as a proxy for the customer's country
                const vendorCountry = vendor.seller?.country;
                console.log(`[ServiceLocation] Vendor country: ${vendorCountry || 'Not specified'}`);

                let selectedDealer = vendor.seller.merkDealers[0]; // Default to first dealer
                console.log(`[ServiceLocation] Selected dealer (default to first):`, {
                    id: selectedDealer.id,
                    name: selectedDealer.name,
                    customFields: selectedDealer.customFields
                });

                if (vendorCountry) {
                    // Since we can't access customFields directly on merkDealers (they only have id),
                    // we'll just use the first dealer
                    console.log(`[ServiceLocation] Using first dealer as we can't check country`);
                    // Log all available dealers for debugging
                    vendor.seller.merkDealers.forEach((dealer, index) => {
                        console.log(`[ServiceLocation] Available dealer ${index + 1}:`, {
                            id: dealer.id,
                            name: dealer.name
                        });
                    });
                }

                serviceDealer = this.createServiceDealerVendor(selectedDealer);
                console.log(`[ServiceLocation] Created service dealer vendor from selected dealer`);
                scenario = "Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat";
            } else if (vendor.seller.merkDistributeur) {
                // Use merkDistributeur as service dealer
                console.log(`[ServiceLocation] No merkDealers found, using merkDistributeur:`, {
                    id: vendor.seller.merkDistributeur.id,
                    name: vendor.seller.merkDistributeur.name
                });

                serviceDealer = this.createServiceDealerVendor(vendor.seller.merkDistributeur);
                console.log(`[ServiceLocation] Created service dealer vendor from merkDistributeur`);
                scenario = "Product besteld bij BOARDRUSH zelf, service door dealer die merk niet bevat";
            } else {
                // No service dealer available
                console.log(`[ServiceLocation] No merkDealers or merkDistributeur found for BOARDRUSH_PLATFORM`);
                scenario = "Product besteld bij BOARDRUSH zelf";
            }
        } else {
            console.log(`[ServiceLocation] Unknown vendor type: ${vendorType}`);
            scenario = "Onbekend scenario";
        }

        // Log the final decision
        console.log(`[ServiceLocation] Final decision:`, {
            hasServiceDealer: !!serviceDealer,
            serviceDealerName: serviceDealer ? serviceDealer.seller?.name : 'None',
            serviceAgentAvailable,
            scenario
        });

        return {
            serviceDealer: serviceDealer ? this.mapVendorToResult(serviceDealer) : null,
            serviceAgentAvailable,
            scenario
        };
    }

    private mapVendorToResult(vendor: Vendor): VendorSelectionResult {
        return {
            sellerId: vendor.sellerId,
            name: vendor.seller?.name || '',
            firstName: vendor.seller?.firstName || '',
            lastName: vendor.seller?.lastName || '',
            emailAddress: vendor.seller?.emailAddress || '',
            address: vendor.seller?.address || '',
            postalCode: vendor.seller?.postalCode || '',
            country: vendor.seller?.country || '',
            vendorType: vendor.seller?.vendorType || '',
            slug: vendor.slug,
            channel: vendor.channel,
            locales: vendor.locales,
            nationalLocale: vendor.nationalLocale,
        };
    }

    private createServiceDealerVendor(seller: any): Vendor {
        // Create a minimal Vendor object from a seller
        console.log(`[ServiceLocation] Creating service dealer vendor from seller:`, {
            id: seller.id,
            name: seller.name,
            customFieldsAvailable: !!seller.customFields
        });

        // Log any potential issues with the seller data
        if (!seller.id) {
            console.log(`[ServiceLocation] WARNING: Seller ID is missing!`);
        }
        if (!seller.name) {
            console.log(`[ServiceLocation] WARNING: Seller name is missing!`);
        }
        if (!seller.customFields) {
            console.log(`[ServiceLocation] WARNING: Seller customFields are missing!`);
        } else {
            // Log which custom fields are available
            console.log(`[ServiceLocation] Seller custom fields available:`, {
                firstName: !!seller.customFields.firstName,
                lastName: !!seller.customFields.lastName,
                emailAddress: !!seller.customFields.emailAddress,
                address: !!seller.customFields.address,
                postalCode: !!seller.customFields.postalCode,
                country: !!seller.customFields.country,
                vendorType: !!seller.customFields.vendorType
            });
        }

        const vendorObject = {
            slug: '',  // These fields are not important for service dealer info
            channel: '',
            locales: [],
            nationalLocale: LanguageCode.en,
            sellerId: seller.id,
            seller: {
                name: seller.name || '',
                firstName: seller.customFields?.firstName || '',
                lastName: seller.customFields?.lastName || '',
                emailAddress: seller.customFields?.emailAddress || '',
                address: seller.customFields?.address || '',
                postalCode: seller.customFields?.postalCode || '',
                country: seller.customFields?.country || '',
                vendorType: seller.customFields?.vendorType || '',
            },
            price: 0,
            inStock: false
        };

        console.log(`[ServiceLocation] Created service dealer vendor object:`, {
            sellerId: vendorObject.sellerId,
            sellerName: vendorObject.seller.name,
            sellerCountry: vendorObject.seller.country,
            sellerVendorType: vendorObject.seller.vendorType
        });

        return vendorObject;
    }
}
