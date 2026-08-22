import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.order.findMany({
      where: { companyId },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, companyId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async create(companyId: string, dto: CreateOrderDto) {
    if (dto.bpId) await this.requireCustomer(companyId, dto.bpId);

    // `total` is Decimal(19,4). Summing it in JS numbers first and handing the
    // result over means the rounding has already happened, in binary floating
    // point, before the column ever sees it.
    const total = dto.items.reduce(
      (sum, item) => sum.plus(new Prisma.Decimal(item.quantity).times(item.unitPrice)),
      new Prisma.Decimal(0),
    );

    return this.prisma.order.create({
      data: {
        companyId,
        bpId: dto.bpId ?? null,
        total,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });
  }

  async update(companyId: string, id: string, dto: UpdateOrderDto) {
    await this.findOne(companyId, id);
    return this.prisma.order.update({
      where: { id },
      data: { status: dto.status },
      include: { items: { include: { product: true } } },
    });
  }

  /** The order's partner has to be a customer, not a vendor. */
  private async requireCustomer(companyId: string, bpId: string) {
    const bp = await this.prisma.businessPartner.findFirst({
      where: { id: bpId, companyId },
      select: { id: true, cardName: true, cardType: true },
    });
    if (!bp) throw new NotFoundException('Business partner not found in this company');
    if (bp.cardType === 'VENDOR') {
      throw new BadRequestException(`${bp.cardName} is a vendor and cannot be sold to.`);
    }
    return bp;
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.order.delete({ where: { id } });
    return { message: `Order ${id} removed` };
  }
}
