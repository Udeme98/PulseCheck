import { IsNotEmpty, IsString } from 'class-validator';

export class MonitorOwnerQueryDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}
