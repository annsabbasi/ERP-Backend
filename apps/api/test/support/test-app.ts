import {
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Module,
  Param,
  Patch,
  Query,
  Res,
  type MiddlewareConsumer,
  type NestMiddleware,
  type NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PageQuerySchema, type PageQuery } from '@erp/contracts';
import type { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { assertIfMatch, etagFor } from '../../src/common/etag';
import { decodeCursor, toPage } from '../../src/common/pagination';
import { ProblemException } from '../../src/common/problem';
import { CTX } from '../../src/common/request-context';
import { ZodValidationPipe } from '../../src/common/zod-validation.pipe';
import { DatabaseService } from '../../src/modules/database/database.service';

// Test-only routes that exercise the Stage 1 conventions end to end. Nothing here is part of
// the API: real routes arrive with their stages, and tenants will come from the access token
// (Stage 3), never from a header.

/** Stands in for the access token: X-Test-Tenant sets the tenant of the request. */
@Injectable()
class TestTenantMiddleware implements NestMiddleware {
  constructor(private readonly cls: ClsService) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    const tenant = request.headers['x-test-tenant'];
    if (typeof tenant === 'string') this.cls.set(CTX.tenantId, tenant);
    next();
  }
}

const RenameSchema = z.object({ name: z.string().min(2).max(80) });

@Controller('test/branches')
class TestBranchesController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(PageQuerySchema)) page: PageQuery) {
    const after = page.cursor ? decodeCursor(page.cursor) : undefined;
    const rows = await this.db.tx.branch.findMany({
      where: after ? { id: { gt: String(after.id) } } : undefined,
      orderBy: { id: 'asc' },
      take: page.limit + 1,
      select: { id: true, name: true, tenantId: true },
    });
    return toPage(rows, page.limit, (row) => ({ id: row.id }));
  }

  @Get(':id')
  async one(@Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const branch = await this.db.tx.branch.findUnique({ where: { id } });
    if (!branch) throw new ProblemException('not_found');
    response.setHeader('ETag', etagFor(branch.version));
    return { id: branch.id, name: branch.name, version: branch.version };
  }

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(RenameSchema)) body: z.infer<typeof RenameSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const branch = await this.db.tx.branch.findUnique({ where: { id } });
    if (!branch) throw new ProblemException('not_found');
    assertIfMatch(ifMatch, branch.version);
    const updated = await this.db.tx.branch.update({
      where: { id },
      data: { name: body.name, version: { increment: 1 } },
    });
    response.setHeader('ETag', etagFor(updated.version));
    return { id: updated.id, name: updated.name, version: updated.version };
  }
}

@Controller('test/misc')
class TestMiscController {
  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail');
  }
}

@Module({
  imports: [AppModule],
  controllers: [TestBranchesController, TestMiscController],
  providers: [TestTenantMiddleware],
})
class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TestTenantMiddleware).forRoutes('*');
  }
}

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}
