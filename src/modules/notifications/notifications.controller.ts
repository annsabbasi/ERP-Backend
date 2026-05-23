import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpsertPreferenceDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * User-scoped endpoints. Authentication is required (global guard) but no
 * special permission key — every authenticated user can read their own inbox
 * and edit their own preferences.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const userId = this.requireUserId(user);
    return this.notifications.listForUser(userId, {
      unreadOnly: unreadOnly === 'true',
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: any) {
    const count = await this.notifications.unreadCount(this.requireUserId(user));
    return { count };
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.notifications.markRead(id, this.requireUserId(user));
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: any) {
    return this.notifications.markAllRead(this.requireUserId(user));
  }

  @Patch(':id/dismiss')
  dismiss(@Param('id') id: string, @CurrentUser() user: any) {
    return this.notifications.dismiss(id, this.requireUserId(user));
  }

  // ── Preferences ──────────────────────────────────────────────────────────

  @Get('preferences')
  listPreferences(@CurrentUser() user: any) {
    return this.notifications.listPreferences(this.requireUserId(user));
  }

  @Put('preferences')
  upsertPreference(@Body() dto: UpsertPreferenceDto, @CurrentUser() user: any) {
    return this.notifications.upsertPreference(this.requireUserId(user), dto);
  }

  private requireUserId(user: any): string {
    if (!user?.sub) throw new BadRequestException('No authenticated user');
    return user.sub;
  }
}
