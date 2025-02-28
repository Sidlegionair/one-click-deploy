import { Args, Query, Resolver, ObjectType, Field, ID } from '@nestjs/graphql';
import { Ctx, RequestContext } from '@vendure/core';
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
        return {
            sellerId: vendor.sellerId,
            name: vendor.seller.name,
            firstName: vendor.seller.firstName || '',
            lastName: vendor.seller.lastName || '',
            emailAddress: vendor.seller.emailAddress || '',
            address: vendor.seller.address || '',
            postalCode: vendor.seller.postalCode || '',
            country: vendor.seller.country || '',
            vendorType: vendor.seller.vendorType || '',
            slug: vendor.slug,
            channel: vendor.channel,
            locales: vendor.locales,
            nationalLocale: vendor.nationalLocale,
        };
    }
}
