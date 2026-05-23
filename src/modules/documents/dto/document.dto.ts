import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class UploadMetadataDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;        // defaults to original filename

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  folderId?: string;

  @IsString()
  @IsOptional()
  refType?: string;

  @IsString()
  @IsOptional()
  refId?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @IsOptional()
  tags?: string[];

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateDocumentDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  folderId?: string | null;

  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @IsOptional()
  tags?: string[];

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class CreateShareLinkDto {
  @IsString()
  @IsOptional()
  password?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxAccesses?: number;
}

export class OpenShareLinkDto {
  @IsString()
  @IsOptional()
  password?: string;
}

export class VersionNotesDto {
  @Type(() => String)
  @IsString()
  @IsOptional()
  notes?: string;
}
