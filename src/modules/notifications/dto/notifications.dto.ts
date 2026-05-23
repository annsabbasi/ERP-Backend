import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { NotificationChannel, NotificationDigest } from '@prisma/client';

export class UpsertPreferenceDto {
  @IsString()
  @IsOptional()
  category?: string; // defaults to "*"

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsBoolean()
  enabled: boolean;

  @IsEnum(NotificationDigest)
  @IsOptional()
  digest?: NotificationDigest;
}

export class CreateWebhookEndpointDto {
  @IsString()
  name: string;

  @IsUrl({ require_tld: false })
  url: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eventFilters?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateWebhookEndpointDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  url?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eventFilters?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  secret?: string;
}

export class TestWebhookDto {
  @IsString()
  eventKey: string;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;
}
