import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProblemException } from '../../common/problem';
import { FeatureFlagsService } from './feature-flags.service';

const FLAG_KEY = 'erp:feature-flag';

/** Hides an endpoint (404 not_found) while its release flag is off. */
export const RequireFlag = (flag: string) => SetMetadata(FLAG_KEY, flag);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<string | undefined>(FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!flag) return true;
    // Not found, not forbidden: an unfinished endpoint does not exist yet for the caller.
    if (!(await this.flags.isEnabled(flag))) throw new ProblemException('not_found');
    return true;
  }
}
