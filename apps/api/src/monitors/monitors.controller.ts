import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { MonitorsService } from './monitors.service.js';
import { CreateMonitorDto } from './dto/create-monitor.dto.js';
import { UpdateMonitorDto } from './dto/update-monitor.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { JwtPayload } from '../auth/auth.types.js';

@Controller('monitors')
export class MonitorsController {
  constructor(private readonly monitorsService: MonitorsService) {}

  @Post()
  create(@Body() dto: CreateMonitorDto, @CurrentUser() user: JwtPayload) {
    return this.monitorsService.create(dto, user.sub);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.monitorsService.findAll(user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.monitorsService.findOne(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMonitorDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.monitorsService.update(id, user.sub, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.monitorsService.remove(id, user.sub);
  }

  @Post(':id/check')
  check(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.monitorsService.check(id, user.sub);
  }

  @Get(':id/history')
  getCheckHistory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.monitorsService.getCheckHistory(id, user.sub);
  }
}
