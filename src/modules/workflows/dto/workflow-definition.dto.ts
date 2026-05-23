import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateWorkflowDefinitionDto {
  @IsString()
  key: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  entityType?: string;

  @IsObject()
  steps: Record<string, unknown>;

  @IsInt()
  @Min(1)
  @IsOptional()
  version?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateWorkflowDefinitionDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  entityType?: string;

  @IsObject()
  @IsOptional()
  steps?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CloneWorkflowDefinitionDto {
  @IsString()
  @IsOptional()
  name?: string;
}
