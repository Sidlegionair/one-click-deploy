import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';

@Controller('vies-proxy')
export class ViesProxyController {
    @Get()
    async checkVat(
        @Query('countryCode') countryCode: string,
        @Query('vatNumber') vatNumber: string,
    ): Promise<any> {
        // Remove the country code prefix if present
        const vatWithoutPrefix = vatNumber.startsWith(countryCode)
            ? vatNumber.slice(countryCode.length)
            : vatNumber;
        const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatWithoutPrefix}`;
        console.log('Proxying VAT check:', url);

        try {
            // Use fetch (available in Node 18+ or via a polyfill)
            const response = await fetch(url);
            if (!response.ok) {
                throw new HttpException(`VIES API error: ${response.statusText}`, HttpStatus.BAD_GATEWAY);
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('VIES proxy error:', error);
            throw new HttpException('Failed to check VAT', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
