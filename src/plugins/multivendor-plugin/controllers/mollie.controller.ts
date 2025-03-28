import { Controller, Get, Query, Redirect, Res, Post, Body } from '@nestjs/common';
import { MultivendorService } from '../service/mv.service';
import { Ctx, RequestContext, RequestContextService, AdministratorService, ConfigService, TransactionalConnection, OrderService, PaymentService, Order, Payment } from '@vendure/core';
import createMollieClient from '@mollie/api-client';
import axios from 'axios';

const mollieApiKey = process.env.MOLLIE_API_KEY;

@Controller('mollie')
export class MollieController {
    constructor(
        private readonly configService: ConfigService,
        private readonly multivendorService: MultivendorService,
        private readonly requestContextService: RequestContextService,
        private readonly administratorService: AdministratorService,
        private readonly orderService: OrderService,
        private readonly paymentService: PaymentService,
        private readonly connection: TransactionalConnection
    ) {}

    @Get('Connect')
    @Redirect()
    async connectToMollie(@Query('adminId') adminId: string) {
        if (!adminId) {
            throw new Error('Admin ID is required');
        }

        const clientId = process.env.MOLLIE_CLIENT_ID;
        const hostname = process.env.VENDURE_HOST || 'https://localhost:3000';
        const redirectUri = `${hostname}/mollie/callback`;

        const mollieAuthUrl = `https://www.mollie.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&state=${adminId}&response_type=code&scope=payments.read+payments.write+organizations.read+profiles.read`;

        return { url: mollieAuthUrl };
    }

    @Get('callback')
    async handleMollieCallback(@Query() query: any, @Res() res: any, @Ctx() ctx: RequestContext) {
        const { code, state: adminId } = query;

        if (!code || !adminId) {
            return res.status(400).send('Invalid callback parameters.');
        }

        console.log('Admin ID from state:', adminId);

        const admin = await this.administratorService.findOne(ctx, adminId);
        if (!admin) {
            return res.status(404).send('Administrator not found for adminId: ' + adminId);
        }

        const tokens = await this.multivendorService.exchangeCodeForTokens(code);

        await this.multivendorService.saveMollieTokens(
            ctx,
            admin.id,
            tokens.access_token,
            tokens.refresh_token
        );

        res.redirect('/admin/settings/profile');
    }

    @Post('webhook')
    async handleMollieWebhook(@Body() body: any, @Res() res: any) {
        if (!mollieApiKey) {
            throw new Error('Mollie API key is not defined in the environment variables.');
        }

        const paymentId = body.id;
        if (!paymentId) {
            return res.status(400).send('Payment ID is missing.');
        }

        try {
            const mollieClient = createMollieClient({ apiKey: mollieApiKey });
            const molliePayment = await mollieClient.payments.get(paymentId);

            if (molliePayment.status === 'paid') {
                const ctx = await this.requestContextService.create({
                    apiType: 'admin',
                });

                // Find all Payment records with the matching transactionId
                const paymentRecords = await this.connection.getRepository(ctx, Payment).find({
                    where: { transactionId: paymentId },
                    relations: ['order']
                });

                if (paymentRecords && paymentRecords.length > 0) {
                    // Settle all found payments concurrently
                    await Promise.all(
                        paymentRecords.map(paymentRecord => this.paymentService.settlePayment(ctx, paymentRecord.id))
                    );
                    return res.status(200).send('All matching payments settled successfully.');
                } else {
                    return res.status(404).send('No payment records found for transaction ID: ' + paymentId);
                }
            } else {
                return res.status(200).send(`Payment status: ${molliePayment.status}`);
            }
        } catch (error) {
            console.error('Error handling Mollie webhook:', error);
            return res.status(500).send('Error processing webhook.');
        }
    }
}
