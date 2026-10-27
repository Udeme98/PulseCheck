import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MonitorsService } from './monitors.service.js';
import { CreateMonitorDto } from './dto/create-monitor.dto.js';
import { UpdateMonitorDto } from './dto/update-monitor.dto.js';
import { MonitorOwnerQueryDto } from './dto/monitor-owner-query.dto.js';

@Controller('monitors')
export class MonitorsController {
  constructor(private readonly monitorsService: MonitorsService) {}

  @Post()
  create(@Body() dto: CreateMonitorDto) {
    return this.monitorsService.create(dto);
  }

  @Get()
  findAll(@Query() query: MonitorOwnerQueryDto) {
    return this.monitorsService.findAll(query.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Query() query: MonitorOwnerQueryDto) {
    return this.monitorsService.findOne(id, query.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Query() query: MonitorOwnerQueryDto,
    @Body() dto: UpdateMonitorDto,
  ) {
    return this.monitorsService.update(id, query.userId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query() query: MonitorOwnerQueryDto) {
    return this.monitorsService.remove(id, query.userId);
  }

  @Post(':id/check')
  check(@Param('id') id: string, @Query() query: MonitorOwnerQueryDto) {
    return this.monitorsService.check(id, query.userId);
  }
}
