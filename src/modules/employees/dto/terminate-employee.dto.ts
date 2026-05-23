import { IsDateString, IsOptional, IsString } from 'class-validator';

export class TerminateEmployeeDto {
  @IsDateString()
  @IsOptional()
  terminationDate?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
