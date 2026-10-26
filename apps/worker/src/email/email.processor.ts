import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { EMAIL_QUEUE, EmailJobSchema } from '@erp/contracts';
import type { Job } from 'bullmq';
import { createTransport, type Transporter } from 'nodemailer';
import { render } from './templates';

/**
 * Sends the e-mails the API queues (§10.9.2). SMTP to Mailpit locally (D4); the provider's SMTP
 * at go-live. A failure throws, so BullMQ retries with back-off (5 attempts).
 */
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private transport?: Transporter;

  private get smtp(): Transporter {
    this.transport ??= createTransport(process.env.MAIL_SMTP_URL ?? 'smtp://localhost:1025');
    return this.transport;
  }

  async process(job: Job): Promise<void> {
    const email = EmailJobSchema.parse(job.data);
    const { subject, text, html, version } = render(email.template, email.data, email.locale);
    await this.smtp.sendMail({
      from: process.env.MAIL_FROM ?? 'ERP System <no-reply@erp.invalid>',
      to: email.to,
      subject,
      text,
      html,
      headers: { 'X-ERP-Template': version, 'Content-Language': email.locale },
    });
    // The address is personal data: the log names the template and job only (§10.15).
    this.logger.log(`sent ${version} (job ${job.id})`);
  }
}
