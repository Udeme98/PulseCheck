import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { MonitorStatus } from '@prisma/client';
import { IsMonitorUrl } from '../monitor-url.validator.js';

export class UpdateMonitorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // ValidateIf skips only when the value is strictly undefined (field omitted),
  // which preserves partial-update behaviour. Explicit null and empty string
  // are NOT skipped, so @IsMonitorUrl() rejects them with a validation error.
  @ValidateIf((_, value) => value !== undefined)
  @IsMonitorUrl()
  url?: string;

  @IsOptional()
  @IsInt()
  @Min(300)
  intervalSeconds?: number;

  @IsOptional()
  @IsEnum(MonitorStatus)
  status?: MonitorStatus;
}
