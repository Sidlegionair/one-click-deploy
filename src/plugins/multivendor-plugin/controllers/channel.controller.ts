import { Controller, Get, Req } from '@nestjs/common';
import { RequestContextService, RequestContext, Channel, TransactionalConnection } from '@vendure/core';
import { Request } from 'express';

@Controller('channels')
export class CustomChannelController {
    constructor(
        private requestContextService: RequestContextService,
        private readonly connection: TransactionalConnection
    ) {}

    @Get()
    async getChannels(@Req() req: Request) {
        // Create a Vendure RequestContext from the Express request.
        const ctx: RequestContext = await this.requestContextService.fromRequest(req);

        // Use the injected connection to get the Channel repository.
        const channelRepository = this.connection.getRepository(ctx, Channel);

        // Find channels with the 'seller' relation loaded and limit to 100 results.
        const channels = await channelRepository.find({
            relations: ['seller'],
            take: 100,
        });

        // Map each channel to include the desired fields along with seller properties.
        return channels.map((channel: Channel) => ({
            slug: channel.token,
            channel: channel.code,
            locales: channel.availableLanguageCodes,
            nationalLocale: channel.defaultLanguageCode,
            sellerId: channel.sellerId,
            seller: channel.seller
                ? {
                    name: channel.seller.name,
                    firstName: channel.seller.customFields.firstName,
                    lastName: channel.seller.customFields.lastName,
                    emailAddress: channel.seller.customFields.emailAddress,
                    address: channel.seller.customFields.address,
                    postalCode: channel.seller.customFields.postalCode,
                    country: channel.seller.customFields.country,
                    vendorType: channel.seller.customFields.vendorType,
                }
                : null,
        }));
    }
}
