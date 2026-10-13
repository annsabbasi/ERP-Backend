import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../../common/guards/module-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import { DocumentPrintingService } from './document-printing.service';
import {
  DocumentPrintingSearchDto,
  DocumentPrintingSelectionDto,
  EmailDocumentsDto,
  MarkDocumentOutputDto,
} from './document-printing.dto';

// No route-level permission: printing a document needs the right to view that
// document type (financials.journal.view, financials.ar.view, …), which the
// service checks once it knows the type.
@ApiTags('Financials — Document Printing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('financials')
@Controller('financials/document-printing')
export class DocumentPrintingController {
  constructor(private readonly service: DocumentPrintingService) {}

  @ApiOperation({
    summary:
      'Series, BP groups, print preferences and the types this user may print',
  })
  @Get('lookups')
  lookups(@CurrentUser() user: AuthedUser) {
    return this.service.lookups(user);
  }

  @ApiOperation({ summary: 'Documents matching the Selection Criteria window' })
  @HttpCode(200)
  @Post('search')
  search(
    @CurrentUser() user: AuthedUser,
    @Body() dto: DocumentPrintingSearchDto,
  ) {
    return this.service.search(user, dto);
  }

  @ApiOperation({
    summary:
      'Header, partner, lines and totals of the selected documents, ready to print',
  })
  @HttpCode(200)
  @Post('documents')
  documents(
    @CurrentUser() user: AuthedUser,
    @Body() dto: DocumentPrintingSelectionDto,
  ) {
    return this.service.documents(user, dto.documentType, dto.ids);
  }

  @ApiOperation({
    summary: 'Mark documents as printed (after the user confirms) or e-mailed',
  })
  @HttpCode(200)
  @Post('mark')
  mark(@CurrentUser() user: AuthedUser, @Body() dto: MarkDocumentOutputDto) {
    return this.service.mark(user, dto.documentType, dto.ids, dto.output);
  }

  @ApiOperation({
    summary: "E-mail each document to its business partner's e-mail address",
  })
  @HttpCode(200)
  @Post('email')
  email(@CurrentUser() user: AuthedUser, @Body() dto: EmailDocumentsDto) {
    return this.service.email(user, dto);
  }
}
