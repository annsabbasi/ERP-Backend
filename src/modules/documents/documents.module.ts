import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { ShareLinksController } from './share-links.controller';
import { ShareLinksService } from './share-links.service';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [FoldersController, DocumentsController, ShareLinksController],
  providers: [FoldersService, DocumentsService, ShareLinksService],
  exports: [FoldersService, DocumentsService, ShareLinksService],
})
export class DocumentsModule {}
