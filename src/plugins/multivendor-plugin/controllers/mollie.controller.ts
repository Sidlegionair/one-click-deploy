import { Controller, Get, Query, Redirect, Res, Post, Body } from '@nestjs/common';
import { MultivendorService } from '../service/mv.service';
import { Ctx, RequestContext, RequestContextService, AdministratorService, ConfigService, TransactionalConnection, OrderService, PaymentService, Order } from '@vendure/core';
import createMollieClient from '@mollie/api-client';
import axios from 'axios';

const mollieApiKey = process.env.MOLLIE_API_KEY;

@Controller('mollie') // Define the base path for Mollie-related API endpoints
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

    // Define the connect endpoint
    @Get('Connect')
    @Redirect()
    async connectToMollie(@Query('adminId') adminId: string) {
        if (!adminId) {
            throw new Error('Admin ID is required');
        }

        const clientId = process.env.MOLLIE_CLIENT_ID;
        const hostname = process.env.VENDURE_HOST || 'https://localhost:3000'; // Default to 'https://localhost'
        const redirectUri = `${hostname}/mollie/callback`; // Redirect URL for authorization callback

        const mollieAuthUrl = `https://www.mollie.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&state=${adminId}&response_type=code&scope=payments.read+payments.write+organizations.read+profiles.read`;

        return { url: mollieAuthUrl }; // Redirect user to Mollie's authorization page
    }

    // Define the callback endpoint
    @Get('callback')
    async handleMollieCallback(@Query() query: any, @Res() res: any, @Ctx() ctx: RequestContext) {
        const { code, state: adminId } = query;

        if (!code || !adminId) {
            return res.status(400).send('Invalid callback parameters.');
        }

        console.log('Admin ID from state:', adminId);  // Log the state Admin ID

        // Retrieve the full Administrator entity using the `adminId` from the state parameter, not the activeUserId
        const admin = await this.administratorService.findOne(ctx, adminId);
        if (!admin) {
            return res.status(404).send('Administrator not found for adminId: ' + adminId);
        }

        // Exchange authorization code for Mollie tokens
        const tokens = await this.multivendorService.exchangeCodeForTokens(code);

        // Save the tokens in the Administrator's custom fields
        await this.multivendorService.saveMollieTokens(
            ctx,
            admin.id,         // Use the adminId from the state parameter
            tokens.access_token,
            tokens.refresh_token
        );

        // Redirect or send a success response
        res.redirect('/admin/settings/profile');
    }

    // Define the webhook endpoint
    @Post('webhook')
    async handleMollieWebhook(@Body() body: any, @Res() res: any) {
        if (!mollieApiKey) {
            throw new Error('Mollie API key is not defined in the environment variables.');
        }

        const paymentId = body.id; // Mollie sends the payment ID in the webhook payload

        if (!paymentId) {
            return res.status(400).send('Payment ID is missing.');
        }

        try {
            // Fetch payment details from Mollie
            const mollieClient = createMollieClient({ apiKey: mollieApiKey });
            const payment = await mollieClient.payments.get(paymentId);

            if (payment.status === 'paid') {
                // Fetch the order associated with the payment (assuming you store the Mollie payment ID in metadata)
                const ctx = await this.requestContextService.create({
                    apiType: 'admin',
                });

                const order = await this.connection.getRepository(ctx, Order).findOne({
                    where: { customFields: { transactionId: paymentId } }, // Adjust this based on how you store paymentId
                });

                if (order) {
                    // Mark the payment as 'Settled'
                    await this.paymentService.settlePayment(ctx, order.id);

                    res.status(200).send('Payment settled successfully.');
                } else {
                    res.status(404).send('Order not found for payment ID: ' + paymentId);
                }
            } else {
                // Handle other payment statuses (e.g., failed, canceled)
                res.status(200).send(`Payment status: ${payment.status}`);
            }
        } catch (error) {
            console.error('Error handling Mollie webhook:', error);
            res.status(500).send('Error processing webhook.');
        }
    }
}
