import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FeatureFlagsResponseSchema, type FeatureFlagsResponse } from '@erp/contracts';
import { ApiZodResponse } from '../../common/openapi';
import { FeatureFlagsService } from './feature-flags.service';

@ApiTags('flags')
@Controller('flags')
export class FlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  /** The release flags, so clients hide the same unfinished screens the API hides. */
  @Get()
  @ApiZodResponse(200, FeatureFlagsResponseSchema, 'Release flags and whether each is on')
  async list(): Promise<FeatureFlagsResponse> {
    return FeatureFlagsResponseSchema.parse({ flags: await this.flags.all() });
  }
}
