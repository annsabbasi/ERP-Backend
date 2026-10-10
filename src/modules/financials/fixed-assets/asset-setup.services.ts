import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  AccountSubtype,
  AccountType,
  DepreciationMethod,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TenantCrudOptions,
  TenantCrudService,
} from '../../../common/crud/tenant-crud.service';
import {
  CreateAssetClassDto,
  CreateDepreciationAreaDto,
  UpdateAssetClassDto,
  UpdateDepreciationAreaDto,
} from './fixed-assets.dto';
import { requireClassAccount, ZERO } from './fixed-assets.shared';

const ACCOUNT_SELECT = {
  select: { id: true, code: true, name: true, type: true },
} as const;

/**
 * The four accounts and their rules (QA FA-D4). `locked` accounts hold the
 * asset values themselves, so they cannot move once a class's assets carry
 * values; the expense and clearing accounts only steer future postings.
 */
const CLASS_ACCOUNTS = [
  {
    field: 'assetAccountId',
    label: 'APC account',
    types: [AccountType.ASSET],
    subtype: AccountSubtype.FIXED_ASSET,
    locked: true,
  },
  {
    field: 'accumulatedDepreciationAccountId',
    label: 'Accumulated depreciation account',
    types: [AccountType.ASSET],
    subtype: undefined,
    locked: true,
  },
  {
    field: 'depreciationExpenseAccountId',
    label: 'Depreciation expense account',
    types: [AccountType.EXPENSE],
    subtype: undefined,
    locked: false,
  },
  {
    field: 'clearingAccountId',
    label: 'Acquisition clearing account',
    types: [AccountType.LIABILITY, AccountType.ASSET],
    subtype: undefined,
    locked: false,
  },
] as const;

type ClassAccountField = (typeof CLASS_ACCOUNTS)[number]['field'];

// ─── ASSET CLASSES ────────────────────────────────────────────────────────────
@Injectable()
export class AssetClassesService extends TenantCrudService {
  protected readonly modelName = 'assetClass';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Asset class',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive', 'depreciationMethod'],
    uniqueBy: ['code'],
    include: {
      assetAccount: ACCOUNT_SELECT,
      accumulatedDepreciationAccount: ACCOUNT_SELECT,
      depreciationExpenseAccount: ACCOUNT_SELECT,
      clearingAccount: ACCOUNT_SELECT,
      _count: { select: { assets: true } },
    },
  };

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create(companyId: string, dto: CreateAssetClassDto): Promise<unknown> {
    await this.validateAccounts(companyId, dto);
    return (await super.create(companyId, {
      ...dto,
      code: dto.code.trim().toUpperCase(),
      name: dto.name.trim(),
    })) as unknown;
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateAssetClassDto,
  ): Promise<unknown> {
    const current = (await this.findOne(companyId, id)) as unknown as Record<
      ClassAccountField,
      string
    >;
    const next = { ...current, ...dto } as Record<ClassAccountField, string>;
    const changed = CLASS_ACCOUNTS.filter(
      (a) =>
        a.locked &&
        dto[a.field] !== undefined &&
        dto[a.field] !== current[a.field],
    );
    if (changed.length) {
      // Moving the APC or accumulated depreciation account once the class's
      // assets carry values would strand the existing balance in the old
      // account while the next posting goes to the new one — the asset
      // register and the G/L would stop reconciling. Values move between
      // accounts through a Transfer (FA-2).
      const valued = await this.prisma.fixedAssetAreaValue.count({
        where: {
          companyId,
          asset: { assetClassId: id },
          OR: [
            { acquisitionCost: { not: ZERO } },
            { accumulatedDepreciation: { not: ZERO } },
          ],
        },
      });
      if (valued) {
        throw new ConflictException(
          `The ${changed.map((a) => a.label.toLowerCase()).join(' and ')} of this class cannot change: ` +
            `its assets already have values there, and moving it would strand the existing balance. Use Transfer (FA-2).`,
        );
      }
    }
    await this.validateAccounts(companyId, next);
    return (await super.update(companyId, id, {
      ...dto,
      ...(dto.code !== undefined
        ? { code: dto.code.trim().toUpperCase() }
        : {}),
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
    })) as unknown;
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    const assets = await this.prisma.fixedAsset.count({
      where: { companyId, assetClassId: id },
    });
    if (assets) {
      throw new ConflictException(
        `This asset class is used by ${assets} asset${assets === 1 ? '' : 's'}. Deactivate it instead.`,
      );
    }
    return super.remove(companyId, id);
  }

  /** Postable accounts only — what the four account pickers offer. */
  lookups(companyId: string) {
    return this.prisma.account.findMany({
      where: { companyId, isActive: true, isTitle: false, isControl: false },
      select: { id: true, code: true, name: true, type: true, subtype: true },
      orderBy: { code: 'asc' },
    });
  }

  private async validateAccounts(
    companyId: string,
    dto: Partial<Record<ClassAccountField, string>>,
  ) {
    const accounts = await Promise.all(
      CLASS_ACCOUNTS.map((a) =>
        requireClassAccount(
          this.prisma,
          companyId,
          dto[a.field] as string,
          a.label,
          [...a.types],
          a.subtype,
        ),
      ),
    );
    const [asset, accumulated, , clearing] = accounts;
    if (asset.id === accumulated.id) {
      throw new BadRequestException(
        'The asset account and the accumulated depreciation account must be different accounts.',
      );
    }
    if (asset.id === clearing.id) {
      throw new BadRequestException(
        'The asset account and the clearing account must be different: capitalization moves value from one to the other.',
      );
    }
    if (accumulated.id === clearing.id) {
      throw new BadRequestException(
        'The accumulated depreciation account and the clearing account must be different accounts.',
      );
    }
  }
}

