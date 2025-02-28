// src/config/resend-email-sender.ts
import { Logger } from '@vendure/core'
import { EmailDetails, EmailSender } from '@vendure/email-plugin'
import { Resend } from 'resend'

export class ResendEmailSender implements EmailSender {
    protected resend: Resend

    constructor(apiKey: string) {
        this.resend = new Resend(apiKey)
    }

    async send(email: EmailDetails) {
        const { error, data } = await this.resend.emails.send({
            to: email.recipient,
            from: email.from,
            subject: email.subject,
            html: email.body,
        })
        if (error) {
            Logger.error(error.message, 'ResendEmailSender')
        } else {
            Logger.debug(`Email sent: ${data?.id}`, 'ResendEmailSender')
        }
    }
}
