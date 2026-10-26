
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { MonitorStatus } from '@prisma/client';

export class UpdateMonitorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url?: string;

  @IsOptional()
  @IsInt()
  @Min(300)
  intervalSeconds?: number;

  @IsOptional()
  @IsEnum(MonitorStatus)
  status?: MonitorStatus;
}
