import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayslipSchedulerService } from './payslip-scheduler.service';
import { HrModule } from '../hr.module';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * PayslipSchedulerModule
 * ──────────────────────────────────────────────────────────────────────────────
 * Registers the @nestjs/schedule cron runner and the PayslipSchedulerService
 * that auto-generates payslips on the 1st of every month.
 *
 * Import this module once in AppModule — it pulls in ScheduleModule.forRoot()
 * which boots the underlying node-cron scheduler.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    HrModule,
  ],
  providers: [PayslipSchedulerService],
  exports: [PayslipSchedulerService],
})
export class PayslipSchedulerModule {}
