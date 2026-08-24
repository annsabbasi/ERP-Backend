import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AdministrationModule } from '../administration/administration.module';

@Module({
  // Creating a user with modules raises grant requests rather than writing
  // access directly, so the gate lives in one place regardless of which screen
  // the access was asked for from.
  imports: [AdministrationModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
