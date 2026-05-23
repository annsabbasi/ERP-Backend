import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApprovalDecision } from '@prisma/client';

export class StartWorkflowDto {
  @IsString()
  definitionKey: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  version?: number;

  @IsString()
  @IsOptional()
  refType?: string;

  @IsString()
  @IsOptional()
  refId?: string;

  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;
}

export class CancelWorkflowDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

export class DecideApprovalDto {
  @IsEnum(ApprovalDecision)
  decision: ApprovalDecision;

  @IsString()
  @IsOptional()
  comment?: string;
}