// ─── DEPRECIATION AREAS ───────────────────────────────────────────────────────
@Injectable()
export class DepreciationAreasService extends TenantCrudService {
  protected readonly modelName = 'depreciationArea';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Depreciation area',
    orderBy: [{ ordering: 'asc' }, { code: 'asc' }],
    searchFields: ['code', 'name'],
    filterableFields: ['isActive', 'postsToGl'],
    uniqueBy: ['code'],
    include: { _count: { select: { values: true } } },
  };

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create(companyId: string, dto: CreateDepreciationAreaDto) {
    const isActive = dto.isActive ?? true;
    if (dto.postsToGl && isActive)
      await this.assertNoOtherPostingArea(companyId);

    return this.prisma
      .$transaction(async (tx) => {
        const area = await tx.depreciationArea.create({
          data: {
            companyId,
            code: dto.code.trim().toUpperCase(),
            name: dto.name.trim(),
            postsToGl: dto.postsToGl ?? false,
            ordering: dto.ordering ?? 0,
            isActive,
          },
        });
        // Assets that have not been capitalized yet get the new area with their
        // class's defaults. A capitalized asset is not given it retroactively:
        // that would invent values no document ever posted.
        const assets = await tx.fixedAsset.findMany({
          where: { companyId, status: 'NEW' },
          select: {
            id: true,
            assetClass: {
              select: { depreciationMethod: true, usefulLifeMonths: true },
            },
          },
        });
        if (assets.length) {
          await tx.fixedAssetAreaValue.createMany({
            data: assets.map((a) => ({
              companyId,
              assetId: a.id,
              areaId: area.id,
              depreciationMethod: a.assetClass.depreciationMethod,
              usefulLifeMonths: a.assetClass.usefulLifeMonths,
            })),
            skipDuplicates: true,
          });
        }
        return tx.depreciationArea.findUniqueOrThrow({
          where: { id: area.id },
          ...this.readArgs(),
        });
      })
      .catch((e) => {
        throw this.translatePrismaError(
          e,
          dto as unknown as Record<string, unknown>,
        );
      });
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateDepreciationAreaDto,
  ): Promise<unknown> {
    const current = (await this.findOne(companyId, id)) as unknown as {
      postsToGl: boolean;
      isActive: boolean;
      code: string;
    };
    const postsToGl = dto.postsToGl ?? current.postsToGl;
    const isActive = dto.isActive ?? current.isActive;

    if (postsToGl !== current.postsToGl || isActive !== current.isActive) {
      // Whether an area posts to the G/L decides where its values are in the
      // ledger. Flipping it after values exist would orphan them.
      const valued = await this.prisma.fixedAssetAreaValue.count({
        where: {
          companyId,
          areaId: id,
          OR: [
            { acquisitionCost: { not: ZERO } },
            { accumulatedDepreciation: { not: ZERO } },
          ],
        },
      });
      if (valued) {
        throw new ConflictException(
          `Depreciation area ${current.code} already holds values for ${valued} asset${valued === 1 ? '' : 's'}; ` +
            'whether it posts to the G/L and whether it is active can no longer change.',
        );
      }
    }
    if (postsToGl && isActive && !(current.postsToGl && current.isActive)) {
      await this.assertNoOtherPostingArea(companyId, id);
    }
    return (await super.update(companyId, id, {
      ...dto,
      ...(dto.code !== undefined
        ? { code: dto.code.trim().toUpperCase() }
        : {}),
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
    })) as unknown;
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    const [valued, docs, moves] = await Promise.all([
      this.prisma.fixedAssetAreaValue.count({
        where: {
          companyId,
          areaId: id,
          OR: [
            { acquisitionCost: { not: ZERO } },
            { accumulatedDepreciation: { not: ZERO } },
          ],
        },
      }),
      this.prisma.assetCapitalization.count({
        where: { companyId, depreciationAreaId: id },
      }),
      this.prisma.fixedAssetTransaction.count({ where: { areaId: id } }),
    ]);
    if (valued || docs || moves) {
      throw new ConflictException(
        'This depreciation area has postings against it. Deactivate it instead.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.fixedAssetAreaValue.deleteMany({
        where: { companyId, areaId: id },
      });
      await tx.depreciationArea.delete({ where: { id } });
      return { id, message: 'Depreciation area deleted' };
    });
  }

  private async assertNoOtherPostingArea(companyId: string, exceptId?: string) {
    const other = await this.prisma.depreciationArea.findFirst({
      where: {
        companyId,
        postsToGl: true,
        isActive: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { code: true },
    });
    if (other) {
      throw new ConflictException(
        `Depreciation area ${other.code} already posts to the G/L. Only one area may: two would book every ` +
          'capitalization and every depreciation twice.',
      );
    }
  }
}

export const DEPRECIATION_METHODS: {
  value: DepreciationMethod;
  label: string;
}[] = [
  { value: DepreciationMethod.STRAIGHT_LINE, label: 'Straight line' },
  {
    value: DepreciationMethod.DECLINING_BALANCE,
    label: 'Declining balance (double)',
  },
  { value: DepreciationMethod.SUM_OF_YEARS, label: "Sum of the years' digits" },
  {
    value: DepreciationMethod.IMMEDIATE,
    label: 'Immediate (full value on start)',
  },
  { value: DepreciationMethod.NONE, label: 'No depreciation' },
];
