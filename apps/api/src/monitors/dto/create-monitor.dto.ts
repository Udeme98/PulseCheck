import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { IsMonitorUrl } from '../monitor-url.validator.js';

export class CreateMonitorDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsMonitorUrl()
  url!: string;

  @IsOptional()
  @IsInt()
  @Min(300)
  intervalSeconds?: number;
}
